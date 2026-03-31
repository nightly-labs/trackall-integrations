import { BorshCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type {
  PositionValue,
  RewardDefiPosition,
  SolanaIntegration,
  SolanaPlugins,
  TradingDefiPosition,
  TradingOrder,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import predictionMarketIdl from './idls/prediction_market.json'

const USD6_DECIMALS = 6
const DEFAULT_SETTLEMENT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const PROGRAM_ID = predictionMarketIdl.address
const PROGRAM_KEY = new PublicKey(PROGRAM_ID)
const coder = new BorshCoder(predictionMarketIdl as never)

const POSITION_DISCRIMINATOR_B64 = accountDiscriminatorBase64('Position')
const ORDER_DISCRIMINATOR_B64 = accountDiscriminatorBase64('Order')
const VAULT_DISCRIMINATOR_B64 = accountDiscriminatorBase64('Vault')

const OWNER_OFFSET = 8
const MINT_DECIMALS_OFFSET = 44

type PredictionPosition = {
  address: string
  marketId: string
  isYes: boolean
  payoutClaimed: boolean
  contracts: bigint
  totalCostUsd6: bigint
  openOrders: number
  realizedPnlUsd6: bigint
}

type PredictionOrder = {
  address: string
  marketId: string
  isYes: boolean
  isBuy: boolean
  contracts: bigint
  maxFillPriceUsd6: bigint
  filledContracts: bigint
  createdAt: bigint
}

type MarketResult = {
  marketId: string
  isYes: boolean
  settlementTime: bigint
  claimsEnabled: boolean
}

type Vault = {
  settlementMint: string
}

type PositionGroup = {
  marketId: string
  isYes: boolean
  position: PredictionPosition | null
  orders: PredictionOrder[]
}

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [PROGRAM_ID] as const

function accountDiscriminatorBase64(accountName: string): string {
  const discriminator = predictionMarketIdl.accounts?.find(
    (account) => account.name === accountName,
  )?.discriminator

  if (!discriminator) {
    throw new Error(`Missing discriminator for account "${accountName}"`)
  }

  return Buffer.from(discriminator).toString('base64')
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string') return BigInt(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return BigInt((value as { toString: () => string }).toString())
  }
  return 0n
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return Number((value as { toString: () => string }).toString())
  }
  return 0
}

function formatDecimal(raw: bigint, decimals: number): string {
  const sign = raw < 0n ? '-' : ''
  const abs = raw < 0n ? -raw : raw
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const fraction = abs % base

  if (fraction === 0n) return `${sign}${whole.toString()}`

  return `${sign}${whole.toString()}.${fraction
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')}`
}

function scaleRaw(raw: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (toDecimals === fromDecimals) return raw
  if (toDecimals > fromDecimals) {
    return raw * 10n ** BigInt(toDecimals - fromDecimals)
  }
  return raw / 10n ** BigInt(fromDecimals - toDecimals)
}

function buildPositionValue(
  token: string,
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): PositionValue {
  const value: PositionValue = {
    amount: {
      token,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
  }

  if (priceUsd !== undefined) {
    value.priceUsd = priceUsd.toString()
    value.usdValue = formatDecimal(
      (amountRaw * BigInt(Math.round(priceUsd * 10 ** USD6_DECIMALS))) /
        10n ** BigInt(decimals),
      USD6_DECIMALS,
    )
  }

  return value
}

function decodeMintDecimals(data: Uint8Array): number | null {
  if (data.length <= MINT_DECIMALS_OFFSET) return null
  return data[MINT_DECIMALS_OFFSET] ?? null
}

function deriveMarketResultAddress(marketId: string): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market_result'), Buffer.from(marketId)],
    PROGRAM_KEY,
  )[0].toBase58()
}

function isPendingOrderStatus(status: unknown): boolean {
  if (typeof status === 'string') return status.toLowerCase() === 'pending'
  if (!status || typeof status !== 'object') return false

  const [variant] = Object.keys(status as Record<string, unknown>)
  return variant?.toLowerCase() === 'pending'
}

function marketKey(marketId: string, isYes: boolean): string {
  return `${marketId}:${isYes ? 'yes' : 'no'}`
}

