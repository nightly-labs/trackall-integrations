import { BorshCoder } from '@coral-xyz/anchor'
import { AMM_V4, API_URLS } from '@raydium-io/raydium-sdk-v2'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import type {
  ConcentratedRangeLiquidityDefiPosition,
  ConstantProductLiquidityDefiPosition,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

import clmmIdl from './idls/amm_v3.json'
import cpIdl from './idls/raydium_cp_swap.json'

export const testAddress = '93PSyNrS7zBhrXaHHfU1ZtfegcKq5SaCYc35ZwPVrK3K'

// ─── Program IDs ─────────────────────────────────────────────────────────────
const CLMM_PROGRAM = new PublicKey(clmmIdl.address)
const CP_PROGRAM_ID = cpIdl.address

export const RAYDIUM_INDEXED_PROGRAMS = [
  CLMM_PROGRAM.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

// ─── Discriminators (from IDL) ───────────────────────────────────────────────
function idlDiscriminator(
  idl: { accounts?: Array<{ name: string; discriminator?: number[] }> },
  accountName: string,
): number[] {
  const disc = idl.accounts?.find((a) => a.name === accountName)?.discriminator
  if (!disc) throw new Error(`Missing discriminator for "${accountName}"`)
  return disc
}

const PERSONAL_POSITION_DISC = Buffer.from(
  idlDiscriminator(clmmIdl, 'PersonalPositionState'),
)

// ─── BorshCoder for PersonalPositionState ────────────────────────────────────
const clmmCoder = new BorshCoder(clmmIdl as never)

// ─── Manual offset helpers ───────────────────────────────────────────────────
function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.slice(offset, offset + 32)).toBase58()
}

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset)
}

function readU128LE(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset)
  const hi = buf.readBigUInt64LE(offset + 8)
  return lo | (hi << 64n)
}

function readI32LE(buf: Buffer, offset: number): number {
  return buf.readInt32LE(offset)
}

function readU16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset)
}

// ─── CLMM PoolState manual offsets (repr(C, packed), 8-byte discriminator) ──
function decodeClmmPool(buf: Buffer) {
  return {
    tokenMint0: readPubkey(buf, 73),
    tokenMint1: readPubkey(buf, 105),
    mintDecimals0: buf.readUInt8(233),
    mintDecimals1: buf.readUInt8(234),
    tickSpacing: readU16LE(buf, 235),
    liquidity: readU128LE(buf, 237),
    sqrtPriceX64: readU128LE(buf, 253),
    tickCurrent: readI32LE(buf, 269),
  }
}

// ─── CLMM math (Uniswap v3 style with Q64.64 BigInt) ────────────────────────
const Q64 = 1n << 64n

/**
 * Compute sqrt(1.0001^tick) as a Q64.64 fixed-point value.
 * Uses the identity: sqrtPrice = 1.0001^(tick/2)
 * We compute this with floating point then convert to Q64.
 */
function tickToSqrtPriceX64(tick: number): bigint {
  const sqrtPrice = 1.0001 ** (tick / 2)
  // Convert to Q64.64
  return BigInt(Math.round(sqrtPrice * Number(Q64)))
}

/**
 * Compute token amounts from a CLMM position using BigInt Q64 arithmetic.
 */
function computeClmmAmounts(
  liquidity: bigint,
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
  sqrtPriceX64: bigint,
): { amount0: bigint; amount1: bigint } {
  const sqrtPriceLowerX64 = tickToSqrtPriceX64(tickLower)
  const sqrtPriceUpperX64 = tickToSqrtPriceX64(tickUpper)

  let amount0 = 0n
  let amount1 = 0n

  if (tickCurrent < tickLower) {
    // All token0: L * (1/sqrtLower - 1/sqrtUpper) = L * Q64 * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper)
    amount0 =
      (liquidity * Q64 * (sqrtPriceUpperX64 - sqrtPriceLowerX64)) /
      (sqrtPriceLowerX64 * sqrtPriceUpperX64)
  } else if (tickCurrent >= tickUpper) {
    // All token1: L * (sqrtUpper - sqrtLower) / Q64
    amount1 = (liquidity * (sqrtPriceUpperX64 - sqrtPriceLowerX64)) / Q64
  } else {
    // Mixed: current price is in range
    amount0 =
      (liquidity * Q64 * (sqrtPriceUpperX64 - sqrtPriceX64)) /
      (sqrtPriceX64 * sqrtPriceUpperX64)
    amount1 = (liquidity * (sqrtPriceX64 - sqrtPriceLowerX64)) / Q64
  }

  return { amount0, amount1 }
}

