import type { Platform } from '../types/platform'

const driftPlatform = {
  id: 'drift' as const,
  networks: ['solana'],
  name: 'Drift',
  image: 'https://docs.drift.trade/assets/favicon.svg',
  description: 'Drift spot margin deposits and borrows on Solana',
  tags: [],
  links: {
    website: 'https://app.drift.trade',
  },
} satisfies Platform

export default driftPlatform
