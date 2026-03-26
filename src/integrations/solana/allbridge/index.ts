import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import type {
  ConstantProductLiquidityDefiPosition,
  PositionValue,
  SolanaAccount,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const ALLBRIDGE_BRIDGE_PROGRAM_ID =
  'BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB'
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const XABR_MINT = 'xAx6d1sjmBvpWkVZQEqgUvPmGBNndEXPxYpr3QVp61H'
const XABR_DECIMALS = 9
const SYSTEM_PRECISION = 3
const REWARD_SHIFT_BITS = 48n

const USER_DEPOSIT_DISCRIMINATOR_B64 = accountDiscriminatorBase64('UserDeposit')
const POOL_DISCRIMINATOR_B64 = accountDiscriminatorBase64('Pool')

const USER_DEPOSIT_SIZE = 88
const USER_DEPOSIT_OWNER_OFFSET = 8
const USER_DEPOSIT_MINT_OFFSET = 40
const USER_DEPOSIT_LP_AMOUNT_OFFSET = 72
const USER_DEPOSIT_REWARD_DEBT_OFFSET = 80

const POOL_SIZE = 131
const POOL_MINT_OFFSET = 8
const POOL_DECIMALS_OFFSET = 80
const POOL_ACC_REWARD_PER_SHARE_P_OFFSET = 105

const TOKEN_ACCOUNT_SIZE = 165
const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_OWNER_OFFSET = 32
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64

type AllbridgeUserDeposit = {
  address: string
  owner: string
  mint: string
  lpAmount: bigint
  rewardDebt: bigint
}

type AllbridgePool = {
  address: string
  mint: string
  decimals: number
  accRewardPerShareP: bigint
}

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [
  ALLBRIDGE_BRIDGE_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
] as const

function accountDiscriminatorBase64(accountName: string): string {
  return createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8)
    .toString('base64')
}

function readPubkey(data: Uint8Array, offset: number): string | null {
  if (data.length < offset + 32) return null
  return new PublicKey(data.slice(offset, offset + 32)).toBase58()
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null
  return Buffer.from(data).readBigUInt64LE(offset)
}

function readU128(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 16) return null
  let value = 0n
  for (let idx = 0; idx < 16; idx++) {
    value |= BigInt(data[offset + idx] ?? 0) << (8n * BigInt(idx))
  }
  return value
}

function parseTokenAccountAmount(data: Uint8Array): bigint | null {
  return readU64(data, TOKEN_ACCOUNT_AMOUNT_OFFSET)
}

function parseUserDeposit(account: SolanaAccount): AllbridgeUserDeposit | null {
  if (account.data.length !== USER_DEPOSIT_SIZE) return null

  const owner = readPubkey(account.data, USER_DEPOSIT_OWNER_OFFSET)
  const mint = readPubkey(account.data, USER_DEPOSIT_MINT_OFFSET)
  const lpAmount = readU64(account.data, USER_DEPOSIT_LP_AMOUNT_OFFSET)
  const rewardDebt = readU64(account.data, USER_DEPOSIT_REWARD_DEBT_OFFSET)

  if (!owner || !mint || lpAmount === null || rewardDebt === null) return null

  return {
    address: account.address,
    owner,
    mint,
    lpAmount,
    rewardDebt,
  }
}

function parsePool(account: SolanaAccount): AllbridgePool | null {
  if (account.data.length !== POOL_SIZE) return null

  const mint = readPubkey(account.data, POOL_MINT_OFFSET)
  const decimals = account.data[POOL_DECIMALS_OFFSET]
  const accRewardPerShareP = readU128(
    account.data,
    POOL_ACC_REWARD_PER_SHARE_P_OFFSET,
  )

  if (!mint || decimals === undefined || accRewardPerShareP === null) return null

  return {
    address: account.address,
    mint,
    decimals,
    accRewardPerShareP,
  }
}

function pow10(exp: number): bigint {
  if (exp <= 0) return 1n
  return 10n ** BigInt(exp)
}

