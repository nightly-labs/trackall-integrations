import type {
  BaseDefiPosition,
  PositionKind,
  PositionValue,
} from './positionCommon'

export interface LendingSuppliedAsset extends PositionValue {
  /** Collateral factor for this supplied token, decimal string. */
  collateralFactor?: string
  /** Supply rate (APR/APY decimal string). */
  supplyRate?: string
}

export interface LendingBorrowedAsset extends PositionValue {
  /** Borrow interest rate (APR/APY decimal string). */
  borrowRate?: string
  /** Maintenance ratio / collateral requirement for this borrowed token (decimal string). */
  maintenanceRatio?: string
}

export interface LendingDefiPosition extends BaseDefiPosition {
  /** Position discriminator for switch-based narrowing. */
  positionKind: Extract<PositionKind, 'lending'>
  /** Deposited/locked assets in lending protocol, if present. */
  supplied?: LendingSuppliedAsset[]
  /** Borrowed debt assets, if present. */
  borrowed?: LendingBorrowedAsset[]
  /** Optional annual interest rate in decimal percentage string. */
  apy?: string
  /** Optional health factor (decimal string). */
  healthFactor?: string
}
