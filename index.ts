/// <reference path="./src/types/import-meta.d.ts" />
import type { SolanaIntegration } from './src/types/index'

const solanaModules = import.meta.glob<{ default: SolanaIntegration }>('./src/solana/*/index.ts', {
  eager: true,
})

export const solanaIntegrations: SolanaIntegration[] = Object.values(solanaModules).map((m) => m.default)
export { platforms } from './src/platforms/index'
export type { PlatformId } from './src/platforms/index'
export type { Platform } from './src/types/platform'
export type { UserDefiPosition } from './src/types/position'
export { runIntegrations } from './src/types/runner'

export { meteoraIntegration } from './src/solana/meteora/index'
export { createFetchAccounts, createFetchProgramAccounts, fetchAccountsBatch, fetchProgramAccountsBatch } from './src/utils/solana'
export { TokenPlugin } from './src/plugin/tokens'
export type { TokenCreator, TokenData, TokensMap } from './src/plugin/tokens'
export type { SolanaPlugins } from './src/types/solanaIntegration'
export { createSolanaRpc } from '@solana/kit'
