import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { borrowPda } from '@jup-ag/lend'
import { INIT_TICK, MIN_TICK, ZERO_TICK_SCALED_RATIO, getRatioAtTick } from '@jup-ag/lend/borrow'
import BN from 'bn.js'

import type {
  LendingBorrowedAsset,
  LendingDefiPosition,
  LendingSuppliedAsset,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../types/index'

export const testAddress = 'BsYDTmksyvTWpP3DGSWpoAXP7ykFDhikYdKEVspkStc4'

// ─── Program IDs ─────────────────────────────────────────────────────────────
const LENDING_PROGRAM_ID = 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9'
const VAULTS_PROGRAM_ID = 'jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi'

// ─── Anchor account discriminators (sha256("account:<name>")[0..8]) ──────────
const LENDING_DISC = Buffer.from([135, 199, 82, 16, 249, 131, 182, 241])
const POSITION_DISC = Buffer.from([170, 188, 143, 228, 122, 64, 247, 208])

// ─── Exchange precision (1e12) ────────────────────────────────────────────────
const EXCHANGE_PRECISION = BigInt('1000000000000')
const ZERO_TICK_BN = ZERO_TICK_SCALED_RATIO // imported from @jup-ag/lend/borrow
const INIT_TICK_VALUE = INIT_TICK // -2147483648
const MIN_TICK_VALUE = MIN_TICK // -16383

// ─── Lending (earn) account layout — Borsh, 196 bytes ────────────────────────
// [0-7]    discriminator
// [8-39]   mint: pubkey
// [40-71]  fTokenMint: pubkey
// [74]     decimals: u8
// [115-122] tokenExchangePrice: u64
const L_MINT = 8
const L_FTOKEN_MINT = 40
const L_DECIMALS = 74
const L_TOKEN_EXCHANGE_PRICE = 115

// ─── Position (vault CDP) layout — bytemuck packed, 71 bytes ─────────────────
// [0-7]  discriminator
// [8-9]  vaultId: u16
// [14-45] positionMint: pubkey
// [46]   isSupplyOnlyPosition: u8
// [47-50] tick: i32
// [55-62] supplyAmount: u64
// [63-70] dustDebtAmount: u64
const P_VAULT_ID = 8
const P_POSITION_MINT = 14
const P_IS_SUPPLY_ONLY = 46
const P_TICK = 47
const P_SUPPLY_AMOUNT = 55
const P_DUST_DEBT = 63

// ─── VaultConfig layout — bytemuck packed, 219 bytes ─────────────────────────
// [154-185] supplyToken: pubkey  (collateral mint)
// [186-217] borrowToken: pubkey  (debt mint)
const VC_SUPPLY_TOKEN = 154
const VC_BORROW_TOKEN = 186

// ─── VaultState layout — bytemuck packed, 127 bytes ──────────────────────────
// [99-106]  vaultSupplyExchangePrice: u64
// [107-114] vaultBorrowExchangePrice: u64
const VS_VAULT_SUPPLY_EX_PRICE = 99
const VS_VAULT_BORROW_EX_PRICE = 107

// ─── VaultMetadata layout — Borsh, 44 bytes ───────────────────────────────────
// [42] supplyMintDecimals: u8
// [43] borrowMintDecimals: u8
const VM_SUPPLY_DECIMALS = 42
const VM_BORROW_DECIMALS = 43

// SPL token account: amount at offset 64 (same for SPL and Token-2022)
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64
// SPL token account: mint at offset 0, owner at offset 32
const TOKEN_ACCOUNT_MINT_OFFSET = 0

// ─── Helpers ─────────────────────────────────────────────────────────────────

function discBase64(disc: Buffer): string {
  return disc.toString('base64')
}

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58()
}

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset)
}

function decodeLendingAccount(data: Uint8Array) {
  const buf = Buffer.from(data)
  if (buf.length < 123 || !buf.slice(0, 8).equals(LENDING_DISC)) return null
  return {
    mint: readPubkey(buf, L_MINT),
    fTokenMint: readPubkey(buf, L_FTOKEN_MINT),
    decimals: buf.readUInt8(L_DECIMALS),
    tokenExchangePrice: readU64LE(buf, L_TOKEN_EXCHANGE_PRICE),
  }
}

function decodePositionAccount(data: Uint8Array) {
  const buf = Buffer.from(data)
  if (buf.length < 71 || !buf.slice(0, 8).equals(POSITION_DISC)) return null
  return {
    vaultId: buf.readUInt16LE(P_VAULT_ID),
    positionMint: readPubkey(buf, P_POSITION_MINT),
    isSupplyOnly: buf.readUInt8(P_IS_SUPPLY_ONLY) !== 0,
    tick: buf.readInt32LE(P_TICK),
    supplyAmount: readU64LE(buf, P_SUPPLY_AMOUNT),
    dustDebtAmount: readU64LE(buf, P_DUST_DEBT),
  }
}

