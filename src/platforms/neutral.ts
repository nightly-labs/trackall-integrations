import type { Platform } from '../types/platform'

const neutralPlatform = {
  id: 'neutral' as const,
  networks: ['solana'],
  name: 'Neutral Trade',
  image: 'https://www.neutral.trade/favicon.ico',
  description: 'Neutral Trade strategy vaults on Solana',
  tags: ['defi', 'lending'],
  links: {
    website: 'https://www.neutral.trade/portfolio',
    documentation: 'https://docs.neutral.trade/',
  },
} satisfies Platform

export default neutralPlatform
