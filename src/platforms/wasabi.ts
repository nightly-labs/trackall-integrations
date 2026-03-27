import type { Platform } from '../types/platform'

const wasabiPlatform = {
  id: 'wasabi' as const,
  networks: ['solana'],
  name: 'Wasabi',
  image: 'https://app.wasabi.xyz/static/favicon/favicon.svg',
  description: 'Wasabi leveraged trading positions on Solana',
  tags: ['dex', 'defi'],
  links: {
    website: 'https://app.wasabi.xyz/',
    documentation: 'https://docs.wasabi.xyz/',
  },
} satisfies Platform

export default wasabiPlatform