function parseMarketId(marketId: string): {
  raw: string
  series: string
  index?: number
  source?: string
  label: string
} {
  const parts = marketId.split('-')
  const series = parts[0] ?? marketId
  const maybeIndex = parts.length > 1 ? Number(parts[1]) : Number.NaN
  const index = Number.isFinite(maybeIndex) ? maybeIndex : undefined
  const source = parts.length > 2 ? parts.slice(2).join('-') : undefined

  const labelParts = [series]
  if (index !== undefined) labelParts.push(`#${index}`)
  if (source) labelParts.push(`(${source})`)

  return {
    raw: marketId,
    series,
    label: labelParts.join(' '),
    ...(index !== undefined && { index }),
    ...(source && { source }),
  }
}

function groupPositions(
  positions: PredictionPosition[],
  orders: PredictionOrder[],
): PositionGroup[] {
  const groups = new Map<string, PositionGroup>()

  for (const position of positions) {
    groups.set(marketKey(position.marketId, position.isYes), {
      marketId: position.marketId,
      isYes: position.isYes,
      position,
      orders: [],
    })
  }

  for (const order of orders) {
    const key = marketKey(order.marketId, order.isYes)
    const existing = groups.get(key)

    if (existing) {
      existing.orders.push(order)
    } else {
      groups.set(key, {
        marketId: order.marketId,
        isYes: order.isYes,
        position: null,
        orders: [order],
      })
    }
  }

  return [...groups.values()].sort((left, right) => {
    const marketCmp = left.marketId.localeCompare(right.marketId)
    if (marketCmp !== 0) return marketCmp
    return Number(left.isYes) - Number(right.isYes)
  })
}

function collectMarketResultRequests(
  positions: PredictionPosition[],
  orders: PredictionOrder[],
): { marketIds: string[]; addresses: string[] } {
  const marketIds = [...new Set([...positions, ...orders].map((row) => row.marketId))]
  const addresses = marketIds.map(deriveMarketResultAddress)
  return { marketIds, addresses }
}

function decodePositions(
  positionMap: Record<string, { exists: boolean; data?: Uint8Array }>,
): PredictionPosition[] {
  const rows: PredictionPosition[] = []

  for (const [address, account] of Object.entries(positionMap)) {
    if (!account.exists || !account.data) continue

    try {
      const decoded = coder.accounts.decode('Position', Buffer.from(account.data)) as {
        market_id: string
        is_yes: boolean
        payout_claimed: boolean
        contracts: unknown
        total_cost_usd: unknown
        open_orders: unknown
        realized_pnl_usd: unknown
      }

      rows.push({
        address,
        marketId: decoded.market_id,
        isYes: decoded.is_yes,
        payoutClaimed: decoded.payout_claimed,
        contracts: toBigInt(decoded.contracts),
        totalCostUsd6: toBigInt(decoded.total_cost_usd),
        openOrders: toNumber(decoded.open_orders),
        realizedPnlUsd6: toBigInt(decoded.realized_pnl_usd),
      })
    } catch {
      // Skip undecodable account payloads.
    }
  }

  return rows
}

function decodePendingOrders(
  orderMap: Record<string, { exists: boolean; data?: Uint8Array }>,
): PredictionOrder[] {
  const rows: PredictionOrder[] = []

  for (const [address, account] of Object.entries(orderMap)) {
    if (!account.exists || !account.data) continue

    try {
      const decoded = coder.accounts.decode('Order', Buffer.from(account.data)) as {
        market_id: string
        is_yes: boolean
        is_buy: boolean
        status: unknown
        contracts: unknown
        max_fill_price_usd: unknown
        filled_contracts: unknown
        created_at: unknown
      }

      if (!isPendingOrderStatus(decoded.status)) continue

      rows.push({
        address,
        marketId: decoded.market_id,
        isYes: decoded.is_yes,
        isBuy: decoded.is_buy,
        contracts: toBigInt(decoded.contracts),
        maxFillPriceUsd6: toBigInt(decoded.max_fill_price_usd),
        filledContracts: toBigInt(decoded.filled_contracts),
        createdAt: toBigInt(decoded.created_at),
      })
    } catch {
      // Skip undecodable account payloads.
    }
  }

  return rows
}

function decodeVaults(
  vaultMap: Record<string, { exists: boolean; data?: Uint8Array }>,
): Vault[] {
  const vaults: Vault[] = []

  for (const account of Object.values(vaultMap)) {
    if (!account.exists || !account.data) continue

    try {
      const decoded = coder.accounts.decode('Vault', Buffer.from(account.data)) as {
        settlement_mint: { toBase58: () => string }
      }

      vaults.push({ settlementMint: decoded.settlement_mint.toBase58() })
    } catch {
      // Skip undecodable account payloads.
    }
  }

  return vaults
}

