import { readdir } from 'node:fs/promises'
import type { AptosIntegration } from './src/types/aptosIntegration'
import type { SolanaIntegration } from './src/types/solanaIntegration'

const solanaDir = new URL('./src/integrations/solana/', import.meta.url)
const movementDir = new URL('./src/integrations/movement/', import.meta.url)

async function loadIntegrations(dir: URL) {
  const entries = await readdir(dir, { withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => import(new URL(`${entry.name}/index.ts`, dir).href)),
  )
}

const [solanaModules, movementModules] = await Promise.all([
  loadIntegrations(solanaDir),
  loadIntegrations(movementDir),
])

export const solanaIntegrations: SolanaIntegration[] = solanaModules.map(
  (m) => m.default,
)
export const movementIntegrations: AptosIntegration[] = movementModules.map(
  (m) => m.default,
)

// Types
export type {
  AptosAddress,
  AptosAccountsMap,
  AptosIntegration,
  AptosPlugins,
  AptosResource,
} from './src/types/aptosIntegration'
export type { SolanaIntegration, SolanaPlugins } from './src/types/solanaIntegration'
export type {
  AccountsMap,
  MaybeSolanaAccount,
  ProgramAccountFilter,
  ProgramRequest,
  SolanaAccount,
  SolanaAccountNotFound,
  SolanaAddress,
  UserPositionsPlan,
} from './src/types/solanaIntegration'
export type { Platform, PlatformLinks } from './src/types/platform'
export { PlatformTag } from './src/types/platformTag'
export type {
  UserDefiPosition,
  LendingDefiPosition,
  LendingSuppliedAsset,
  LendingBorrowedAsset,
  StakingDefiPosition,
  StakedAsset,
  LiquidityDefiPosition,
  BaseLiquidityDefiPosition,
  ConstantProductLiquidityDefiPosition,
  ConcentratedRangeLiquidityDefiPosition,
  LiquidityModel,
  VestingDefiPosition,
  VestingAsset,
  RewardDefiPosition,
  BaseDefiPosition,
  PositionKind,
  PositionValue,
  TokenAmount,
} from './src/types/position'
export type { PlatformId } from './src/platforms/index'
export type {
  TokenCreator,
  TokenData,
  TokensMap,
} from './src/plugin/solana/tokens'

// Utilities
export { AptosTokenPlugin } from './src/plugin/aptos/tokens'
export type {
  AptosTokenData,
  AptosTokenIdentifier,
  AptosTokenStandard,
} from './src/plugin/aptos/tokens'
export { platforms } from './src/platforms/index'
export { TokenPlugin } from './src/plugin/solana/tokens'
export { runIntegrations } from './src/types/runner'
export {
  createFetchAccounts,
  createFetchProgramAccounts,
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from './src/utils/solana'
