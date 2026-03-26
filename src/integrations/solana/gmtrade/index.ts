import { createHash } from 'node:crypto'
import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor'
import { unpackMint } from '@solana/spl-token'
import type { AccountInfo } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

import gmsolStoreIdl from './idls/gmsol_store.json'

import type {
  AccountsMap,
  MaybeSolanaAccount,
  PositionValue,
  SolanaIntegration,
  SolanaPlugins,
  TradingDefiPosition,
  TradingOrder,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const GMTRADE_STORE_PROGRAM_ID = 'Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo'
const POSITION_OWNER_OFFSET = 56
const ACTION_OWNER_OFFSET = 88
const PRICE_DECIMALS = 20
const PENDING_ACTION_STATE = 0
const POSITION_KIND_LONG = 1
const POSITION_KIND_SHORT = 2
const ORDER_SIDE_LONG = 0

const ORDER_KIND_LABELS: Record<number, string> = {
  0: 'liquidation',
  1: 'auto-deleveraging',
  2: 'market-swap',
  3: 'market-increase',
  4: 'market-decrease',
  5: 'limit-swap',
  6: 'limit-increase',
  7: 'limit-decrease',
  8: 'stop-loss-decrease',
}

type BigNumberish = bigint | number | string | { toString(): string }

type DecodedPosition = {
  store: PublicKey
  kind: number
  market_token: PublicKey
  collateral_token: PublicKey
  state: {
    size_in_tokens: BigNumberish
    collateral_amount: BigNumberish
    size_in_usd: BigNumberish
  }
}

type DecodedOrder = {
  header: {
    action_state: number
    store: PublicKey
  }
  market_token: PublicKey
  params: {
    kind: number
    side: number
    collateral_token: PublicKey
    initial_collateral_delta_amount: BigNumberish
    size_delta_value: BigNumberish
    acceptable_price: BigNumberish
  }
}

type Bucket = {
  store: string
  marketToken: string
  positions: NonNullable<TradingDefiPosition['positions']>
  buyOrders: TradingOrder[]
  sellOrders: TradingOrder[]
  usdValues: number[]
  positionAccounts: string[]
  orderAccounts: string[]
  orderKinds: string[]
}

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [GMTRADE_STORE_PROGRAM_ID] as const

const coder = new BorshAccountsCoder(gmsolStoreIdl as unknown as Idl)
const POSITION_DISCRIMINATOR_B64 = accountDiscriminatorB64('Position')
const ORDER_DISCRIMINATOR_B64 = accountDiscriminatorB64('Order')

function accountDiscriminatorB64(accountName: string): string {
  return createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8)
    .toString('base64')
}

function toBigInt(value: BigNumberish): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string') return BigInt(value)
  return BigInt(value.toString())
}

function divideToDecimalString(
  numerator: bigint,
  denominator: bigint,
  digits = 6,
): string {
  if (denominator === 0n) return '0'

  const integerPart = numerator / denominator
  const remainder = numerator % denominator
  if (digits <= 0 || remainder === 0n) {
    return integerPart.toString()
  }

  const scale = 10n ** BigInt(digits)
  const fractionalPart = ((remainder * scale) / denominator)
    .toString()
    .padStart(digits, '0')
    .replace(/0+$/, '')

  return fractionalPart.length > 0
    ? `${integerPart}.${fractionalPart}`
    : integerPart.toString()
}

function toScaledDecimal(value: bigint, decimals: number): string {
  return divideToDecimalString(value, 10n ** BigInt(decimals))
}

function decodeAccount<T>(
  accountName: string,
  data: Uint8Array,
): T | null {
  try {
    return coder.decode(accountName, Buffer.from(data)) as T
  } catch {
    return null
  }
}

function toAccountInfo(
  account: MaybeSolanaAccount | undefined,
): AccountInfo<Buffer> | null {
  if (!account?.exists) return null

  return {
    data: Buffer.from(account.data),
    owner: new PublicKey(account.programAddress),
    lamports: Number(account.lamports),
    executable: false,
    rentEpoch: 0,
  }
}

