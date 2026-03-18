import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { BorshCoder } from '@coral-xyz/anchor'
import { AMM_V4, liquidityStateV4Layout } from '@raydium-io/raydium-sdk-v2'

import type {
  ConcentratedRangeLiquidityDefiPosition,
  ConstantProductLiquidityDefiPosition,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan
} from '../../types/index'

import clmmIdl from './idls/amm_v3.json'
import cpIdl from './idls/raydium_cp_swap.json'

export const testAddress = '93PSyNrS7zBhrXaHHfU1ZtfegcKq5SaCYc35ZwPVrK3K'

// ─── Program IDs ─────────────────────────────────────────────────────────────
const CLMM_PROGRAM = new PublicKey(clmmIdl.address)
const CP_PROGRAM_ID = cpIdl.address

// ─── Discriminators (from IDL) ───────────────────────────────────────────────
function idlDiscriminator(
  idl: { accounts?: Array<{ name: string; discriminator?: number[] }> },
  accountName: string
): number[] {
  const disc = idl.accounts?.find(a => a.name === accountName)?.discriminator
  if (!disc) throw new Error(`Missing discriminator for "${accountName}"`)
  return disc
}

const PERSONAL_POSITION_DISC = Buffer.from(idlDiscriminator(clmmIdl, 'PersonalPositionState'))
const CP_POOL_DISC_B64 = Buffer.from(idlDiscriminator(cpIdl, 'PoolState')).toString('base64')

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
    mintDecimals0: buf[233]!,
    mintDecimals1: buf[234]!,
    tickSpacing: readU16LE(buf, 235),
    liquidity: readU128LE(buf, 237),
    sqrtPriceX64: readU128LE(buf, 253),
    tickCurrent: readI32LE(buf, 269)
  }
}

// ─── CP PoolState manual offsets (repr(C, packed), 8-byte discriminator) ─────
function decodeCpPool(buf: Buffer) {
  return {
    token0Vault: readPubkey(buf, 72),
    token1Vault: readPubkey(buf, 104),
    lpMint: readPubkey(buf, 136),
    token0Mint: readPubkey(buf, 168),
    token1Mint: readPubkey(buf, 200),
    mintDecimals0: buf[331]!,
    mintDecimals1: buf[332]!,
    lpSupply: readU64LE(buf, 333)
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
  const sqrtPrice = Math.pow(1.0001, tick / 2)
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
  sqrtPriceX64: bigint
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
      (liquidity * Q64 * (sqrtPriceUpperX64 - sqrtPriceX64)) / (sqrtPriceX64 * sqrtPriceUpperX64)
    amount1 = (liquidity * (sqrtPriceX64 - sqrtPriceLowerX64)) / Q64
  }

  return { amount0, amount1 }
}

/**
 * Compute price from sqrtPriceX64: price = (sqrtPriceX64 / 2^64)^2 * 10^(decimals0 - decimals1)
 */
function sqrtPriceX64ToPrice(sqrtPriceX64: bigint, decimals0: number, decimals1: number): number {
  const sqrtPrice = Number(sqrtPriceX64) / Number(Q64)
  return sqrtPrice * sqrtPrice * 10 ** (decimals0 - decimals1)
}

function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimals0 - decimals1)
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

// ─── Integration ─────────────────────────────────────────────────────────────

