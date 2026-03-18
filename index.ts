import type { SolanaIntegration } from './src/types/index'
import { readdir } from 'node:fs/promises'

const integrationsDir = new URL('./src/solana/', import.meta.url)

const solanaModules = await Promise.all(
  (
    await readdir(integrationsDir, {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => import(new URL(`${entry.name}/index.ts`, integrationsDir).href)),
)

export const solanaIntegrations: SolanaIntegration[] = solanaModules.map((module) => module.default)
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
