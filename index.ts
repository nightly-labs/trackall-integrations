import type { SolanaIntegration } from './src/types/index'

const modules = import.meta.glob<{ default: SolanaIntegration }>('./src/solana/*/index.ts', {
  eager: true,
})

export const solanaIntegrations: SolanaIntegration[] = Object.values(modules).map((m) => m.default)

export { meteoraIntegration } from './src/solana/meteora/index'
export { createFetchAccounts, createFetchProgramAccounts, fetchAccountsBatch, fetchProgramAccountsBatch } from './src/utils/solana'