export const raydiumIntegration: SolanaIntegration = {
  platformId: 'raydium',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins
  ): UserPositionsPlan {
    const walletPubkey = new PublicKey(address)

    // ── Phase 0: Get user's SPL + Token-2022 accounts in parallel ─────────
    const userTokenMap = yield [
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: walletPubkey.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58()
      },
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: walletPubkey.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58()
      }
    ]

    // Build mint → amount map from merged token accounts
    const userMintBalances = new Map<string, bigint>()
    for (const acc of Object.values(userTokenMap)) {
      if (!acc.exists) continue
      const mint = readTokenAccountMint(acc.data)
      const amount = readTokenAccountAmount(acc.data)
      if (mint && amount !== null && amount > 0n) {
        const existing = userMintBalances.get(mint)
        userMintBalances.set(mint, existing !== undefined ? existing + amount : amount)
      }
    }

    for (const [mint, amount] of userMintBalances) {
      console.log(`  ${mint}: ${amount}`)
    }

    if (userMintBalances.size === 0) return []

    // ── Phase 1: Fetch CP pools matching user's LP mints ───────────────────
    // lp_mint offset: 8 (disc) + 32 (amm_config) + 32 (pool_creator) + 32 (token_0_vault) + 32 (token_1_vault) = 136
    const CP_LP_MINT_OFFSET = 136

    interface CpPoolMatch {
      poolAddress: string
      token0Mint: string
      token1Mint: string
      token0Vault: string
      token1Vault: string
      mintDecimals0: number
      mintDecimals1: number
      lpSupply: bigint
      userLpAmount: bigint
    }

    const cpMatches: CpPoolMatch[] = []
    const cpVaultAddresses: string[] = []

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
    const ammV4Matches: AmmV4Match[] = []

    for (const [mint, amount] of userMintBalances) {
      const cpPoolsMap = yield {
        kind: 'getProgramAccounts' as const,
        programId: CP_PROGRAM_ID,
        filters: [
          { memcmp: { offset: 0, bytes: CP_POOL_DISC_B64, encoding: 'base64' as const } },
          { memcmp: { offset: CP_LP_MINT_OFFSET, bytes: mint } }
        ]
      }

      for (const acc of Object.values(cpPoolsMap)) {
        if (!acc.exists) continue
        const buf = Buffer.from(acc.data)
        if (buf.length < 341) continue
        const pool = decodeCpPool(buf)
        cpMatches.push({
          poolAddress: acc.address,
          token0Mint: pool.token0Mint,
          token1Mint: pool.token1Mint,
          token0Vault: pool.token0Vault,
          token1Vault: pool.token1Vault,
          mintDecimals0: pool.mintDecimals0,
          mintDecimals1: pool.mintDecimals1,
          lpSupply: pool.lpSupply,
          userLpAmount: amount
        })
        cpVaultAddresses.push(pool.token0Vault, pool.token1Vault)
      }

      // AMM v4 (legacy): lpMint at offset 464, account size 752
      const ammV4PoolsMap = yield {
        kind: 'getProgramAccounts' as const,
        programId: AMM_V4.toBase58(),
        filters: [{ dataSize: 752 }, { memcmp: { offset: 464, bytes: mint } }]
      }

      for (const acc of Object.values(ammV4PoolsMap)) {
        if (!acc.exists) continue
        const buf = Buffer.from(acc.data)
        if (buf.length < 752) continue
        const pool = liquidityStateV4Layout.decode(buf)
        ammV4Matches.push({
          poolAddress: acc.address,
          baseMint: pool.baseMint.toBase58(),
          quoteMint: pool.quoteMint.toBase58(),
          baseVault: pool.baseVault.toBase58(),
          quoteVault: pool.quoteVault.toBase58(),
          baseDecimal: Number(pool.baseDecimal),
          quoteDecimal: Number(pool.quoteDecimal),
          lpMint: pool.lpMint.toBase58(),
          userLpAmount: amount
        })
      }
    }

    // Collect AMM v4 addresses for phase 2
    const ammV4VaultAddresses: string[] = []
    const ammV4LpMintAddresses: string[] = []
    for (const m of ammV4Matches) {
      ammV4VaultAddresses.push(m.baseVault, m.quoteVault)
      ammV4LpMintAddresses.push(m.lpMint)
    }

    // Derive CLMM PersonalPositionState PDAs for all user mints
    const clmmPdaEntries: { mint: string; pda: string }[] = []
    for (const [mint] of userMintBalances) {
      try {
        const mintPubkey = new PublicKey(mint)
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from('position'), mintPubkey.toBuffer()],
          CLMM_PROGRAM
        )
        clmmPdaEntries.push({ mint, pda: pda.toBase58() })
      } catch {
        // invalid mint key, skip
      }
    }

    // ── Phase 2: Batch fetch CLMM PDAs + CP vaults ──────────────────────────
    const phase2Addresses = [
      ...clmmPdaEntries.map(e => e.pda),
      ...cpVaultAddresses,
      ...ammV4VaultAddresses,
      ...ammV4LpMintAddresses
    ]

    if (phase2Addresses.length === 0 && cpMatches.length === 0 && ammV4Matches.length === 0)
      return []

    const phase2Map = phase2Addresses.length > 0 ? yield phase2Addresses : {}

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
      if (buf.length < 8 || !buf.slice(0, 8).equals(PERSONAL_POSITION_DISC)) continue
      try {
        const decoded = clmmCoder.accounts.decode('PersonalPositionState', buf)
        const liquidity = BigInt((decoded.liquidity as any).toString())
        if (liquidity === 0n) continue
        const poolId = (decoded.pool_id as PublicKey).toBase58()
        clmmPositions.push({
          poolId,
          tickLower: decoded.tick_lower_index as number,
          tickUpper: decoded.tick_upper_index as number,
          liquidity
        })
        uniquePoolIds.add(poolId)
      } catch {
        // skip decode failures
      }
    }

    // ── Phase 3: Fetch CLMM pool states ──────────────────────────────────────
    const clmmPoolAddresses = [...uniquePoolIds]

    if (clmmPositions.length === 0 && cpMatches.length === 0 && ammV4Matches.length === 0) return []

    const phase3Map = clmmPoolAddresses.length > 0 ? yield clmmPoolAddresses : {}

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
        pool.sqrtPriceX64
      )

      const currentPrice = sqrtPriceX64ToPrice(
        pool.sqrtPriceX64,
        pool.mintDecimals0,
        pool.mintDecimals1
      )
      const lowerPrice = tickToPrice(pos.tickLower, pool.mintDecimals0, pool.mintDecimals1)
      const upperPrice = tickToPrice(pos.tickUpper, pool.mintDecimals0, pool.mintDecimals1)

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

      const valueUsd =
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
        isActive: pos.tickLower <= pool.tickCurrent && pool.tickCurrent < pos.tickUpper,
        lowerPriceUsd: lowerPrice.toString(),
        upperPriceUsd: upperPrice.toString(),
        currentPriceUsd: currentPrice.toString(),
        ...(valueUsd !== undefined && { valueUsd }),
        poolTokens: [
          {
            amount: {
              token: pool.tokenMint0,
              amount: amount0.toString(),
              decimals: pool.mintDecimals0.toString()
            },
            ...(token0Info?.priceUsd !== undefined && { priceUsd: token0Info.priceUsd.toString() }),
            ...(usdValue0 !== undefined && { usdValue: usdValue0.toString() })
          },
          {
            amount: {
              token: pool.tokenMint1,
              amount: amount1.toString(),
              decimals: pool.mintDecimals1.toString()
            },
            ...(token1Info?.priceUsd !== undefined && { priceUsd: token1Info.priceUsd.toString() }),
            ...(usdValue1 !== undefined && { usdValue: usdValue1.toString() })
          }
        ],
        poolAddress: pos.poolId
      } satisfies ConcentratedRangeLiquidityDefiPosition)
    }

    // ── Build CP swap positions ──────────────────────────────────────────────
    for (const cp of cpMatches) {
      const vault0Acc = phase2Map[cp.token0Vault]
      const vault1Acc = phase2Map[cp.token1Vault]
      if (!vault0Acc?.exists || !vault1Acc?.exists) continue

      const vault0Balance = readTokenAccountAmount(vault0Acc.data)
      const vault1Balance = readTokenAccountAmount(vault1Acc.data)
      if (vault0Balance === null || vault1Balance === null) continue
      if (cp.lpSupply === 0n) continue

      const amount0 = (vault0Balance * cp.userLpAmount) / cp.lpSupply
      const amount1 = (vault1Balance * cp.userLpAmount) / cp.lpSupply

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

      const valueUsd =
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
        ...(valueUsd !== undefined && { valueUsd }),
        poolTokens: [
          {
            amount: {
              token: cp.token0Mint,
              amount: amount0.toString(),
              decimals: cp.mintDecimals0.toString()
            },
            ...(token0Info?.priceUsd !== undefined && { priceUsd: token0Info.priceUsd.toString() }),
            ...(usdValue0 !== undefined && { usdValue: usdValue0.toString() })
          },
          {
            amount: {
              token: cp.token1Mint,
              amount: amount1.toString(),
              decimals: cp.mintDecimals1.toString()
            },
            ...(token1Info?.priceUsd !== undefined && { priceUsd: token1Info.priceUsd.toString() }),
            ...(usdValue1 !== undefined && { usdValue: usdValue1.toString() })
          }
        ],
        lpTokenAmount: cp.userLpAmount.toString(),
        poolAddress: cp.poolAddress
      } satisfies ConstantProductLiquidityDefiPosition)
    }

    // ── Build AMM v4 (legacy) positions ─────────────────────────────────────
    for (const amm of ammV4Matches) {
      const baseVaultAcc = phase2Map[amm.baseVault]
      const quoteVaultAcc = phase2Map[amm.quoteVault]
      const lpMintAcc = phase2Map[amm.lpMint]
      if (!baseVaultAcc?.exists || !quoteVaultAcc?.exists || !lpMintAcc?.exists) continue

      const baseVaultBalance = readTokenAccountAmount(baseVaultAcc.data)
      const quoteVaultBalance = readTokenAccountAmount(quoteVaultAcc.data)
      const lpSupply = readMintSupply(lpMintAcc.data)
      if (baseVaultBalance === null || quoteVaultBalance === null || lpSupply === null) continue
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

      const valueUsd =
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
        ...(valueUsd !== undefined && { valueUsd }),
        poolTokens: [
          {
            amount: {
              token: amm.baseMint,
              amount: amount0.toString(),
              decimals: amm.baseDecimal.toString()
            },
            ...(token0Info?.priceUsd !== undefined && { priceUsd: token0Info.priceUsd.toString() }),
            ...(usdValue0 !== undefined && { usdValue: usdValue0.toString() })
          },
          {
            amount: {
              token: amm.quoteMint,
              amount: amount1.toString(),
              decimals: amm.quoteDecimal.toString()
            },
            ...(token1Info?.priceUsd !== undefined && { priceUsd: token1Info.priceUsd.toString() }),
            ...(usdValue1 !== undefined && { usdValue: usdValue1.toString() })
          }
        ],
        lpTokenAmount: amm.userLpAmount.toString(),
        poolAddress: amm.poolAddress
      } satisfies ConstantProductLiquidityDefiPosition)
    }

    return result
  }
}

export default raydiumIntegration
