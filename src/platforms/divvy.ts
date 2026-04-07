import type { Platform } from '../types/platform'

const divvyPlatform = {
  id: 'divvy' as const,
  networks: ['solana'],
  name: 'Divvy',
  image: 'https://divvy.bet/favicon.ico',
  description: 'Divvy house pool staking positions on Solana',
  tags: ['staking'],
  links: {
    website: 'https://divvy.bet',
    twitter: 'https://x.com/DivvyBet',
    discord: 'https://discord.com/invite/divvybet',
  },
} satisfies Platform

export default divvyPlatform
