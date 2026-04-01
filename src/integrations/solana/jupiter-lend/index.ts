import { BorshCoder } from '@coral-xyz/anchor'
import { borrowPda } from '@jup-ag/lend'
import { getRatioAtTick, INIT_TICK, MIN_TICK } from '@jup-ag/lend/borrow'
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import type {
  LendingBorrowedAsset,
  LendingDefiPosition,
  LendingSuppliedAsset,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import lendingIdl from './idls/lending.json'
import vaultsIdl from './idls/vaults.json'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

// ─── Program IDs ─────────────────────────────────────────────────────────────
const LENDING_PROGRAM_ID = lendingIdl.address
const VAULTS_PROGRAM_ID = vaultsIdl.address

export const PROGRAM_IDS = [
  LENDING_PROGRAM_ID,
  VAULTS_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

// ─── Exchange precision (1e12) ────────────────────────────────────────────────
const EXCHANGE_PRECISION = BigInt('1000000000000')
const INIT_TICK_VALUE = INIT_TICK // -2147483648
const MIN_TICK_VALUE = MIN_TICK // -16383
const INTERNAL_VAULT_DECIMALS = 9

const lendingCoder = new BorshCoder(lendingIdl as never)
const vaultsCoder = new BorshCoder(vaultsIdl as never)

function accountDiscriminatorBase64(
  idl: { accounts?: Array<{ name: string; discriminator?: number[] }> },
  accountName: string,
): string {
  const discriminator = idl.accounts?.find(
    (account) => account.name === accountName,
  )?.discriminator
  if (!discriminator) {
    throw new Error(`Missing discriminator for account "${accountName}"`)
  }
  return Buffer.from(discriminator).toString('base64')
}

// Discriminator bytes for getProgramAccounts memcmp filters
const LENDING_DISC_B64 = accountDiscriminatorBase64(lendingIdl, 'Lending')
const POSITION_DISC_B64 = accountDiscriminatorBase64(vaultsIdl, 'Position')

// SPL token account: amount at offset 64, mint at offset 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64
const TOKEN_ACCOUNT_MINT_OFFSET = 0
// Position struct (Anchor bytemuck): discriminator (8) + vault_id (u16) + nft_id (u32)
const POSITION_MINT_OFFSET = 14

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58()
}

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset)
}