/**
 * Compute price from sqrtPriceX64: price = (sqrtPriceX64 / 2^64)^2 * 10^(decimals0 - decimals1)
 */
function sqrtPriceX64ToPrice(
  sqrtPriceX64: bigint,
  decimals0: number,
  decimals1: number,
): number {
  const sqrtPrice = Number(sqrtPriceX64) / Number(Q64)
  return sqrtPrice * sqrtPrice * 10 ** (decimals0 - decimals1)
}

function tickToPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
): number {
  return 1.0001 ** tick * 10 ** (decimals0 - decimals1)
}

// ─── SPL token account reading ───────────────────────────────────────────────
function readTokenAccountMint(data: Uint8Array): string | null {
  const buf = Buffer.from(data)
  if (buf.length < 32) return null
  return readPubkey(buf, 0)
}

function readTokenAccountAmount(data: Uint8Array): bigint | null {
  const buf = Buffer.from(data)
  if (buf.length < 72) return null
  return readU64LE(buf, 64)
}

function readMintSupply(data: Uint8Array): bigint | null {
  const buf = Buffer.from(data)
  if (buf.length < 44) return null
  return readU64LE(buf, 36)
}

interface RaydiumPoolSearchLpItem {
  id?: unknown
  programId?: unknown
  lpMint?: unknown
}

interface RaydiumPoolKeyItem {
  id?: unknown
  programId?: unknown
  mintA?: unknown
  mintB?: unknown
  mintLp?: unknown
  lpMint?: unknown
  vault?: unknown
}

function readRaydiumLpMint(pool: RaydiumPoolSearchLpItem): string | null {
  const lpMint = pool.lpMint
  if (typeof lpMint === 'string') return lpMint
  if (lpMint && typeof lpMint === 'object' && 'address' in lpMint) {
    const address = (lpMint as { address?: unknown }).address
    if (typeof address === 'string') return address
  }
  return null
}

const LP_QUERY_CHUNK_SIZE = 20
const POOL_KEYS_QUERY_CHUNK_SIZE = 100

function readRaydiumTokenAddress(token: unknown): string | null {
  if (typeof token === 'string') return token
  if (token && typeof token === 'object' && 'address' in token) {
    const address = (token as { address?: unknown }).address
    if (typeof address === 'string') return address
  }
  return null
}

function readRaydiumTokenDecimals(token: unknown): number | null {
  if (token && typeof token === 'object' && 'decimals' in token) {
    const decimals = (token as { decimals?: unknown }).decimals
    if (typeof decimals === 'number' && Number.isFinite(decimals))
      return decimals
  }
  return null
}

function readRaydiumVaultAddress(
  poolKey: RaydiumPoolKeyItem,
  side: 'A' | 'B',
): string | null {
  const vault = poolKey.vault
  if (vault && typeof vault === 'object') {
    const field = (vault as { A?: unknown; B?: unknown })[side]
    if (typeof field === 'string') return field
  }
  return null
}

function readRaydiumPoolLpMint(poolKey: RaydiumPoolKeyItem): string | null {
  return (
    readRaydiumTokenAddress(poolKey.mintLp) ??
    readRaydiumTokenAddress(poolKey.lpMint)
  )
}

function decodeHttpJsonRows<T>(
  map: Record<string, { exists: boolean; data?: Uint8Array }>,
): T[] {
  const rows: T[] = []
  for (const acc of Object.values(map)) {
    if (!acc?.exists || !acc.data) continue
    try {
      const parsed = JSON.parse(Buffer.from(acc.data).toString('utf8')) as T
      rows.push(parsed)
    } catch {
      // Skip malformed JSON rows from HTTP adapter.
    }
  }
  return rows
}

