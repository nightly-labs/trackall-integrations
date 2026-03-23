import type { Platform } from '../types/platform'

const kaminoPlatform = {
  id: 'kamino' as const,
  networks: ['solana'],
  name: 'Kamino',
  image: 'https://kamino.finance/favicon.ico',
  description: 'Kamino Lending obligations and Earn vault shares on Solana',
  tags: ['lending', 'staking'],
} satisfies Platform

export default kaminoPlatform
