import type {
  BaseDefiPosition,
  PositionKind,
  PositionValue,
} from './positionCommon'

export type TradingPositionStatus =
  | 'open'
  | 'partially-filled'
  | 'filled'
  | 'cancelled'

export type TradingSide = 'buy' | 'sell'

export type TradingExposureSide = 'long' | 'short'

export interface TradingOrder {
  /** Asset currently reserved/sold by the order. */
  selling: PositionValue
  /** Asset expected from the order if fully filled. */
  buying: PositionValue
  /** Fraction of the order filled, as a decimal string from 0 to 1. */
  filledFraction?: string
  /** Side of the active order from the user's perspective. */
  side: TradingSide
  /** Limit price expressed in units of buying per selling. */
  limitPrice?: string
  /** Client-provided order identifier, if supported by the venue. */
  clientOrderId?: string
  /** Venue-native order identifier or sequence number. */
  orderSequenceNumber?: string
  /** Current status of the trading position, if exposed. */
  status?: TradingPositionStatus
}

export interface TradingMarketPosition {
  /** Optional side of the leveraged/open position. */
  side?: TradingExposureSide
  /** Optional base or contract size of the position. */
  size?: PositionValue
  /** Optional notional USD value for the position. */
  notionalUsd?: string
  /** Optional leverage multiplier as decimal string. */
  leverage?: string
  /** Optional average entry price. */
  entryPrice?: string
  /** Optional current mark/index price. */
  markPrice?: string
  /** Optional liquidation price. */
  liquidationPrice?: string
  /** Optional cumulative funding PnL. */
  fundingPnl?: string
  /** Optional unrealized PnL. */
  unrealizedPnl?: string
  /** Optional realized PnL. */
  realizedPnl?: string
  /** Optional collateral balances tied to the position. */
  collateral?: PositionValue[]
}

export interface TradingDefiPosition extends BaseDefiPosition {
  /** Position discriminator for switch-based narrowing. */
  positionKind: Extract<PositionKind, 'trading'>
  /** Optional market address associated with this trading position. */
  marketAddress?: string
  /** Idle balances deposited on the venue and available for trading. */
  deposited?: PositionValue[]
  /** Active buy-side orders on the venue. */
  buyOrders?: TradingOrder[]
  /** Active sell-side orders on the venue. */
  sellOrders?: TradingOrder[]
  /** Open margin/perp positions, if the venue exposes them. */
  positions?: TradingMarketPosition[]
}