// ─── Integration ─────────────────────────────────────────────────────────────

export const raydiumIntegration: SolanaIntegration = {
  platformId: 'raydium',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const walletPubkey = new PublicKey(address)

    // ── Phase 0: Get user's SPL + Token-2022 accounts in parallel ─────────
    const userTokenMap = yield [
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: walletPubkey.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: walletPubkey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      },
    ]

    // Build mint → amount maps from merged token accounts:
    // - all balances for CP/AMM paths
    // - Token-2022-only balances for CLMM position NFT PDAs
    const userMintBalances = new Map<string, bigint>()
    const userToken2022MintBalances = new Map<string, bigint>()
    const token2022ProgramId = TOKEN_2022_PROGRAM_ID.toBase58()
    for (const acc of Object.values(userTokenMap)) {
      if (!acc.exists) continue
      const mint = readTokenAccountMint(acc.data)
      const amount = readTokenAccountAmount(acc.data)
      if (mint && amount !== null && amount > 0n) {
        const existing = userMintBalances.get(mint)
        userMintBalances.set(
          mint,
          existing !== undefined ? existing + amount : amount,
        )

        if (acc.programAddress === token2022ProgramId) {
          const existingToken2022 = userToken2022MintBalances.get(mint)
          userToken2022MintBalances.set(
            mint,
            existingToken2022 !== undefined
              ? existingToken2022 + amount
              : amount,
          )
        }
      }
    }

    if (userMintBalances.size === 0) return []

    interface CpPoolMatch {
      poolAddress: string
      token0Mint: string
      token1Mint: string
      token0Vault: string
      token1Vault: string
      lpMint: string
      mintDecimals0: number
      mintDecimals1: number
      userLpAmount: bigint
    }

    interface AmmV4Match {
      poolAddress: string
      baseMint: string
      quoteMint: string
      baseVault: string
      quoteVault: string
      baseDecimal: number
      quoteDecimal: number
      lpMint: string
      userLpAmount: bigint
    }

    const cpMatches: CpPoolMatch[] = []
    const ammV4Matches: AmmV4Match[] = []
    const cpVaultAddresses: string[] = []
    const cpLpMintAddresses: string[] = []
    const ammV4VaultAddresses: string[] = []
    const ammV4LpMintAddresses: string[] = []

    // Derive CLMM PDAs only for token-2022 NFT balances (amount == 1).
    const clmmPdaEntries: { mint: string; pda: string }[] = []
    for (const [mint, amount] of userToken2022MintBalances) {
      if (amount !== 1n) continue
      try {
        const mintPubkey = new PublicKey(mint)
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from('position'), mintPubkey.toBuffer()],
          CLMM_PROGRAM,
        )
        clmmPdaEntries.push({ mint, pda: pda.toBase58() })
      } catch {
        // invalid mint key, skip
      }
    }

    const lpMintList = [...userMintBalances.keys()]
    const lpPoolRequests: Array<{
      kind: 'getHttpJson'
      url: string
      keyField: string
    }> = []
    for (let i = 0; i < lpMintList.length; i += LP_QUERY_CHUNK_SIZE) {
      const chunk = lpMintList.slice(i, i + LP_QUERY_CHUNK_SIZE)
      if (chunk.length === 0) continue
      const url = new URL(API_URLS.POOL_SEARCH_LP, API_URLS.BASE_HOST)
      url.searchParams.set('lps', chunk.join(','))
      lpPoolRequests.push({
        kind: 'getHttpJson',
        url: url.toString(),
        keyField: 'id',
      })
    }

    const lpPoolsMap = lpPoolRequests.length > 0 ? yield lpPoolRequests : {}
    const discoveredPools =
      decodeHttpJsonRows<RaydiumPoolSearchLpItem>(lpPoolsMap)
    const cpPoolLpAmountByAddress = new Map<string, bigint>()
    const ammV4PoolLpAmountByAddress = new Map<string, bigint>()

    for (const pool of discoveredPools) {
      if (!pool) {
        continue
      }
      if (typeof pool.id !== 'string' || typeof pool.programId !== 'string') {
        continue
      }
      const lpMint = readRaydiumLpMint(pool)

      if (!lpMint) {
        continue
      }
      const userLpAmount = userMintBalances.get(lpMint)

      if (userLpAmount === undefined || userLpAmount <= 0n) {
        continue
      }

      if (pool.programId === CP_PROGRAM_ID) {
        cpPoolLpAmountByAddress.set(pool.id, userLpAmount)
      } else if (pool.programId === AMM_V4.toBase58()) {
        ammV4PoolLpAmountByAddress.set(pool.id, userLpAmount)
      }
    }

    const cpPoolAddresses = [...cpPoolLpAmountByAddress.keys()]
    const ammV4PoolAddresses = [...ammV4PoolLpAmountByAddress.keys()]
    const discoveredPoolIds = [
      ...new Set([...cpPoolAddresses, ...ammV4PoolAddresses]),
    ]
    const poolKeyRequests: Array<{
      kind: 'getHttpJson'
      url: string
      keyField: string
    }> = []
    for (
      let i = 0;
      i < discoveredPoolIds.length;
      i += POOL_KEYS_QUERY_CHUNK_SIZE
    ) {
      const chunk = discoveredPoolIds.slice(i, i + POOL_KEYS_QUERY_CHUNK_SIZE)
      if (chunk.length === 0) continue
      const url = new URL(API_URLS.POOL_KEY_BY_ID, API_URLS.BASE_HOST)
      url.searchParams.set('ids', chunk.join(','))
      poolKeyRequests.push({
        kind: 'getHttpJson',
        url: url.toString(),
        keyField: 'id',
      })
    }
    const poolKeysMap = poolKeyRequests.length > 0 ? yield poolKeyRequests : {}
    const discoveredPoolKeys =
      decodeHttpJsonRows<RaydiumPoolKeyItem>(poolKeysMap)
    const poolKeyById = new Map<string, RaydiumPoolKeyItem>()
    for (const poolKey of discoveredPoolKeys) {
      if (typeof poolKey.id !== 'string') continue
      poolKeyById.set(poolKey.id, poolKey)
    }

    // ── Phase 1: Batch fetch CLMM PDAs ──────────────────────────────────────
    const phase2Addresses = [...clmmPdaEntries.map((e) => e.pda)]
    if (phase2Addresses.length === 0) return []

    const phase2Map = yield phase2Addresses

    // Decode CLMM PersonalPositionState accounts
    interface ClmmPosition {
      poolId: string
      tickLower: number
      tickUpper: number
      liquidity: bigint
    }

    const clmmPositions: ClmmPosition[] = []
    const uniquePoolIds = new Set<string>()

    for (const entry of clmmPdaEntries) {
      const acc = phase2Map[entry.pda]
      if (!acc?.exists) continue
      const buf = Buffer.from(acc.data)
      // Verify discriminator
      if (buf.length < 8 || !buf.slice(0, 8).equals(PERSONAL_POSITION_DISC))
        continue
      try {
        const decoded = clmmCoder.accounts.decode('PersonalPositionState', buf)
        const liquidity = BigInt(
          (decoded.liquidity as { toString(): string }).toString(),
        )
        if (liquidity === 0n) continue
        const poolId = (decoded.pool_id as PublicKey).toBase58()
        clmmPositions.push({
          poolId,
          tickLower: decoded.tick_lower_index as number,
          tickUpper: decoded.tick_upper_index as number,
          liquidity,
        })
        uniquePoolIds.add(poolId)
      } catch {
        // skip decode failures
      }
    }

    // Decode discovered CP pools from API registry
    for (const poolAddress of cpPoolAddresses) {
      const poolKey = poolKeyById.get(poolAddress)
      const userLpAmount = cpPoolLpAmountByAddress.get(poolAddress)
      if (!poolKey || userLpAmount === undefined) continue

      const token0Mint = readRaydiumTokenAddress(poolKey.mintA)
      const token1Mint = readRaydiumTokenAddress(poolKey.mintB)
      const token0Vault = readRaydiumVaultAddress(poolKey, 'A')
      const token1Vault = readRaydiumVaultAddress(poolKey, 'B')
      const lpMint = readRaydiumPoolLpMint(poolKey)
      const mintDecimals0 = readRaydiumTokenDecimals(poolKey.mintA)
      const mintDecimals1 = readRaydiumTokenDecimals(poolKey.mintB)

      if (
        !token0Mint ||
        !token1Mint ||
        !token0Vault ||
        !token1Vault ||
        !lpMint ||
        mintDecimals0 === null ||
        mintDecimals1 === null
      )
        continue

      cpMatches.push({
        poolAddress,
        token0Mint,
        token1Mint,
        token0Vault,
        token1Vault,
        lpMint,
        mintDecimals0,
        mintDecimals1,
        userLpAmount,
      })
      cpVaultAddresses.push(token0Vault, token1Vault)
      cpLpMintAddresses.push(lpMint)
    }

    // Decode discovered AMM v4 pools from API registry
    for (const poolAddress of ammV4PoolAddresses) {
      const poolKey = poolKeyById.get(poolAddress)
      const userLpAmount = ammV4PoolLpAmountByAddress.get(poolAddress)
      if (!poolKey || userLpAmount === undefined) continue

      const baseMint = readRaydiumTokenAddress(poolKey.mintA)
      const quoteMint = readRaydiumTokenAddress(poolKey.mintB)
      const baseVault = readRaydiumVaultAddress(poolKey, 'A')
      const quoteVault = readRaydiumVaultAddress(poolKey, 'B')
      const lpMint = readRaydiumPoolLpMint(poolKey)
      const baseDecimal = readRaydiumTokenDecimals(poolKey.mintA)
      const quoteDecimal = readRaydiumTokenDecimals(poolKey.mintB)

      if (
        !baseMint ||
        !quoteMint ||
        !baseVault ||
        !quoteVault ||
        !lpMint ||
        baseDecimal === null ||
        quoteDecimal === null
      )
        continue

      ammV4Matches.push({
        poolAddress,
        baseMint,
        quoteMint,
        baseVault,
        quoteVault,
        baseDecimal,
        quoteDecimal,
        lpMint,
        userLpAmount,
      })
      ammV4VaultAddresses.push(baseVault, quoteVault)
      ammV4LpMintAddresses.push(lpMint)
    }

    // ── Phase 2: Fetch CLMM pool states + CP/AMM vault states ───────────────
    const clmmPoolAddresses = [...uniquePoolIds]

    if (
      clmmPositions.length === 0 &&
      cpMatches.length === 0 &&
      ammV4Matches.length === 0
    )
      return []

    const phase3Addresses = [
      ...clmmPoolAddresses,
      ...cpVaultAddresses,
      ...cpLpMintAddresses,
      ...ammV4VaultAddresses,
      ...ammV4LpMintAddresses,
    ]

    const phase3Map = phase3Addresses.length > 0 ? yield phase3Addresses : {}

    const result: UserDefiPosition[] = []

    // ── Build CLMM positions ─────────────────────────────────────────────────
    for (const pos of clmmPositions) {
      const poolAcc = phase3Map[pos.poolId]
      if (!poolAcc?.exists) continue
      const poolBuf = Buffer.from(poolAcc.data)
      if (poolBuf.length < 273) continue
      const pool = decodeClmmPool(poolBuf)

      const { amount0, amount1 } = computeClmmAmounts(
        pos.liquidity,
        pool.tickCurrent,
        pos.tickLower,
        pos.tickUpper,
        pool.sqrtPriceX64,
      )

      const currentPrice = sqrtPriceX64ToPrice(
        pool.sqrtPriceX64,
        pool.mintDecimals0,
        pool.mintDecimals1,
      )
      const lowerPrice = tickToPrice(
        pos.tickLower,
        pool.mintDecimals0,
        pool.mintDecimals1,
      )
      const upperPrice = tickToPrice(
        pos.tickUpper,
        pool.mintDecimals0,
        pool.mintDecimals1,
      )

      const token0Info = tokens.get(pool.tokenMint0)
      const token1Info = tokens.get(pool.tokenMint1)

      const usdValue0 =
        token0Info?.priceUsd !== undefined
          ? (Number(amount0) / 10 ** pool.mintDecimals0) * token0Info.priceUsd
          : undefined
      const usdValue1 =
        token1Info?.priceUsd !== undefined
          ? (Number(amount1) / 10 ** pool.mintDecimals1) * token1Info.priceUsd
          : undefined

      const usdValue =
        usdValue0 !== undefined && usdValue1 !== undefined
          ? (usdValue0 + usdValue1).toString()
          : usdValue0 !== undefined
            ? usdValue0.toString()
            : usdValue1 !== undefined
              ? usdValue1.toString()
              : undefined

      result.push({
        positionKind: 'liquidity',
        liquidityModel: 'concentrated-range',
        platformId: 'raydium',
        isActive:
          pos.tickLower <= pool.tickCurrent && pool.tickCurrent < pos.tickUpper,
        lowerPriceUsd: lowerPrice.toString(),
        upperPriceUsd: upperPrice.toString(),
        currentPriceUsd: currentPrice.toString(),
        ...(usdValue !== undefined && { usdValue }),
        poolTokens: [
          {
            amount: {
              token: pool.tokenMint0,
              amount: amount0.toString(),
              decimals: pool.mintDecimals0.toString(),
            },
            ...(token0Info?.priceUsd !== undefined && {
              priceUsd: token0Info.priceUsd.toString(),
            }),
            ...(usdValue0 !== undefined && { usdValue: usdValue0.toString() }),
          },
          {
            amount: {
              token: pool.tokenMint1,
              amount: amount1.toString(),
              decimals: pool.mintDecimals1.toString(),
            },
            ...(token1Info?.priceUsd !== undefined && {
              priceUsd: token1Info.priceUsd.toString(),
            }),
            ...(usdValue1 !== undefined && { usdValue: usdValue1.toString() }),
          },
        ],
        poolAddress: pos.poolId,
      } satisfies ConcentratedRangeLiquidityDefiPosition)
    }

    // ── Build CP swap positions ──────────────────────────────────────────────
    for (const cp of cpMatches) {
      const vault0Acc = phase3Map[cp.token0Vault]
      const vault1Acc = phase3Map[cp.token1Vault]
      const lpMintAcc = phase3Map[cp.lpMint]
      if (!vault0Acc?.exists || !vault1Acc?.exists || !lpMintAcc?.exists)
        continue

      const vault0Balance = readTokenAccountAmount(vault0Acc.data)
      const vault1Balance = readTokenAccountAmount(vault1Acc.data)
      const lpSupply = readMintSupply(lpMintAcc.data)
      if (vault0Balance === null || vault1Balance === null || lpSupply === null)
        continue
      if (lpSupply === 0n) continue

      const amount0 = (vault0Balance * cp.userLpAmount) / lpSupply
      const amount1 = (vault1Balance * cp.userLpAmount) / lpSupply

      const token0Info = tokens.get(cp.token0Mint)
      const token1Info = tokens.get(cp.token1Mint)

      const usdValue0 =
        token0Info?.priceUsd !== undefined
          ? (Number(amount0) / 10 ** cp.mintDecimals0) * token0Info.priceUsd
          : undefined
      const usdValue1 =
        token1Info?.priceUsd !== undefined
          ? (Number(amount1) / 10 ** cp.mintDecimals1) * token1Info.priceUsd
          : undefined

      const usdValue =
        usdValue0 !== undefined && usdValue1 !== undefined
          ? (usdValue0 + usdValue1).toString()
          : usdValue0 !== undefined
            ? usdValue0.toString()
            : usdValue1 !== undefined
              ? usdValue1.toString()
              : undefined

      result.push({
        positionKind: 'liquidity',
        liquidityModel: 'constant-product',
        platformId: 'raydium',
        ...(usdValue !== undefined && { usdValue }),
        poolTokens: [
          {
            amount: {
              token: cp.token0Mint,
              amount: amount0.toString(),
              decimals: cp.mintDecimals0.toString(),
            },
            ...(token0Info?.priceUsd !== undefined && {
              priceUsd: token0Info.priceUsd.toString(),
            }),
            ...(usdValue0 !== undefined && { usdValue: usdValue0.toString() }),
          },
          {
            amount: {
              token: cp.token1Mint,
              amount: amount1.toString(),
              decimals: cp.mintDecimals1.toString(),
            },
            ...(token1Info?.priceUsd !== undefined && {
              priceUsd: token1Info.priceUsd.toString(),
            }),
            ...(usdValue1 !== undefined && { usdValue: usdValue1.toString() }),
          },
        ],
        lpTokenAmount: cp.userLpAmount.toString(),
        poolAddress: cp.poolAddress,
      } satisfies ConstantProductLiquidityDefiPosition)
    }

    // ── Build AMM v4 (legacy) positions ─────────────────────────────────────
    for (const amm of ammV4Matches) {
      const baseVaultAcc = phase3Map[amm.baseVault]
      const quoteVaultAcc = phase3Map[amm.quoteVault]
      const lpMintAcc = phase3Map[amm.lpMint]
      if (!baseVaultAcc?.exists || !quoteVaultAcc?.exists || !lpMintAcc?.exists)
        continue

      const baseVaultBalance = readTokenAccountAmount(baseVaultAcc.data)
      const quoteVaultBalance = readTokenAccountAmount(quoteVaultAcc.data)
      const lpSupply = readMintSupply(lpMintAcc.data)
      if (
        baseVaultBalance === null ||
        quoteVaultBalance === null ||
        lpSupply === null
      )
        continue
      if (lpSupply === 0n) continue

      const amount0 = (baseVaultBalance * amm.userLpAmount) / lpSupply
      const amount1 = (quoteVaultBalance * amm.userLpAmount) / lpSupply

      const token0Info = tokens.get(amm.baseMint)
      const token1Info = tokens.get(amm.quoteMint)

      const usdValue0 =
        token0Info?.priceUsd !== undefined
          ? (Number(amount0) / 10 ** amm.baseDecimal) * token0Info.priceUsd
          : undefined
      const usdValue1 =
        token1Info?.priceUsd !== undefined
          ? (Number(amount1) / 10 ** amm.quoteDecimal) * token1Info.priceUsd
          : undefined

      const usdValue =
        usdValue0 !== undefined && usdValue1 !== undefined
          ? (usdValue0 + usdValue1).toString()
          : usdValue0 !== undefined
            ? usdValue0.toString()
            : usdValue1 !== undefined
              ? usdValue1.toString()
              : undefined

      result.push({
        positionKind: 'liquidity',
        liquidityModel: 'constant-product',
        platformId: 'raydium',
        ...(usdValue !== undefined && { usdValue }),
        poolTokens: [
          {
            amount: {
              token: amm.baseMint,
              amount: amount0.toString(),
              decimals: amm.baseDecimal.toString(),
            },
            ...(token0Info?.priceUsd !== undefined && {
              priceUsd: token0Info.priceUsd.toString(),
            }),
            ...(usdValue0 !== undefined && { usdValue: usdValue0.toString() }),
          },
          {
            amount: {
              token: amm.quoteMint,
              amount: amount1.toString(),
              decimals: amm.quoteDecimal.toString(),
            },
            ...(token1Info?.priceUsd !== undefined && {
              priceUsd: token1Info.priceUsd.toString(),
            }),
            ...(usdValue1 !== undefined && { usdValue: usdValue1.toString() }),
          },
        ],
        lpTokenAmount: amm.userLpAmount.toString(),
        poolAddress: amm.poolAddress,
      } satisfies ConstantProductLiquidityDefiPosition)
    }

    return result
  },
}

export default raydiumIntegration
