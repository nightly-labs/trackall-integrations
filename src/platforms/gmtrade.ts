import type { Platform } from '../types/platform'

const gmtradePlatform = {
  id: 'gmtrade' as const,
  networks: ['solana'],
  name: 'GMTrade',
  image: 'https://gmtrade.xyz/favicon/favicon-192x192.svg',
  description: 'Perpetual futures and RWA markets on Solana',
  tags: ['dex', 'defi'],
  links: {
    website: 'https://gmtrade.xyz',
    documentation: 'https://docs.gmtrade.xyz/',
    github: 'https://github.com/gmsol-labs/gmx-solana',
  },
} satisfies Platform

export default gmtradePlatform
