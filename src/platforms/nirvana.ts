import type { Platform } from '../types/platform'

const nirvanaPlatform = {
  id: 'nirvana' as const,
  networks: ['solana'],
  name: 'Nirvana',
  image: 'https://app.nirvana.finance/favicon.png',
  description: 'ANA staking and prANA rewards on Solana',
  tags: ['staking', 'governance'],
} satisfies Platform

export default nirvanaPlatform
