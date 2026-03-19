import { readdir } from 'node:fs/promises'
import type { SolanaIntegration } from './src/types/index'

const integrationsDir = new URL('./src/solana/', import.meta.url)

const solanaModules = await Promise.all(
  (
    await readdir(integrationsDir, {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        import(new URL(`${entry.name}/index.ts`, integrationsDir).href),
    ),
)

export const solanaIntegrations: SolanaIntegration[] = solanaModules.map(
  (module) => module.default,
)
export { createSolanaRpc } from '@solana/kit'
export type { PlatformId } from './src/platforms/index'
export { platforms } from './src/platforms/index'
export type { TokenCreator, TokenData, TokensMap } from './src/plugin/tokens'
export { TokenPlugin } from './src/plugin/tokens'

export { meteoraIntegration } from './src/solana/meteora/index'
export type { Platform } from './src/types/platform'
export type { UserDefiPosition } from './src/types/position'
export { runIntegrations } from './src/types/runner'
export type { SolanaPlugins } from './src/types/solanaIntegration'
export {
  createFetchAccounts,
  createFetchProgramAccounts,
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from './src/utils/solana'
