import { BorshCoder } from '@coral-xyz/anchor'
import { getRatioAtTick, INIT_TICK, MIN_TICK } from '@jup-ag/lend/borrow'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import type {
  LendingBorrowedAsset,
  LendingDefiPosition,
  LendingSuppliedAsset,
  ProgramRequest,
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
const VAULT_CONFIG_DISC_B64 = accountDiscriminatorBase64(
  vaultsIdl,
  'VaultConfig',
)
const VAULT_STATE_DISC_B64 = accountDiscriminatorBase64(vaultsIdl, 'VaultState')
const VAULT_METADATA_DISC_B64 = accountDiscriminatorBase64(
  vaultsIdl,
  'VaultMetadata',
)

// SPL token account: amount at offset 64, mint at offset 0, owner at offset 32
const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64

// Position struct (Anchor bytemuck): discriminator (8) + fields (packed)
const POSITION_VAULT_ID_OFFSET = 8
const POSITION_MINT_OFFSET = 14
const POSITION_IS_SUPPLY_ONLY_OFFSET = 46
const POSITION_TICK_OFFSET = 47
const POSITION_SUPPLY_AMOUNT_OFFSET = 55
const POSITION_DUST_DEBT_AMOUNT_OFFSET = 63

type DecodedPosition = {
  vaultId: number
  positionMint: string
  isSupplyOnly: boolean
  tick: number
  supplyAmount: bigint
  dustDebtAmount: bigint
}

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58()
}

function readU16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset)
}

