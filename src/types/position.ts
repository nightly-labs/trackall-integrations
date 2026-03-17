export * from './positionCommon'
export * from './lending'
export * from './liquidity'
export * from './staking'

import { LendingDefiPosition } from './lending'
import { LiquidityDefiPosition } from './liquidity'
import { StakingDefiPosition } from './staking'

export type UserDefiPosition = LendingDefiPosition | StakingDefiPosition | LiquidityDefiPosition
