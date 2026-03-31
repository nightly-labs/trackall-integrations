import type { Platform } from '../types/platform'

const diversifiPlatform = {
  id: 'diversifi' as const,
  networks: ['solana'],
  name: 'DiversiFi',
  image: 'https://app.diversifi.trade/favicon-32x32.png',
  description: 'Auto-rebalanced crypto index baskets on Solana',
  tags: ['defi'],
  links: {
    website: 'https://app.diversifi.trade',
  },
} satisfies Platform

export default diversifiPlatform