function buildPositionValue(
  token: string,
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): PositionValue {
  const usdValue =
    priceUsd !== undefined
      ? ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
      : undefined

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

function getOrCreateBucket(
  buckets: Map<string, Bucket>,
  store: string,
  marketToken: string,
): Bucket {
  const key = `${store}:${marketToken}`
  const existing = buckets.get(key)
  if (existing) return existing

  const bucket: Bucket = {
    store,
    marketToken,
    positions: [],
    buyOrders: [],
    sellOrders: [],
    usdValues: [],
    positionAccounts: [],
    orderAccounts: [],
    orderKinds: [],
  }
  buckets.set(key, bucket)

  return bucket
}

function addOrderKind(bucket: Bucket, kind: number) {
  const label = ORDER_KIND_LABELS[kind] ?? `unknown-${kind}`
  if (!bucket.orderKinds.includes(label)) {
    bucket.orderKinds.push(label)
  }
}

function tokenDecimals(
  mint: string,
  tokens: SolanaPlugins['tokens'],
  mintDecimalsMap: Map<string, number>,
): number {
  return tokens.get(mint)?.decimals ?? mintDecimalsMap.get(mint) ?? 0
}

function tokenPriceUsd(mint: string, tokens: SolanaPlugins['tokens']) {
  return tokens.get(mint)?.priceUsd
}

export const gmtradeIntegration: SolanaIntegration = {
  platformId: 'gmtrade',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const phase0Map = yield [
      {
        kind: 'getProgramAccounts' as const,
        programId: GMTRADE_STORE_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: POSITION_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
          {
            memcmp: {
              offset: POSITION_OWNER_OFFSET,
              bytes: address,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: GMTRADE_STORE_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: ORDER_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
          {
            memcmp: {
              offset: ACTION_OWNER_OFFSET,
              bytes: address,
            },
          },
        ],
      },
    ]

    const decodedPositions: Array<{ address: string; data: DecodedPosition }> = []
    const decodedOrders: Array<{ address: string; data: DecodedOrder }> = []

    for (const [accountAddress, account] of Object.entries(phase0Map)) {
      if (!account.exists) continue

      const position = decodeAccount<DecodedPosition>('Position', account.data)
      if (position) {
        decodedPositions.push({ address: accountAddress, data: position })
        continue
      }

      const order = decodeAccount<DecodedOrder>('Order', account.data)
      if (order) {
        decodedOrders.push({ address: accountAddress, data: order })
      }
    }

    if (decodedPositions.length === 0 && decodedOrders.length === 0) {
      return []
    }

    const mintSet = new Set<string>()
    decodedPositions.forEach(({ data }) =>
      mintSet.add(data.collateral_token.toBase58()),
    )
    decodedOrders.forEach(({ data }) =>
      mintSet.add(data.params.collateral_token.toBase58()),
    )

    const mintAddresses = [...mintSet]
    const mintAccountsMap: AccountsMap =
      mintAddresses.length > 0 ? yield mintAddresses : {}

    const mintDecimalsMap = new Map<string, number>()
    for (const mintAddress of mintAddresses) {
      const token = tokens.get(mintAddress)
      if (token) {
        mintDecimalsMap.set(mintAddress, token.decimals)
        continue
      }

      const accountInfo = toAccountInfo(mintAccountsMap[mintAddress])
      if (!accountInfo) continue

      try {
        const mint = unpackMint(
          new PublicKey(mintAddress),
          accountInfo,
          accountInfo.owner,
        )
        mintDecimalsMap.set(mintAddress, mint.decimals)
      } catch {
        // Keep fallback decimals for unknown mint layouts.
      }
    }

    const buckets = new Map<string, Bucket>()

    for (const { address: positionAddress, data: position } of decodedPositions) {
      const sizeInUsdRaw = toBigInt(position.state.size_in_usd)
      const sizeInTokensRaw = toBigInt(position.state.size_in_tokens)
      const collateralAmountRaw = toBigInt(position.state.collateral_amount)

      if (
        sizeInUsdRaw <= 0n &&
        sizeInTokensRaw <= 0n &&
        collateralAmountRaw <= 0n
      ) {
        continue
      }

      const store = position.store.toBase58()
      const marketToken = position.market_token.toBase58()
      const collateralToken = position.collateral_token.toBase58()
      const collateralDecimals = tokenDecimals(collateralToken, tokens, mintDecimalsMap)
      const collateralPrice = tokenPriceUsd(collateralToken, tokens)

      const bucket = getOrCreateBucket(buckets, store, marketToken)
      bucket.positionAccounts.push(positionAddress)

      const notionalUsd = toScaledDecimal(sizeInUsdRaw, PRICE_DECIMALS)
      const notionalUsdNumber = Number(notionalUsd)
      if (Number.isFinite(notionalUsdNumber)) {
        bucket.usdValues.push(notionalUsdNumber)
      }

      const side =
        position.kind === POSITION_KIND_LONG
          ? 'long'
          : position.kind === POSITION_KIND_SHORT
            ? 'short'
            : null

      bucket.positions.push({
        ...(side && { side }),
        notionalUsd,
        ...(collateralAmountRaw > 0n && {
          collateral: [
            buildPositionValue(
              collateralToken,
              collateralAmountRaw,
              collateralDecimals,
              collateralPrice,
            ),
          ],
        }),
      })
    }

    for (const { address: orderAddress, data: order } of decodedOrders) {
      if (order.header.action_state !== PENDING_ACTION_STATE) {
        continue
      }

      const store = order.header.store.toBase58()
      const marketToken = order.market_token.toBase58()
      const collateralToken = order.params.collateral_token.toBase58()
      const collateralAmountRaw = toBigInt(
        order.params.initial_collateral_delta_amount,
      )
      const collateralDecimals = tokenDecimals(collateralToken, tokens, mintDecimalsMap)
      const collateralPrice = tokenPriceUsd(collateralToken, tokens)
      const acceptablePriceRaw = toBigInt(order.params.acceptable_price)

      const side: TradingOrder['side'] =
        order.params.side === ORDER_SIDE_LONG ? 'buy' : 'sell'

      const orderValue = buildPositionValue(
        collateralToken,
        collateralAmountRaw,
        collateralDecimals,
        collateralPrice,
      )

      const orderItem: TradingOrder = {
        side,
        // GMTrade order accounts expose collateral cleanly; use collateral-based
        // values for both legs in v1 and include richer context in meta.
        selling: orderValue,
        buying: orderValue,
        ...(acceptablePriceRaw > 0n && {
          limitPrice: toScaledDecimal(acceptablePriceRaw, PRICE_DECIMALS),
        }),
        status: 'open',
      }

      const bucket = getOrCreateBucket(buckets, store, marketToken)
      bucket.orderAccounts.push(orderAddress)
      addOrderKind(bucket, order.params.kind)
      if (side === 'buy') {
        bucket.buyOrders.push(orderItem)
      } else {
        bucket.sellOrders.push(orderItem)
      }

      const sizeDeltaUsd = toBigInt(order.params.size_delta_value)
      if (sizeDeltaUsd > 0n) {
        const sizeDeltaUsdNumber = Number(toScaledDecimal(sizeDeltaUsd, PRICE_DECIMALS))
        if (Number.isFinite(sizeDeltaUsdNumber)) {
          bucket.usdValues.push(sizeDeltaUsdNumber)
        }
      }
    }

    const result: UserDefiPosition[] = []

    for (const bucket of buckets.values()) {
      if (
        bucket.positions.length === 0 &&
        bucket.buyOrders.length === 0 &&
        bucket.sellOrders.length === 0
      ) {
        continue
      }

      const position: TradingDefiPosition = {
        platformId: 'gmtrade',
        positionKind: 'trading',
        marketType: 'perp',
        marginEnabled: true,
        ...(bucket.positions.length > 0 && { positions: bucket.positions }),
        ...(bucket.buyOrders.length > 0 && { buyOrders: bucket.buyOrders }),
        ...(bucket.sellOrders.length > 0 && { sellOrders: bucket.sellOrders }),
        ...(bucket.usdValues.length > 0 && {
          usdValue: bucket.usdValues
            .reduce((sum, value) => sum + value, 0)
            .toString(),
        }),
        meta: {
          gmtrade: {
            store: bucket.store,
            marketToken: bucket.marketToken,
            positionAccounts: bucket.positionAccounts,
            orderAccounts: bucket.orderAccounts,
            orderKinds: bucket.orderKinds,
          },
        },
      }

      result.push(position)
    }

    return result
  },
}

export default gmtradeIntegration
