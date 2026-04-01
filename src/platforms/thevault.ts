import type { Platform } from '../types/platform'

const thevaultPlatform = {
  id: 'thevault' as const,
  networks: ['solana'],
  name: 'The Vault',
  image: 'https://thevault.finance/metadata/favicon.ico',
  description: 'Community-driven liquid staking and governance on Solana',
  tags: ['staking', 'governance'],
  links: {
    website: 'https://thevault.finance/',
    documentation: 'https://docs.thevault.finance/',
  },
} satisfies Platform

export default thevaultPlatform
