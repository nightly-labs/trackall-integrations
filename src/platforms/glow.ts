import type { Platform } from '../types/platform'

const glowPlatform = {
  id: 'glow' as const,
  networks: ['solana'],
  name: 'Glow',
  image: 'https://app.glowfinance.xyz/favicon.ico',
  description: 'Glow margin account note balances on Solana',
  tags: ['lending', 'defi'],
  links: {
    website: 'https://app.glowfinance.xyz/',
    documentation: 'https://docs.glowfinance.xyz/Overview/welcome',
  },
} satisfies Platform

export default glowPlatform
