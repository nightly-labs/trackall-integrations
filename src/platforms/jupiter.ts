import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const jupiterLendPlatform = {
  id: 'jupiter' as const,
  networks: ['solana'],
  name: 'Jupiter Lend',
  image: 'https://jup.ag/favicon.ico',
  description: 'Jupiter Lend earn — supply assets and track borrow positions on Solana',
  tags: [PlatformTag.Lending],
  defiLlamaId: 'jupiter-lend',
} satisfies Platform

export default jupiterLendPlatform
