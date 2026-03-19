export * from './lending'
export * from './liquidity'
export * from './positionCommon'
export * from './staking'
export * from './vesting'

import type { LendingDefiPosition } from './lending'
import type { LiquidityDefiPosition } from './liquidity'
import type { StakingDefiPosition } from './staking'
import type { VestingDefiPosition } from './vesting'

export type UserDefiPosition =
  | LendingDefiPosition
  | StakingDefiPosition
  | LiquidityDefiPosition
  | VestingDefiPosition