function readI32LE(buf: Buffer, offset: number): number {
  return buf.readInt32LE(offset)
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

function readDiscriminatorBase64(data: Uint8Array): string | null {
  if (data.length < 8) return null
  return Buffer.from(data.subarray(0, 8)).toString('base64')
}

function parsePositionAccount(data: Uint8Array): DecodedPosition | null {
  const buf = Buffer.from(data)
  if (buf.length < POSITION_DUST_DEBT_AMOUNT_OFFSET + 8) return null

  return {
    vaultId: readU16LE(buf, POSITION_VAULT_ID_OFFSET),
    positionMint: readPubkey(buf, POSITION_MINT_OFFSET),
    isSupplyOnly: buf[POSITION_IS_SUPPLY_ONLY_OFFSET] !== 0,
    tick: readI32LE(buf, POSITION_TICK_OFFSET),
    supplyAmount: readU64LE(buf, POSITION_SUPPLY_AMOUNT_OFFSET),
    dustDebtAmount: readU64LE(buf, POSITION_DUST_DEBT_AMOUNT_OFFSET),
  }
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
    const walletAddress = walletPubkey.toBase58()

    // ── Phase 0: Discover all required datasets in parallel ──────────────────
    const discoveryRequests: ProgramRequest[] = [
      {
        kind: 'getProgramAccounts',
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
      },
      {
        kind: 'getTokenAccountsByOwner',
        owner: walletAddress,
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      {
        kind: 'getProgramAccounts',
        programId: VAULTS_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: POSITION_DISC_B64,
              encoding: 'base64',
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts',
        programId: VAULTS_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: VAULT_CONFIG_DISC_B64,
              encoding: 'base64',
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts',
        programId: VAULTS_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: VAULT_STATE_DISC_B64,
              encoding: 'base64',
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts',
        programId: VAULTS_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: VAULT_METADATA_DISC_B64,
              encoding: 'base64',
            },
          },
        ],
      },
    ]
    const discoveryMap = yield discoveryRequests

    const earnPools: Array<{
      mint: string
      fTokenMint: string
      decimals: number
      tokenExchangePrice: bigint
    }> = []

    // Build mint → amount map for all user SPL token accounts.
    const userMintBalances = new Map<string, bigint>()

    const positionsByMint = new Map<string, DecodedPosition>()

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

    for (const acc of Object.values(discoveryMap)) {
      if (!acc.exists) continue

      if (acc.programAddress === LENDING_PROGRAM_ID) {
        try {
          const d = lendingCoder.accounts.decode(
            'Lending',
            Buffer.from(acc.data),
          )
          earnPools.push({
            mint: (d.mint as PublicKey).toBase58(),
            fTokenMint: (d.f_token_mint as PublicKey).toBase58(),
            decimals: d.decimals as number,
            tokenExchangePrice: BigInt(
              (d.token_exchange_price as BN).toString(),
            ),
          })
        } catch {
          // skip accounts that fail to decode
        }
        continue
      }

      if (acc.programAddress === TOKEN_PROGRAM_ID.toBase58()) {
        const mint = readTokenAccountMint(acc.data)
        const amount = readTokenAccountAmount(acc.data)
        if (mint && amount !== null && amount > 0n) {
          userMintBalances.set(mint, amount)
        }
        continue
      }

      if (acc.programAddress !== VAULTS_PROGRAM_ID) continue

      const discriminator = readDiscriminatorBase64(acc.data)
      if (discriminator === POSITION_DISC_B64) {
        const parsed = parsePositionAccount(acc.data)
        if (!parsed || parsed.supplyAmount === 0n) continue
        if (!positionsByMint.has(parsed.positionMint)) {
          positionsByMint.set(parsed.positionMint, parsed)
        }
        continue
      }

      if (discriminator === VAULT_CONFIG_DISC_B64) {
        try {
          const d = vaultsCoder.accounts.decode(
            'VaultConfig',
            Buffer.from(acc.data),
          )
          vaultConfigMap.set(d.vault_id as number, {
            supplyToken: (d.supply_token as PublicKey).toBase58(),
            borrowToken: (d.borrow_token as PublicKey).toBase58(),
          })
        } catch {
          // skip accounts that fail to decode
        }
        continue
      }

      if (discriminator === VAULT_STATE_DISC_B64) {
        try {
          const d = vaultsCoder.accounts.decode(
            'VaultState',
            Buffer.from(acc.data),
          )
          vaultStateMap.set(d.vault_id as number, {
            vaultSupplyExchangePrice: BigInt(
              (d.vault_supply_exchange_price as BN).toString(),
            ),
            vaultBorrowExchangePrice: BigInt(
              (d.vault_borrow_exchange_price as BN).toString(),
            ),
          })
        } catch {
          // skip accounts that fail to decode
        }
        continue
      }

      if (discriminator === VAULT_METADATA_DISC_B64) {
        try {
          const d = vaultsCoder.accounts.decode(
            'VaultMetadata',
            Buffer.from(acc.data),
          )
          vaultMetaMap.set(d.vault_id as number, {
            supplyDecimals: d.supply_mint_decimals as number,
            borrowDecimals: d.borrow_mint_decimals as number,
          })
        } catch {
          // skip accounts that fail to decode
        }
      }
    }

    // Earn: which fTokenMints does the user hold via SPL?
    const splEarnBalances = new Map<string, bigint>()
    const needsToken22Check: string[] = []

    for (const pool of earnPools) {
      const balance = userMintBalances.get(pool.fTokenMint)
      if (balance !== undefined && balance > 0n) {
        splEarnBalances.set(pool.fTokenMint, balance)
      } else {
        needsToken22Check.push(pool.fTokenMint)
      }
    }

    // Wallet position mints are NFT-like token balances with amount=1.
    const userPositionMints = [...userMintBalances.entries()]
      .filter(([, amount]) => amount === 1n)
      .map(([mint]) => mint)

    const ownedPositions: DecodedPosition[] = []
    for (const positionMint of userPositionMints) {
      const position = positionsByMint.get(positionMint)
      if (!position) continue
      ownedPositions.push(position)
    }

    // ── Phase 1: Token-2022 fallback check by owner ──────────────────────────
    const token22Map =
      needsToken22Check.length > 0
        ? yield ({
            kind: 'getTokenAccountsByOwner',
            owner: walletAddress,
            programId: TOKEN_2022_PROGRAM_ID.toBase58(),
          } satisfies ProgramRequest)
        : {}

    const token22MintsToCheck = new Set(needsToken22Check)
    const token22EarnBalances = new Map<string, bigint>()

    for (const acc of Object.values(token22Map)) {
      if (!acc.exists) continue
      if (acc.programAddress !== TOKEN_2022_PROGRAM_ID.toBase58()) continue

      const mint = readTokenAccountMint(acc.data)
      const amount = readTokenAccountAmount(acc.data)
      if (!mint || amount === null || amount <= 0n) continue
      if (!token22MintsToCheck.has(mint)) continue

      token22EarnBalances.set(
        mint,
        (token22EarnBalances.get(mint) ?? 0n) + amount,
      )
    }

    const result: UserDefiPosition[] = []

    // ── Decode Earn positions ─────────────────────────────────────────────────
    for (const pool of earnPools) {
      const shares =
        splEarnBalances.get(pool.fTokenMint) ??
        token22EarnBalances.get(pool.fTokenMint) ??
        0n

      if (shares === 0n) continue

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
