import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const kaminoPlatform = {
  id: 'kamino' as const,
  networks: ['solana'],
  name: 'Kamino',
  image: 'https://kamino.finance/favicon.ico',
  description: 'Kamino Lending obligations and Earn vault shares on Solana',
  tags: [PlatformTag.Lending, PlatformTag.Staking],
} satisfies Platform

export default kaminoPlatform
