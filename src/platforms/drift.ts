import type { Platform } from '../types/platform'

const driftPlatform = {
  id: 'drift' as const,
  networks: ['solana'],
  name: 'Drift',
  image: 'https://docs.drift.trade/assets/favicon.svg',
  description: 'Drift spot margin deposits and borrows on Solana',
  tags: [],
} satisfies Platform

export default driftPlatform
