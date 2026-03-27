import type { Platform } from '../types/platform'

const pythStakingPlatform = {
  id: 'pyth-staking' as const,
  networks: ['solana'],
  name: 'Pyth Staking',
  image: 'https://staking.pyth.network/favicon-32x32.png',
  description:
    'Stake PYTH for governance participation and publisher delegation on Pyth.',
  tags: ['staking', 'governance'],
  links: {
    website: 'https://staking.pyth.network/',
  },
} satisfies Platform

export default pythStakingPlatform