function decodeVaultConfig(data: Uint8Array) {
  const buf = Buffer.from(data)
  if (buf.length < 219) return null
  return {
    supplyToken: readPubkey(buf, VC_SUPPLY_TOKEN),
    borrowToken: readPubkey(buf, VC_BORROW_TOKEN),
  }
}

function decodeVaultState(data: Uint8Array) {
  const buf = Buffer.from(data)
  if (buf.length < 127) return null
  return {
    vaultSupplyExchangePrice: readU64LE(buf, VS_VAULT_SUPPLY_EX_PRICE),
    vaultBorrowExchangePrice: readU64LE(buf, VS_VAULT_BORROW_EX_PRICE),
  }
}

function decodeVaultMetadata(data: Uint8Array) {
  const buf = Buffer.from(data)
  if (buf.length < 44) return null
  return {
    supplyDecimals: buf.readUInt8(VM_SUPPLY_DECIMALS),
    borrowDecimals: buf.readUInt8(VM_BORROW_DECIMALS),
  }
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
 * netDebtRaw = colRaw * getRatioAtTick(tick) / ZERO_TICK_SCALED_RATIO
 * Total debt raw = netDebtRaw + dustDebtAmount.
 */
function computeNetDebtRaw(supplyAmount: bigint, tick: number, isSupplyOnly: boolean): bigint {
  if (isSupplyOnly || tick === INIT_TICK_VALUE || tick <= MIN_TICK_VALUE) return 0n
  const colBN = new BN(supplyAmount.toString())
  const ratio = getRatioAtTick(tick)
  return BigInt(colBN.mul(ratio).divRound(ZERO_TICK_BN).toString())
}

// ─── Integration ─────────────────────────────────────────────────────────────

export const jupiterLendIntegration: SolanaIntegration = {
  platformId: 'jupiter-lend',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const walletPubkey = new PublicKey(address)

    // ── Phase 0a: Earn — discover all lending pool accounts ──────────────────
    const lendingMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: LENDING_PROGRAM_ID,
      filters: [{ memcmp: { offset: 0, bytes: discBase64(LENDING_DISC), encoding: 'base64' } }],
    }

    const earnPools: {
      mint: string
      fTokenMint: string
      decimals: number
      tokenExchangePrice: bigint
    }[] = []

    for (const acc of Object.values(lendingMap)) {
      if (!acc.exists) continue
      const d = decodeLendingAccount(acc.data)
      if (d) earnPools.push(d)
    }

    // ── Phase 0b: Get all of the user's SPL token accounts ───────────────────
    // This tells us earn balances (for SPL fTokens) AND which positionMint NFTs
    // the user holds — without fetching ATAs for every possible position.
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

    // ── Phase 0c: Vault positions — all CDP positions in the vaults program ──
    // We cross-reference positionMint (stored inside each account) against the
    // user's held mints — no ATA scan needed.
    const positionsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: VAULTS_PROGRAM_ID,
      filters: [{ memcmp: { offset: 0, bytes: discBase64(POSITION_DISC), encoding: 'base64' } }],
    }

    const ownedPositions: {
      vaultId: number
      positionMint: string
      isSupplyOnly: boolean
      tick: number
      supplyAmount: bigint
      dustDebtAmount: bigint
    }[] = []
    const uniqueVaultIds = new Set<number>()

    for (const acc of Object.values(positionsMap)) {
      if (!acc.exists) continue
      const d = decodePositionAccount(acc.data)
      if (!d || d.supplyAmount === 0n) continue
      // The user owns this position if they hold the positionMint NFT (amount=1)
      if (userMintBalances.get(d.positionMint) !== 1n) continue
      ownedPositions.push(d)
      uniqueVaultIds.add(d.vaultId)
    }

    // ── Phase 1: Small targeted fetch ────────────────────────────────────────
    // Only: Token-2022 earn ATAs (rare) + vault config/state/meta per owned vault
    const t22ATAs = needsToken22Check.map((fTokenMint) =>
      getAssociatedTokenAddressSync(
        new PublicKey(fTokenMint),
        walletPubkey,
        true,
        TOKEN_2022_PROGRAM_ID,
      ).toBase58(),
    )

    const vaultIds = [...uniqueVaultIds]
    const vaultConfigAddrs = vaultIds.map((id) => borrowPda.getVaultConfig(id).toBase58())
    const vaultStateAddrs = vaultIds.map((id) => borrowPda.getVaultState(id).toBase58())
    const vaultMetaAddrs = vaultIds.map((id) => borrowPda.getVaultMetadata(id).toBase58())

    const phase1Map = yield [...t22ATAs, ...vaultConfigAddrs, ...vaultStateAddrs, ...vaultMetaAddrs]

    const result: UserDefiPosition[] = []

    // ── Decode Earn positions ─────────────────────────────────────────────────
    for (let i = 0; i < earnPools.length; i++) {
      const pool = earnPools[i]!

      // SPL balance (found in Phase 0b), or Token-2022 balance (fetched in Phase 1)
      let shares = splEarnBalances.get(pool.fTokenMint)
      if (shares === undefined) {
        const t22Idx = needsToken22Check.indexOf(pool.fTokenMint)
        if (t22Idx >= 0) {
          const ataAcc = phase1Map[t22ATAs[t22Idx]!]
          if (ataAcc?.exists) shares = readTokenAccountAmount(ataAcc.data) ?? 0n
        }
      }
      if (!shares || shares === 0n) continue

      // underlying = shares × tokenExchangePrice / 1e12
      const underlying = (shares * pool.tokenExchangePrice) / EXCHANGE_PRECISION
      if (underlying === 0n) continue

      const tokenInfo = tokens.get(pool.mint)
      const priceUsd = tokenInfo?.priceUsd
      const usdValue =
        priceUsd !== undefined
          ? ((Number(underlying) / 10 ** pool.decimals) * priceUsd).toString()
          : undefined

      const supplied: LendingSuppliedAsset = {
        amount: { token: pool.mint, amount: underlying.toString(), decimals: pool.decimals.toString() },
        ...(priceUsd !== undefined && { priceUsd: priceUsd.toString() }),
        ...(usdValue !== undefined && { usdValue }),
      }

      result.push({
        positionKind: 'lending',
        platformId: 'jupiter-lend',
        supplied: [supplied],
        ...(usdValue !== undefined && { valueUsd: usdValue }),
      } satisfies LendingDefiPosition)
    }

    // ── Decode CDP vault positions ────────────────────────────────────────────
    const vaultConfigMap = new Map<number, ReturnType<typeof decodeVaultConfig> & object>()
    const vaultStateMap = new Map<number, ReturnType<typeof decodeVaultState> & object>()
    const vaultMetaMap = new Map<number, ReturnType<typeof decodeVaultMetadata> & object>()

    for (let i = 0; i < vaultIds.length; i++) {
      const id = vaultIds[i]!
      const cfgAcc = phase1Map[vaultConfigAddrs[i]!]
      const stateAcc = phase1Map[vaultStateAddrs[i]!]
      const metaAcc = phase1Map[vaultMetaAddrs[i]!]
      if (cfgAcc?.exists) {
        const d = decodeVaultConfig(cfgAcc.data)
        if (d) vaultConfigMap.set(id, d)
      }
      if (stateAcc?.exists) {
        const d = decodeVaultState(stateAcc.data)
        if (d) vaultStateMap.set(id, d)
      }
      if (metaAcc?.exists) {
        const d = decodeVaultMetadata(metaAcc.data)
        if (d) vaultMetaMap.set(id, d)
      }
    }

    for (const pos of ownedPositions) {
      const cfg = vaultConfigMap.get(pos.vaultId)
      const state = vaultStateMap.get(pos.vaultId)
      const meta = vaultMetaMap.get(pos.vaultId)
      if (!cfg || !state) continue

      const supplyDecimals = meta?.supplyDecimals ?? 6
      const borrowDecimals = meta?.borrowDecimals ?? 6

      // colAmount = supplyAmount × vaultSupplyExchangePrice / 1e12
      const colAmount = (pos.supplyAmount * state.vaultSupplyExchangePrice) / EXCHANGE_PRECISION

      // netDebtRaw recovered from tick, total = net + dust (absorbed liquidation debt)
      const netDebtRaw = computeNetDebtRaw(pos.supplyAmount, pos.tick, pos.isSupplyOnly)
      const totalDebtRaw = netDebtRaw + pos.dustDebtAmount
      const debtAmount = (totalDebtRaw * state.vaultBorrowExchangePrice) / EXCHANGE_PRECISION

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
        ...(supplyPriceUsd !== undefined && { priceUsd: supplyPriceUsd.toString() }),
        ...(colUsd !== undefined && { usdValue: colUsd.toString() }),
      }

      const positionResult: LendingDefiPosition = {
        positionKind: 'lending',
        platformId: 'jupiter-lend',
        supplied: [supplied],
        ...(colUsd !== undefined && { valueUsd: colUsd.toString() }),
      }

      if (debtAmount > 0n) {
        const borrowed: LendingBorrowedAsset = {
          amount: {
            token: cfg.borrowToken,
            amount: debtAmount.toString(),
            decimals: borrowDecimals.toString(),
          },
          ...(borrowPriceUsd !== undefined && { priceUsd: borrowPriceUsd.toString() }),
          ...(debtUsd !== undefined && { usdValue: debtUsd.toString() }),
        }
        positionResult.borrowed = [borrowed]
        if (colUsd !== undefined && debtUsd !== undefined) {
          positionResult.valueUsd = (colUsd - debtUsd).toString()
        }
      }

      result.push(positionResult)
    }

    return result
  },
}

export default jupiterLendIntegration
