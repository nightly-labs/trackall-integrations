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
      .map(async (entry) => ({
        name: entry.name,
        module: (await import(
          new URL(`${entry.name}/index.ts`, dir).href
        )) as Record<string, unknown>,
      })),
  )
}

function getProgramIdsFromModule(
  moduleName: string,
  module: Record<string, unknown>,
): readonly string[] {
  const value = module.PROGRAM_IDS
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Solana integration "${moduleName}" must export a non-empty PROGRAM_IDS array`,
    )
  }

  if (!value.every((item): item is string => typeof item === 'string')) {
    throw new Error(
      `Solana integration "${moduleName}" has an invalid PROGRAM_IDS export; all items must be strings`,
    )
  }

  return value
}

const [solanaModules, movementModules] = await Promise.all([
  loadIntegrations(solanaDir),
  loadIntegrations(movementDir),
])

export const solanaIntegrations: SolanaIntegration[] = solanaModules.map(
  (entry) => entry.module.default as SolanaIntegration,
)
export const movementIntegrations: AptosIntegration[] = movementModules.map(
  (entry) => entry.module.default as AptosIntegration,
)
export const solanaIndexedPrograms = [
  ...new Set(
    solanaModules.flatMap((entry) =>
      getProgramIdsFromModule(entry.name, entry.module),
    ),
  ),
]

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
