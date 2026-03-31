import type { Platform } from '../types/platform'

const symmetryPlatform = {
  id: 'symmetry' as const,
  networks: ['solana'],
  name: 'Symmetry',
  image: 'https://app.symmetry.fi/icon.png',
  description: 'Multi-token vault baskets on Solana with automated rebalancing',
  tags: ['defi'],
  links: {
    website: 'https://app.symmetry.fi',
    documentation: 'https://docs.symmetry.fi',
  },
} satisfies Platform

export default symmetryPlatform
