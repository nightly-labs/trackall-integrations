import type { Platform } from '../types/platform'

const jupiterDaoPlatform = {
  id: 'jupiter-dao' as const,
  networks: ['solana'],
  name: 'Jupiter DAO',
  image: 'https://jup.ag/favicon.ico',
  description:
    'Stake JUP in Jupiter DAO, track locked governance positions and ASR rewards on Solana',
  tags: ['staking', 'governance'],
  links: {
    website: 'https://vote.jup.ag',
  },
} satisfies Platform

export default jupiterDaoPlatform
