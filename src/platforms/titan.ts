import type { Platform } from '../types/platform'

const titanPlatform = {
  id: 'titan' as const,
  networks: ['solana'],
  name: 'Titan',
  image: 'https://titan.exchange/favicon.ico',
  description:
    'Titan finds every way possible to lower fees and maximize your gains.',
  tags: ['dex', 'defi'],
  links: {
    website: 'https://titan.exchange/swap',
    documentation: 'https://titan-exchange.gitbook.io/titan',
  },
} satisfies Platform

export default titanPlatform