function fromSystemPrecision(amount: bigint, decimals: number): bigint {
  if (decimals >= SYSTEM_PRECISION) {
    return amount * pow10(decimals - SYSTEM_PRECISION)
  }
  return amount / pow10(SYSTEM_PRECISION - decimals)
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
  mint: string,
  amountRaw: bigint,
  decimals: number,
  tokens: SolanaPlugins['tokens'],
): PositionValue {
  const token = tokens.get(mint)
  const usdValue = buildUsdValue(amountRaw, decimals, token?.priceUsd)

  return {
    amount: {
      token: mint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(token?.priceUsd !== undefined && { priceUsd: token.priceUsd.toString() }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function calculateClaimableRewards(
  lpAmount: bigint,
  accRewardPerShareP: bigint,
  rewardDebt: bigint,
): bigint {
  const accrued = (lpAmount * accRewardPerShareP) >> REWARD_SHIFT_BITS
  if (accrued <= rewardDebt) return 0n
  return accrued - rewardDebt
}

function sumUsdValues(values: Array<string | undefined>): string | undefined {
  const numbers = values
    .filter((value): value is string => value !== undefined)
    .map(Number)

  if (numbers.length === 0) return undefined
  return numbers.reduce((sum, value) => sum + value, 0).toString()
}

export const allbridgeIntegration: SolanaIntegration = {
  platformId: 'allbridge',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const userDepositsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: ALLBRIDGE_BRIDGE_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: USER_DEPOSIT_DISCRIMINATOR_B64,
            encoding: 'base64',
          },
        },
        {
          memcmp: {
            offset: USER_DEPOSIT_OWNER_OFFSET,
            bytes: address,
            encoding: 'base58',
          },
        },
        { dataSize: USER_DEPOSIT_SIZE },
      ],
    }

    const userDeposits = Object.values(userDepositsMap)
      .filter((account): account is SolanaAccount => account.exists)
      .map(parseUserDeposit)
      .filter(
        (deposit): deposit is AllbridgeUserDeposit =>
          deposit !== null && deposit.owner === address && deposit.lpAmount > 0n,
      )

    if (userDeposits.length === 0) return []

    const poolsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: ALLBRIDGE_BRIDGE_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: POOL_DISCRIMINATOR_B64,
            encoding: 'base64',
          },
        },
        { dataSize: POOL_SIZE },
      ],
    }

    const xAbrTokenAccountsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: SPL_TOKEN_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: TOKEN_ACCOUNT_MINT_OFFSET,
            bytes: XABR_MINT,
            encoding: 'base58',
          },
        },
        {
          memcmp: {
            offset: TOKEN_ACCOUNT_OWNER_OFFSET,
            bytes: address,
            encoding: 'base58',
          },
        },
        { dataSize: TOKEN_ACCOUNT_SIZE },
      ],
    }

    const poolsByMint = new Map<string, AllbridgePool>()
    for (const account of Object.values(poolsMap)) {
      if (!account.exists) continue
      const pool = parsePool(account)
      if (!pool) continue
      poolsByMint.set(pool.mint, pool)
    }

    const positions: UserDefiPosition[] = []

    for (const userDeposit of userDeposits) {
      const pool = poolsByMint.get(userDeposit.mint)
      if (!pool) continue

      const suppliedAmountRaw = fromSystemPrecision(
        userDeposit.lpAmount,
        pool.decimals,
      )
      const poolToken = buildPositionValue(
        userDeposit.mint,
        suppliedAmountRaw,
        pool.decimals,
        tokens,
      )

      const rewardsRaw = calculateClaimableRewards(
        userDeposit.lpAmount,
        pool.accRewardPerShareP,
        userDeposit.rewardDebt,
      )
      const rewardValue =
        rewardsRaw > 0n
          ? buildPositionValue(userDeposit.mint, rewardsRaw, pool.decimals, tokens)
          : undefined

      const positionUsdValue = sumUsdValues([poolToken.usdValue, rewardValue?.usdValue])

      const position: ConstantProductLiquidityDefiPosition = {
        positionKind: 'liquidity',
        liquidityModel: 'constant-product',
        platformId: 'allbridge',
        poolTokens: [poolToken],
        poolAddress: pool.address,
        lpTokenAmount: userDeposit.lpAmount.toString(),
        ...(rewardValue && { rewards: [rewardValue] }),
        ...(positionUsdValue !== undefined && { usdValue: positionUsdValue }),
        meta: {
          userDeposit: {
            address: userDeposit.address,
            rewardDebt: userDeposit.rewardDebt.toString(),
          },
          pool: {
            accRewardPerShareP: pool.accRewardPerShareP.toString(),
            rewardShiftBits: REWARD_SHIFT_BITS.toString(),
            systemPrecision: SYSTEM_PRECISION,
          },
        },
      }

      positions.push(position)
    }

    for (const account of Object.values(xAbrTokenAccountsMap)) {
      if (!account.exists) continue
      const amountRaw = parseTokenAccountAmount(account.data)
      if (amountRaw === null || amountRaw <= 0n) continue

      const xAbrValue = buildPositionValue(
        XABR_MINT,
        amountRaw,
        XABR_DECIMALS,
        tokens,
      )

      const xAbrPosition: ConstantProductLiquidityDefiPosition = {
        positionKind: 'liquidity',
        liquidityModel: 'constant-product',
        platformId: 'allbridge',
        poolTokens: [xAbrValue],
        lpTokenAmount: amountRaw.toString(),
        ...(xAbrValue.usdValue !== undefined && { usdValue: xAbrValue.usdValue }),
        meta: {
          tokenAccount: {
            address: account.address,
          },
        },
      }

      positions.push(xAbrPosition)
    }

    return positions
  },
}

export default allbridgeIntegration
