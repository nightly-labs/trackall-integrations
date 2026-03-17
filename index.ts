import type { SolanaIntegration } from '@trackall/shared'
export { meteoraIntegration } from './solana/meteora/index'

import { meteoraIntegration } from './solana/meteora/index'

export const allIntegrations: SolanaIntegration[] = [
  meteoraIntegration,
  // protocol teams add their integration here
]
