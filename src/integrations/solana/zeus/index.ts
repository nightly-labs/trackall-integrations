import { PublicKey } from '@solana/web3.js'
import type {
  PositionValue,
  SolanaIntegration,
  SolanaPlugins,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const ZEUS_PROGRAM_ID = 'SYNMjud3ALEaeJhxuq8gpc2wJzC4XLHfxp9SgKmzQ8r'
const BTCSOL_MINT = 'BSoLov7Es6mGLkBq7Z89PSWDmk6Vsw4jVxdfE2UHrJTX'
const BTCSOL_DECIMALS = 9
const MSOL_MINT = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'
const JUPSOL_MINT = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v'
const KYSOL_MINT = 'kySo1nETpsZE2NWe5vj2C64mPSciH1SppmHb4XieQ7B'

const USER_POSITION_DISCRIMINATOR = new Uint8Array([
  251, 248, 209, 245, 83, 234, 17, 27,
])
const REDEEM_REQUEST_DISCRIMINATOR = new Uint8Array([
  103, 82, 139, 51, 199, 234, 111, 115,
])
const USER_POSITION_DISCRIMINATOR_B64 = Buffer.from(
  USER_POSITION_DISCRIMINATOR,
).toString('base64')
const REDEEM_REQUEST_DISCRIMINATOR_B64 = Buffer.from(
  REDEEM_REQUEST_DISCRIMINATOR,
).toString('base64')

const OWNER_OFFSET_IN_USER_POSITION = 40
const STRATEGY_GROUP_OFFSET = 72
const SYNTHETIC_AMOUNT_OFFSET = 168
const USER_OFFSET_IN_REDEEM_REQUEST = 8
const SYNTHETIC_AMOUNT_REQUESTED_OFFSET = 136
const REFUNDABLE_AFTER_TS_OFFSET = 184

const KNOWN_STRATEGY_GROUPS: Record<string, string> = {
  CMBwsHiUnih1VAzENzoNKTq8tyRaCpD2zBgBUm47sN6h: 'mSOL',
  '9HGpvmW1Lv2pqKkbM41pGm7ApMjgdXt7Refdv5hoFejJ': 'jupSOL',
  '67zGEwrzVJvn9owJR8aL693K1eMoH28WiDKDE17xNmf8': 'kySOL',
}

const STRATEGY_GROUP_ASSET: Record<
  string,
  { mint: string; decimals: number; name: string }
> = {
  CMBwsHiUnih1VAzENzoNKTq8tyRaCpD2zBgBUm47sN6h: {
    mint: MSOL_MINT,
    decimals: 9,
    name: 'mSOL',
  },
  '9HGpvmW1Lv2pqKkbM41pGm7ApMjgdXt7Refdv5hoFejJ': {
    mint: JUPSOL_MINT,
    decimals: 9,
    name: 'jupSOL',
  },
  '67zGEwrzVJvn9owJR8aL693K1eMoH28WiDKDE17xNmf8': {
    mint: KYSOL_MINT,
    decimals: 9,
    name: 'kySOL',
  },
}

type StrategyState = {
  staked: bigint
  unbonding: PositionValue[]
  latestUnlockAt?: bigint
}

export const testAddress = '85FYyrZXBnfmaTZJyTdGkAhxRKY7cNQXXm2wJNBDc8rV'

export const PROGRAM_IDS = [ZEUS_PROGRAM_ID] as const

function hasDiscriminator(data: Uint8Array, discriminator: Uint8Array): boolean {
  if (data.length < discriminator.length) return false
  for (let i = 0; i < discriminator.length; i++) {
    if (data[i] !== discriminator[i]) return false
  }
  return true
}

function readPubkey(data: Uint8Array, offset: number): string | null {
  if (data.length < offset + 32) return null
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58()
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null
  return Buffer.from(data).readBigUInt64LE(offset)
}

function readI64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null
  return Buffer.from(data).readBigInt64LE(offset)
}

function buildPositionValue(
  token: string,
  amount: bigint,
  decimals: number,
  priceUsd?: number,
): PositionValue {
  const value: PositionValue = {
    amount: {
      token,
      amount: amount.toString(),
      decimals: decimals.toString(),
    },
  }

  if (
    priceUsd !== undefined &&
    amount <= BigInt(Number.MAX_SAFE_INTEGER) &&
    Number.isFinite(priceUsd)
  ) {
    value.priceUsd = priceUsd.toString()
    value.usdValue = ((Number(amount) / 10 ** decimals) * priceUsd).toString()
  }

  return value
}

function mergeUsdValues(values: Array<string | undefined>): string | undefined {
  const entries = values
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .filter(Number.isFinite)

  if (entries.length === 0) return undefined
  return entries.reduce((sum, value) => sum + value, 0).toString()
}

