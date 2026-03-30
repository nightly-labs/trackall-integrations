import type { Platform } from '../types/platform'

const meteoraPlatform = {
  id: 'meteora' as const,
  networks: ['solana'],
  name: 'Meteora',
  image: 'https://www.meteora.ag/icons/v2.svg',
  description: 'Meteora DLMM liquidity pools on Solana',
  tags: [],
  links: {
    website: 'https://app.meteora.ag',
  },
  defiLlamaId: 'meteora',
} satisfies Platform

export default meteoraPlatform