function readTokenAccountAmount(data: Uint8Array): bigint | null {
  const buf = Buffer.from(data)
  if (buf.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return null
  return readU64LE(buf, TOKEN_ACCOUNT_AMOUNT_OFFSET)
}

function readTokenAccountMint(data: Uint8Array): string | null {
  const buf = Buffer.from(data)
  if (buf.length < TOKEN_ACCOUNT_MINT_OFFSET + 32) return null
  return readPubkey(buf, TOKEN_ACCOUNT_MINT_OFFSET)
}

/**
 * Recover netDebtRaw from the position's tick and supplyAmount.
 * Aligns with Jupiter SDK rounding:
 * netDebtRaw = ((colRaw + 1) * getRatioAtTick(tick) >> 48) + 1
 * Total debt raw = netDebtRaw + dustDebtAmount.
 */
function computeNetDebtRaw(
  supplyAmount: bigint,
  tick: number,
  isSupplyOnly: boolean,
): bigint {
  if (isSupplyOnly || tick === INIT_TICK_VALUE || tick <= MIN_TICK_VALUE)
    return 0n
  const colBN = new BN(supplyAmount.toString()).addn(1)
  const ratio = getRatioAtTick(tick)
  return BigInt(colBN.mul(ratio).shrn(48).addn(1).toString())
}

export function denormalizeVaultAmount(
  amount: bigint,
  mintDecimals: number,
): bigint {
  if (mintDecimals >= INTERNAL_VAULT_DECIMALS) return amount
  const delta = INTERNAL_VAULT_DECIMALS - mintDecimals
  return amount / 10n ** BigInt(delta)
}

// ─── Integration ─────────────────────────────────────────────────────────────

export const jupiterLendIntegration: SolanaIntegration = {
  platformId: 'jupiter',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const walletPubkey = new PublicKey(address)

    // ── Phase 0a: Earn — discover all lending pool accounts ──────────────────
    const lendingMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: LENDING_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: LENDING_DISC_B64,
            encoding: 'base64',
          },
        },
      ],
    }
    const earnPools: Array<{
      mint: string
      fTokenMint: string
      decimals: number
      tokenExchangePrice: bigint
    }> = []

    for (const acc of Object.values(lendingMap)) {
      if (!acc.exists) continue
      try {
        const d = lendingCoder.accounts.decode('Lending', Buffer.from(acc.data))
        earnPools.push({
          mint: (d.mint as PublicKey).toBase58(),
          fTokenMint: (d.f_token_mint as PublicKey).toBase58(),
          decimals: d.decimals as number,
          tokenExchangePrice: BigInt((d.token_exchange_price as BN).toString()),
        })
      } catch {
        // skip accounts that fail to decode
      }
    }

    // ── Phase 0b: Get all of the user's SPL token accounts ───────────────────
    const userSplMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: TOKEN_PROGRAM_ID.toBase58(),
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 32, bytes: walletPubkey.toBase58() } },
      ],
    }
    // Build mint → amount map for all the user's SPL token accounts
    const userMintBalances = new Map<string, bigint>() // mint → amount
    for (const acc of Object.values(userSplMap)) {
      if (!acc.exists) continue
      const mint = readTokenAccountMint(acc.data)
      const amount = readTokenAccountAmount(acc.data)
      if (mint && amount !== null && amount > 0n) {
        userMintBalances.set(mint, amount)
      }
    }

    // Earn: which fTokenMints does the user hold via SPL?
    const splEarnBalances = new Map<string, bigint>() // fTokenMint → shares
    const needsToken22Check: string[] = [] // fTokenMint addresses not found in SPL

    for (const pool of earnPools) {
      const balance = userMintBalances.get(pool.fTokenMint)
      if (balance !== undefined && balance > 0n) {
        splEarnBalances.set(pool.fTokenMint, balance)
      } else {
        needsToken22Check.push(pool.fTokenMint)
      }
    }

    // ── Phase 0c: Vault positions — user-owned positions via position mint ──
    const userPositionMints = [...userMintBalances.entries()]
      .filter(([, amount]) => amount === 1n)
      .map(([mint]) => mint)
    const ownedPositions: {
      vaultId: number
      positionMint: string
      isSupplyOnly: boolean
      tick: number
      supplyAmount: bigint
      dustDebtAmount: bigint
    }[] = []
    const uniqueVaultIds = new Set<number>()
    const seenPositionMints = new Set<string>()

    for (const positionMint of userPositionMints) {
      const positionsByMint = yield {
        kind: 'getProgramAccounts' as const,
        programId: VAULTS_PROGRAM_ID,
        filters: [
          {
            memcmp: { offset: 0, bytes: POSITION_DISC_B64, encoding: 'base64' },
          },
          { memcmp: { offset: POSITION_MINT_OFFSET, bytes: positionMint } },
        ],
      }

      for (const acc of Object.values(positionsByMint)) {
        if (!acc.exists) continue
        try {
          const d = vaultsCoder.accounts.decode(
            'Position',
            Buffer.from(acc.data),
          )
          const supplyAmount = BigInt((d.supply_amount as BN).toString())
          if (supplyAmount === 0n) continue

          const decodedPositionMint = (d.position_mint as PublicKey).toBase58()
          if (seenPositionMints.has(decodedPositionMint)) continue
          if (decodedPositionMint !== positionMint) continue
          seenPositionMints.add(decodedPositionMint)
          const vaultId = d.vault_id as number
          ownedPositions.push({
            vaultId,
            positionMint: decodedPositionMint,
            isSupplyOnly: (d.is_supply_only_position as number) !== 0,
            tick: d.tick as number,
            supplyAmount,
            dustDebtAmount: BigInt((d.dust_debt_amount as BN).toString()),
          })
          uniqueVaultIds.add(vaultId)
        } catch {
          // skip accounts that fail to decode
        }
      }
    }

    // ── Phase 1: Small targeted fetch ────────────────────────────────────────
    const t22ATAByMint = new Map(
      needsToken22Check.map((fTokenMint) => [
        fTokenMint,
        getAssociatedTokenAddressSync(
          new PublicKey(fTokenMint),
          walletPubkey,
          true,
          TOKEN_2022_PROGRAM_ID,
        ).toBase58(),
      ]),
    )

    const vaults = [...uniqueVaultIds].map((id) => ({
      id,
      configAddr: borrowPda.getVaultConfig(id).toBase58(),
      stateAddr: borrowPda.getVaultState(id).toBase58(),
      metaAddr: borrowPda.getVaultMetadata(id).toBase58(),
    }))

    const phase1Map = yield [
      ...t22ATAByMint.values(),
      ...vaults.map((v) => v.configAddr),
      ...vaults.map((v) => v.stateAddr),
      ...vaults.map((v) => v.metaAddr),
    ]
    const result: UserDefiPosition[] = []

    // ── Decode Earn positions ─────────────────────────────────────────────────
    for (const pool of earnPools) {
      let shares = splEarnBalances.get(pool.fTokenMint)
      if (shares === undefined) {
        const ata = t22ATAByMint.get(pool.fTokenMint)
        if (ata !== undefined) {
          const ataAcc = phase1Map[ata]
          if (ataAcc?.exists) shares = readTokenAccountAmount(ataAcc.data) ?? 0n
        }
      }
      if (!shares || shares === 0n) continue

      const underlying = (shares * pool.tokenExchangePrice) / EXCHANGE_PRECISION
      if (underlying === 0n) continue

      const tokenInfo = tokens.get(pool.mint)
      const priceUsd = tokenInfo?.priceUsd
      const usdValue =
        priceUsd !== undefined
          ? ((Number(underlying) / 10 ** pool.decimals) * priceUsd).toString()
          : undefined

      const supplied: LendingSuppliedAsset = {
        amount: {
          token: pool.mint,
          amount: underlying.toString(),
          decimals: pool.decimals.toString(),
        },
        ...(priceUsd !== undefined && { priceUsd: priceUsd.toString() }),
        ...(usdValue !== undefined && { usdValue }),
      }

      result.push({
        positionKind: 'lending',
        platformId: 'jupiter',
        supplied: [supplied],
        ...(usdValue !== undefined && { usdValue: usdValue }),
      } satisfies LendingDefiPosition)
    }

    // ── Decode CDP vault positions ────────────────────────────────────────────
    const vaultConfigMap = new Map<
      number,
      { supplyToken: string; borrowToken: string }
    >()
    const vaultStateMap = new Map<
      number,
      { vaultSupplyExchangePrice: bigint; vaultBorrowExchangePrice: bigint }
    >()
    const vaultMetaMap = new Map<
      number,
      { supplyDecimals: number; borrowDecimals: number }
    >()

    for (const vault of vaults) {
      const { id, configAddr, stateAddr, metaAddr } = vault
      const cfgAcc = phase1Map[configAddr]
      const stateAcc = phase1Map[stateAddr]
      const metaAcc = phase1Map[metaAddr]

      if (cfgAcc?.exists) {
        try {
          const d = vaultsCoder.accounts.decode(
            'VaultConfig',
            Buffer.from(cfgAcc.data),
          )
          vaultConfigMap.set(id, {
            supplyToken: (d.supply_token as PublicKey).toBase58(),
            borrowToken: (d.borrow_token as PublicKey).toBase58(),
          })
        } catch {}
      }
      if (stateAcc?.exists) {
        try {
          const d = vaultsCoder.accounts.decode(
            'VaultState',
            Buffer.from(stateAcc.data),
          )
          vaultStateMap.set(id, {
            vaultSupplyExchangePrice: BigInt(
              (d.vault_supply_exchange_price as BN).toString(),
            ),
            vaultBorrowExchangePrice: BigInt(
              (d.vault_borrow_exchange_price as BN).toString(),
            ),
          })
        } catch {}
      }
      if (metaAcc?.exists) {
        try {
          const d = vaultsCoder.accounts.decode(
            'VaultMetadata',
            Buffer.from(metaAcc.data),
          )
          vaultMetaMap.set(id, {
            supplyDecimals: d.supply_mint_decimals as number,
            borrowDecimals: d.borrow_mint_decimals as number,
          })
        } catch {}
      }
    }

    for (const pos of ownedPositions) {
      const cfg = vaultConfigMap.get(pos.vaultId)
      const state = vaultStateMap.get(pos.vaultId)
      const meta = vaultMetaMap.get(pos.vaultId)
      if (!cfg || !state) continue

      const supplyDecimals = meta?.supplyDecimals ?? 6
      const borrowDecimals = meta?.borrowDecimals ?? 6

      const colInternalAmount =
        (pos.supplyAmount * state.vaultSupplyExchangePrice) / EXCHANGE_PRECISION
      const colAmount = denormalizeVaultAmount(
        colInternalAmount,
        supplyDecimals,
      )

      const netDebtRaw = computeNetDebtRaw(
        pos.supplyAmount,
        pos.tick,
        pos.isSupplyOnly,
      )
      const totalDebtRaw = netDebtRaw + pos.dustDebtAmount
      const debtInternalAmount =
        (totalDebtRaw * state.vaultBorrowExchangePrice) / EXCHANGE_PRECISION
      const debtAmount = denormalizeVaultAmount(
        debtInternalAmount,
        borrowDecimals,
      )

      const supplyTokenInfo = tokens.get(cfg.supplyToken)
      const borrowTokenInfo = tokens.get(cfg.borrowToken)
      const supplyPriceUsd = supplyTokenInfo?.priceUsd
      const borrowPriceUsd = borrowTokenInfo?.priceUsd

      const colUsd =
        supplyPriceUsd !== undefined
          ? (Number(colAmount) / 10 ** supplyDecimals) * supplyPriceUsd
          : undefined
      const debtUsd =
        borrowPriceUsd !== undefined && debtAmount > 0n
          ? (Number(debtAmount) / 10 ** borrowDecimals) * borrowPriceUsd
          : undefined

      const supplied: LendingSuppliedAsset = {
        amount: {
          token: cfg.supplyToken,
          amount: colAmount.toString(),
          decimals: supplyDecimals.toString(),
        },
        ...(supplyPriceUsd !== undefined && {
          priceUsd: supplyPriceUsd.toString(),
        }),
        ...(colUsd !== undefined && { usdValue: colUsd.toString() }),
      }

      const positionResult: LendingDefiPosition = {
        positionKind: 'lending',
        platformId: 'jupiter',
        supplied: [supplied],
        ...(colUsd !== undefined && { usdValue: colUsd.toString() }),
      }

      if (debtAmount > 0n) {
        const borrowed: LendingBorrowedAsset = {
          amount: {
            token: cfg.borrowToken,
            amount: debtAmount.toString(),
            decimals: borrowDecimals.toString(),
          },
          ...(borrowPriceUsd !== undefined && {
            priceUsd: borrowPriceUsd.toString(),
          }),
          ...(debtUsd !== undefined && { usdValue: debtUsd.toString() }),
        }
        positionResult.borrowed = [borrowed]
        if (colUsd !== undefined && debtUsd !== undefined) {
          positionResult.usdValue = (colUsd - debtUsd).toString()
        }
      }

      result.push(positionResult)
    }

    return result
  },
}

export default jupiterLendIntegration
