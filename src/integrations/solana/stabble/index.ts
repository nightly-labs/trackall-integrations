import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import type {
  ConstantProductLiquidityDefiPosition,
  PositionValue,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const STABLE_SWAP_PROGRAM_ID = 'swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ'
const WEIGHTED_SWAP_PROGRAM_ID = 'swapFpHZwjELNnjvThjajtiVmkz3yPQEHjLtka2fwHW'
const VAULT_PROGRAM_ID = 'vo1tWgqZMjG61Z2T9qUaMYKqZ75CYzMuaZ2LZP1n7HV'

const POOL_DISCRIMINATOR = [241, 154, 109, 4, 17, 177, 109, 188] as const
const POOL_DISCRIMINATOR_B64 = Buffer.from(POOL_DISCRIMINATOR).toString('base64')

const POOL_MINT_OFFSET = 72
const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64
const MINT_SUPPLY_OFFSET = 36

type PoolKind = 'stable' | 'weighted'

type DecodedPoolToken = {
  mint: string
  decimals: number
  scalingUp: boolean
  scalingFactor: bigint
  balance: bigint
}

type DecodedPool = {
  mint: string
  tokens: DecodedPoolToken[]
}

type PoolCandidate = {
  kind: PoolKind
  address: string
  poolMint: string
  data: Uint8Array
}

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [
  STABLE_SWAP_PROGRAM_ID,
  WEIGHTED_SWAP_PROGRAM_ID,
  VAULT_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

function readPubkey(data: Uint8Array, offset: number): string | null {
  const buf = Buffer.from(data)
  if (buf.length < offset + 32) return null
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58()
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  const buf = Buffer.from(data)
  if (buf.length < offset + 8) return null
  return buf.readBigUInt64LE(offset)
}

function readTokenAmount(data: Uint8Array): bigint | null {
  return readU64(data, TOKEN_ACCOUNT_AMOUNT_OFFSET)
}

function readTokenMint(data: Uint8Array): string | null {
  return readPubkey(data, TOKEN_ACCOUNT_MINT_OFFSET)
}

function readMintSupply(data: Uint8Array): bigint | null {
  return readU64(data, MINT_SUPPLY_OFFSET)
}

function decodePoolTokens(
  data: Uint8Array,
  offsetStart: number,
  kind: PoolKind,
): DecodedPoolToken[] | null {
  const buf = Buffer.from(data)
  if (buf.length < offsetStart + 4) return null

  let offset = offsetStart
  const count = buf.readUInt32LE(offset)
  offset += 4

  const tokenSize = kind === 'stable' ? 43 : 51
  const tokens: DecodedPoolToken[] = []

  for (let index = 0; index < count; index++) {
    if (buf.length < offset + tokenSize) return null

    const mint = new PublicKey(buf.subarray(offset, offset + 32)).toBase58()
    offset += 32

    const decimals = buf.readUInt8(offset)
    offset += 1

    const scalingUp = buf.readUInt8(offset) === 1
    offset += 1

    const scalingFactor = buf.readBigUInt64LE(offset)
    offset += 8

    const balance = buf.readBigUInt64LE(offset)
    offset += 8

    // weighted pool only: weight u64
    if (kind === 'weighted') offset += 8

    tokens.push({ mint, decimals, scalingUp, scalingFactor, balance })
  }

  return tokens
}

function decodePool(data: Uint8Array, kind: PoolKind): DecodedPool | null {
  const poolMint = readPubkey(data, POOL_MINT_OFFSET)
  if (!poolMint) return null

  // 8 discriminator + owner(32) + vault(32) + mint(32) + authority_bump(1) + is_active(1)
  let offset = 106

  // stable: amp_initial_factor(u16) + amp_target_factor(u16) + ramp_start_ts(i64)
  // + ramp_stop_ts(i64) + swap_fee(u64)
  // weighted: invariant(u64) + swap_fee(u64)
  offset += kind === 'stable' ? 28 : 16

  const tokens = decodePoolTokens(data, offset, kind)
  if (!tokens || tokens.length === 0) return null

  return {
    mint: poolMint,
    tokens,
  }
}

function normalizePoolTokenAmount(token: DecodedPoolToken): bigint {
  if (token.scalingUp) {
    return token.scalingFactor === 0n ? 0n : token.balance / token.scalingFactor
  }
  return token.balance * token.scalingFactor
}

function buildUsdValue(
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): string | undefined {
  if (priceUsd === undefined) return undefined
  if (amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
}

function buildPositionValue(
  token: string,
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): PositionValue {
  const usdValue = buildUsdValue(amountRaw, decimals, priceUsd)

  return {
    amount: {
      token,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(priceUsd !== undefined && { priceUsd: priceUsd.toString() }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function sumUsdValues(values: PositionValue[]): string | undefined {
  const present = values
    .map((value) => value.usdValue)
    .filter((value): value is string => value !== undefined)
    .map(Number)

  if (present.length === 0) return undefined
  return present.reduce((sum, value) => sum + value, 0).toString()
}

export const stabbleIntegration: SolanaIntegration = {
  platformId: 'stabble',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const wallet = new PublicKey(address)

    const phase0Map = yield [
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: wallet.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: wallet.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: STABLE_SWAP_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: POOL_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: WEIGHTED_SWAP_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: POOL_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
        ],
      },
    ]

    const lpBalancesByMint = new Map<string, bigint>()
    const poolCandidates: PoolCandidate[] = []

    for (const account of Object.values(phase0Map)) {
      if (!account.exists) continue

      if (
        account.programAddress === TOKEN_PROGRAM_ID.toBase58() ||
        account.programAddress === TOKEN_2022_PROGRAM_ID.toBase58()
      ) {
        const mint = readTokenMint(account.data)
        const amount = readTokenAmount(account.data)
        if (!mint || amount === null || amount === 0n) continue

        lpBalancesByMint.set(mint, (lpBalancesByMint.get(mint) ?? 0n) + amount)
        continue
      }

      if (
        account.programAddress !== STABLE_SWAP_PROGRAM_ID &&
        account.programAddress !== WEIGHTED_SWAP_PROGRAM_ID
      ) {
        continue
      }

      const poolMint = readPubkey(account.data, POOL_MINT_OFFSET)
      if (!poolMint) continue

      poolCandidates.push({
        kind:
          account.programAddress === STABLE_SWAP_PROGRAM_ID
            ? 'stable'
            : 'weighted',
        address: account.address,
        poolMint,
        data: account.data,
      })
    }

    if (lpBalancesByMint.size === 0 || poolCandidates.length === 0) return []

    const matchedPools = poolCandidates.filter((pool) =>
      lpBalancesByMint.has(pool.poolMint),
    )
    if (matchedPools.length === 0) return []

    const round1 = yield [...new Set(matchedPools.map((pool) => pool.poolMint))]

    const positions: UserDefiPosition[] = []

    for (const pool of matchedPools) {
      const userLpAmount = lpBalancesByMint.get(pool.poolMint)
      const mintAccount = round1[pool.poolMint]
      if (!userLpAmount || !mintAccount?.exists) continue

      const lpSupply = readMintSupply(mintAccount.data)
      if (lpSupply === null || lpSupply === 0n) continue

      const decoded = decodePool(pool.data, pool.kind)
      if (!decoded) continue

      const poolTokens: PositionValue[] = []
      for (const tokenData of decoded.tokens) {
        const normalizedPoolBalance = normalizePoolTokenAmount(tokenData)
        const userTokenAmount = (normalizedPoolBalance * userLpAmount) / lpSupply
        const tokenInfo = tokens.get(tokenData.mint)

        poolTokens.push(
          buildPositionValue(
            tokenData.mint,
            userTokenAmount,
            tokenData.decimals,
            tokenInfo?.priceUsd,
          ),
        )
      }

      if (poolTokens.length === 0) continue

      const usdValue = sumUsdValues(poolTokens)

      const position: ConstantProductLiquidityDefiPosition = {
        positionKind: 'liquidity',
        liquidityModel: 'constant-product',
        platformId: 'stabble',
        poolAddress: pool.address,
        lpTokenAmount: userLpAmount.toString(),
        poolTokens,
        meta: {
          pool: {
            kind: pool.kind,
          },
        },
      }
      if (usdValue !== undefined) position.usdValue = usdValue

      positions.push(position)
    }

    return positions
  },
}

export default stabbleIntegration
