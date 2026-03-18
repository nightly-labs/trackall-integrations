import type { Platform } from '../types/platform'

const meteoraPlatform = {
  id: 'meteora' as const,
  networks: ['solana'],
  name: 'Meteora',
  image: 'https://meteora.ag/logo.png',
  description: 'Meteora DLMM liquidity pools on Solana',
  tags: [],
  defiLlamaId: 'meteora',
} satisfies Platform

export default meteoraPlatform
