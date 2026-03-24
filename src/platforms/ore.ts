import type { Platform } from '../types/platform'

const orePlatform = {
  id: 'ore' as const,
  networks: ['solana'],
  name: 'ORE',
  image: 'https://ore.supply/assets/logo-black.svg',
  description: 'Proof-of-work mining and staking protocol on Solana',
  tags: [],
  defiLlamaId: 'ore',
} satisfies Platform

export default orePlatform
