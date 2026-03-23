import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const jupiterDaoPlatform = {
  id: 'jupiter-dao' as const,
  networks: ['solana'],
  name: 'Jupiter DAO',
  image: 'https://jup.ag/favicon.ico',
  description:
    'Stake JUP in Jupiter DAO, track locked governance positions and ASR rewards on Solana',
  tags: [PlatformTag.Staking, PlatformTag.Governance],
} satisfies Platform

export default jupiterDaoPlatform
