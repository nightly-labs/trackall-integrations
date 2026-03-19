export * from './lending'
export * from './liquidity'
export * from './positionCommon'
export * from './staking'

import type { LendingDefiPosition } from './lending'
import type { LiquidityDefiPosition } from './liquidity'
import type { StakingDefiPosition } from './staking'

export type UserDefiPosition =
  | LendingDefiPosition
  | StakingDefiPosition
  | LiquidityDefiPosition
