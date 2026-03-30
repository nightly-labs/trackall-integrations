import type { Platform } from '../types/platform'

const nirvanaPlatform = {
  id: 'nirvana' as const,
  networks: ['solana'],
  name: 'Nirvana',
  image: 'https://app.nirvana.finance/favicon.png',
  description: 'ANA staking and prANA rewards on Solana',
  tags: ['staking', 'governance'],
  links: {
    website: 'https://app.nirvana.finance',
  },
} satisfies Platform

export default nirvanaPlatform
