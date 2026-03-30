import type { Platform } from '../types/platform'

const hubbleEarnPlatform = {
  id: 'hubble-earn' as const,
  networks: ['solana'],
  name: 'Hubble Earn',
  image: 'https://app.hubbleprotocol.io/favicon.ico',
  description: 'Hubble Earn strategy share positions on Solana',
  tags: ['staking'],
  links: {
    website: 'https://app.hubbleprotocol.io/earn',
    documentation: 'https://docs.hubbleprotocol.io/',
    github: 'https://github.com/hubbleprotocol/',
  },
} satisfies Platform

export default hubbleEarnPlatform