function decodeMarketResults(
  marketIds: string[],
  accountsMap: Record<string, { exists: boolean; data?: Uint8Array }>,
): Map<string, MarketResult> {
  const byMarketId = new Map<string, MarketResult>()

  for (const marketId of marketIds) {
    const address = deriveMarketResultAddress(marketId)
    const account = accountsMap[address]
    if (!account?.exists || !account.data) continue

    try {
      const decoded = coder.accounts.decode('MarketResult', Buffer.from(account.data)) as {
        market_id: string
        is_yes: boolean
        settlement_time: unknown
        claims_enabled: boolean
      }

      byMarketId.set(marketId, {
        marketId: decoded.market_id,
        isYes: decoded.is_yes,
        settlementTime: toBigInt(decoded.settlement_time),
        claimsEnabled: decoded.claims_enabled,
      })
    } catch {
      // Skip undecodable account payloads.
    }
  }

  return byMarketId
}

export const jupiterPredictionIntegration: SolanaIntegration = {
  platformId: 'jupiter-prediction',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const phase0Map = yield [
      {
        kind: 'getProgramAccounts' as const,
        programId: PROGRAM_ID,
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
              offset: OWNER_OFFSET,
              bytes: address,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: PROGRAM_ID,
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
              offset: OWNER_OFFSET,
              bytes: address,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: PROGRAM_ID,
        cacheTtlMs: 5 * 60 * 1000,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: VAULT_DISCRIMINATOR_B64,
              encoding: 'base64',
            },
          },
        ],
      },
    ]

    const positions = decodePositions(phase0Map)
    const orders = decodePendingOrders(phase0Map)
    const vaults = decodeVaults(phase0Map)

    if (positions.length === 0 && orders.length === 0) return []

    const selectedVault =
      vaults.find((vault) => vault.settlementMint === DEFAULT_SETTLEMENT_MINT) ??
      vaults[0]

    const settlementMint = selectedVault?.settlementMint ?? DEFAULT_SETTLEMENT_MINT

    const { marketIds, addresses: marketResultAddresses } = collectMarketResultRequests(
      positions,
      orders,
    )

    const phase1Addresses = [...new Set([settlementMint, ...marketResultAddresses])]
    const phase1Map = phase1Addresses.length > 0 ? yield phase1Addresses : {}

    const settlementMintAccount = phase1Map[settlementMint]
    const settlementDecimals =
      settlementMintAccount?.exists && settlementMintAccount.data
        ? decodeMintDecimals(settlementMintAccount.data) ?? USD6_DECIMALS
        : USD6_DECIMALS

    const marketResults = decodeMarketResults(marketIds, phase1Map)

    const settlementToken = tokens.get(settlementMint)
    const settlementPriceUsd =
      settlementMint === DEFAULT_SETTLEMENT_MINT ? 1 : settlementToken?.priceUsd

    const now = BigInt(Math.floor(Date.now() / 1000))
    const grouped = groupPositions(positions, orders)

    const result: UserDefiPosition[] = []

    for (const group of grouped) {
      const position = group.position
      const marketName = parseMarketId(group.marketId)
      const pendingOrders = [...group.orders].sort((left, right) =>
        left.address.localeCompare(right.address),
      )

      const contracts = position?.contracts ?? 0n
      const totalCostUsd6 = position?.totalCostUsd6 ?? 0n
      const totalCostRaw = scaleRaw(totalCostUsd6, USD6_DECIMALS, settlementDecimals)

      const marketResult = marketResults.get(group.marketId)
      const isSettled =
        marketResult?.claimsEnabled === true && marketResult.settlementTime <= now
      const isWinning = isSettled && marketResult?.isYes === group.isYes
      const payoutRaw = isWinning ? contracts * 10n ** BigInt(settlementDecimals) : 0n

      const hasClaimableReward =
        position !== null && contracts > 0n && !position.payoutClaimed && isWinning

      if (contracts === 0n && pendingOrders.length === 0 && !hasClaimableReward) {
        continue
      }

      const deposited =
        totalCostRaw > 0n
          ? [
              buildPositionValue(
                settlementMint,
                totalCostRaw,
                settlementDecimals,
                settlementPriceUsd,
              ),
            ]
          : undefined

      const buyOrders: TradingOrder[] = []
      const sellOrders: TradingOrder[] = []

      for (const order of pendingOrders) {
        if (order.contracts <= 0n) continue

        const notionalRaw = order.contracts * 10n ** BigInt(settlementDecimals)
        const maxFillCostRaw = scaleRaw(
          order.maxFillPriceUsd6 * order.contracts,
          USD6_DECIMALS,
          settlementDecimals,
        )

        const tradingOrder: TradingOrder = {
          side: order.isBuy ? 'buy' : 'sell',
          selling: buildPositionValue(
            settlementMint,
            order.isBuy ? maxFillCostRaw : notionalRaw,
            settlementDecimals,
            settlementPriceUsd,
          ),
          buying: buildPositionValue(
            settlementMint,
            order.isBuy ? notionalRaw : maxFillCostRaw,
            settlementDecimals,
            settlementPriceUsd,
          ),
          limitPrice: formatDecimal(order.maxFillPriceUsd6, USD6_DECIMALS),
          status: 'open',
          ...(order.contracts > 0n && {
            filledFraction: formatDecimal(
              (order.filledContracts * 1_000_000n) / order.contracts,
              USD6_DECIMALS,
            ),
          }),
        }

        if (order.isBuy) buyOrders.push(tradingOrder)
        else sellOrders.push(tradingOrder)
      }

      const tradingPosition: TradingDefiPosition = {
        platformId: 'jupiter-prediction',
        positionKind: 'trading',
        marketType: 'spot',
        marginEnabled: false,
        ...(deposited && { deposited }),
        ...(buyOrders.length > 0 && { buyOrders }),
        ...(sellOrders.length > 0 && { sellOrders }),
        ...(contracts > 0n && {
          positions: [
            {
              side: group.isYes ? 'long' : 'short',
              size: buildPositionValue(
                settlementMint,
                contracts * 10n ** BigInt(settlementDecimals),
                settlementDecimals,
                settlementPriceUsd,
              ),
              notionalUsd: contracts.toString(),
              ...(contracts > 0n && {
                entryPrice: formatDecimal(totalCostUsd6 / contracts, USD6_DECIMALS),
              }),
              ...(position && {
                realizedPnl: formatDecimal(
                  scaleRaw(position.realizedPnlUsd6, USD6_DECIMALS, settlementDecimals),
                  settlementDecimals,
                ),
              }),
              ...(isSettled && {
                markPrice: marketResult?.isYes ? '1' : '0',
                unrealizedPnl: formatDecimal(payoutRaw - totalCostRaw, settlementDecimals),
              }),
            },
          ],
        }),
        ...(isSettled && { usdValue: formatDecimal(payoutRaw, settlementDecimals) }),
        meta: {
          jupiterPrediction: {
            marketName,
            marketId: group.marketId,
            isYes: group.isYes,
            outcome: group.isYes ? 'yes' : 'no',
            status: isSettled ? 'settled' : 'open',
            settlementMint,
            payoutPerContract: formatDecimal(10n ** BigInt(settlementDecimals), settlementDecimals),
            contracts: contracts.toString(),
            payoutClaimed: position?.payoutClaimed ?? false,
            openOrders: pendingOrders.length,
            positionAddress: position?.address,
            ...(isSettled && marketResult && {
              settlementTimeIso: new Date(
                Number(marketResult.settlementTime) * 1000,
              ).toISOString(),
            }),
            marketResult:
              marketResult && isSettled
                ? {
                    isYes: marketResult.isYes,
                    claimsEnabled: marketResult.claimsEnabled,
                    settlementTime: marketResult.settlementTime.toString(),
                  }
                : undefined,
            pendingOrders: pendingOrders.map((order) => ({
              address: order.address,
              isBuy: order.isBuy,
              contracts: order.contracts.toString(),
              maxFillPriceUsd6: order.maxFillPriceUsd6.toString(),
              createdAt: order.createdAt.toString(),
            })),
          },
        },
      }

      result.push(tradingPosition)

      if (hasClaimableReward) {
        const rewardPosition: RewardDefiPosition = {
          platformId: 'jupiter-prediction',
          positionKind: 'reward',
          sourceId: group.marketId,
          claimable: [
            buildPositionValue(
              settlementMint,
              contracts * 10n ** BigInt(settlementDecimals),
              settlementDecimals,
              settlementPriceUsd,
            ),
          ],
          meta: {
            jupiterPrediction: {
              marketName,
              marketId: group.marketId,
              isYes: group.isYes,
              outcome: group.isYes ? 'yes' : 'no',
              positionAddress: position?.address,
              settlementMint,
              ...(isSettled && marketResult && {
                settlementTimeIso: new Date(
                  Number(marketResult.settlementTime) * 1000,
                ).toISOString(),
              }),
            },
          },
        }

        result.push(rewardPosition)
      }
    }

    return result
  },
}

export default jupiterPredictionIntegration
