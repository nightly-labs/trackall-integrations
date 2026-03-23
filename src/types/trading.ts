import type {
  BaseDefiPosition,
  PositionKind,
  PositionValue,
} from './positionCommon'

export type TradingPositionType = 'deposit' | 'limit-order'

export type TradingPositionStatus =
  | 'open'
  | 'partially-filled'
  | 'filled'
  | 'cancelled'

export type TradingSide = 'buy' | 'sell'

export interface TradingDefiPosition extends BaseDefiPosition {
  /** Position discriminator for switch-based narrowing. */
  positionKind: Extract<PositionKind, 'trading'>
  /** Trading-specific subtype for deposits vs active orders. */
  tradingType: TradingPositionType
  /** Optional market address associated with this trading position. */
  marketAddress?: string
  /** Idle balances deposited on the venue and available for trading. */
  deposited?: PositionValue[]
  /** Asset currently being sold by an active order. */
  selling?: PositionValue
  /** Asset currently being bought by an active order. */
  buying?: PositionValue
  /** Fraction of the order filled, as a decimal string from 0 to 1. */
  filledFraction?: string
  /** Side of the active order from the user's perspective. */
  side?: TradingSide
  /** Limit price expressed in units of buying per selling. */
  limitPrice?: string
  /** Client-provided order identifier, if supported by the venue. */
  clientOrderId?: string
  /** Venue-native order identifier or sequence number. */
  orderSequenceNumber?: string
  /** Current status of the trading position, if exposed. */
  status?: TradingPositionStatus
}
