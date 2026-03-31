import type { Platform } from '../types/platform'

const byrealPlatform = {
  id: 'byreal' as const,
  networks: ['solana'],
  name: 'Byreal',
  image: 'https://www.byreal.io/favicon.ico',
  description: 'Byreal concentrated liquidity market positions on Solana',
  tags: ['dex', 'defi'],
  links: {
    website: 'https://www.byreal.io/en/market',
    documentation: 'https://docs.byreal.io',
  },
} satisfies Platform

export default byrealPlatform