function getStrategyAsset(strategyGroup: string): {
  mint: string
  decimals: number
  name: string
} {
  return (
    STRATEGY_GROUP_ASSET[strategyGroup] ?? {
      mint: BTCSOL_MINT,
      decimals: BTCSOL_DECIMALS,
      name: 'unknown',
    }
  )
}

export const zeusIntegration: SolanaIntegration = {
  platformId: 'zeus',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const nowUnix = BigInt(Math.floor(Date.now() / 1000))
    const strategyState = new Map<string, StrategyState>()

    const accounts = yield [
      {
        kind: 'getProgramAccounts' as const,
        programId: ZEUS_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: USER_POSITION_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
          {
            memcmp: {
              offset: OWNER_OFFSET_IN_USER_POSITION,
              bytes: address,
              encoding: 'base58',
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: ZEUS_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: REDEEM_REQUEST_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
          {
            memcmp: {
              offset: USER_OFFSET_IN_REDEEM_REQUEST,
              bytes: address,
              encoding: 'base58',
            },
          },
        ],
      },
    ]

    for (const account of Object.values(accounts)) {
      if (!account.exists || account.programAddress !== ZEUS_PROGRAM_ID) continue
      if (!hasDiscriminator(account.data, USER_POSITION_DISCRIMINATOR)) continue

      const owner = readPubkey(account.data, OWNER_OFFSET_IN_USER_POSITION)
      const strategyGroup = readPubkey(account.data, STRATEGY_GROUP_OFFSET)
      const syntheticAmount = readU64(account.data, SYNTHETIC_AMOUNT_OFFSET)
      if (!owner || !strategyGroup || syntheticAmount === null || owner !== address)
        continue
      if (syntheticAmount <= 0n) continue

      const current = strategyState.get(strategyGroup)
      if (current) {
        current.staked += syntheticAmount
      } else {
        strategyState.set(strategyGroup, {
          staked: syntheticAmount,
          unbonding: [],
        })
      }
    }

    for (const account of Object.values(accounts)) {
      if (!account.exists || account.programAddress !== ZEUS_PROGRAM_ID) continue
      if (!hasDiscriminator(account.data, REDEEM_REQUEST_DISCRIMINATOR)) continue

      const user = readPubkey(account.data, USER_OFFSET_IN_REDEEM_REQUEST)
      const strategyGroup = readPubkey(account.data, STRATEGY_GROUP_OFFSET)
      const requested = readU64(account.data, SYNTHETIC_AMOUNT_REQUESTED_OFFSET)
      const refundableAfter = readI64(account.data, REFUNDABLE_AFTER_TS_OFFSET)
      if (!user || !strategyGroup || requested === null || user !== address) continue
      if (requested <= 0n) continue

      const state = strategyState.get(strategyGroup) ?? { staked: 0n, unbonding: [] }
      const asset = getStrategyAsset(strategyGroup)
      const assetToken = tokens.get(asset.mint)
      state.unbonding.push(
        buildPositionValue(
          asset.mint,
          requested,
          asset.decimals,
          assetToken?.priceUsd,
        ),
      )

      if (
        refundableAfter !== null &&
        refundableAfter > nowUnix &&
        (state.latestUnlockAt === undefined || refundableAfter > state.latestUnlockAt)
      ) {
        state.latestUnlockAt = refundableAfter
      }

      strategyState.set(strategyGroup, state)
    }

    const positions: UserDefiPosition[] = []

    for (const [strategyGroup, state] of strategyState.entries()) {
      if (state.staked <= 0n && state.unbonding.length === 0) continue

      const asset = getStrategyAsset(strategyGroup)
      const assetToken = tokens.get(asset.mint)
      const stakedValue =
        state.staked > 0n
          ? buildPositionValue(
              asset.mint,
              state.staked,
              asset.decimals,
              assetToken?.priceUsd,
            )
          : undefined

      const strategyName = KNOWN_STRATEGY_GROUPS[strategyGroup] ?? asset.name

      const position: StakingDefiPosition = {
        platformId: 'zeus',
        positionKind: 'staking',
        ...(stakedValue && { staked: [stakedValue] }),
        ...(state.unbonding.length > 0 && { unbonding: state.unbonding }),
        ...(state.latestUnlockAt !== undefined && {
          lockedUntil: state.latestUnlockAt.toString(),
        }),
        meta: {
          strategyGroup: {
            address: strategyGroup,
            name: strategyName,
          },
        },
      }

      const usdValue = mergeUsdValues([
        stakedValue?.usdValue,
        ...state.unbonding.map((entry) => entry.usdValue),
      ])
      if (usdValue !== undefined) {
        position.usdValue = usdValue
      }

      positions.push(position)
    }

    return positions
  },
}

export default zeusIntegration
