import type { Platform } from '../types/platform'

const snsPlatform = {
  id: 'sns' as const,
  networks: ['solana'],
  name: 'SNS',
  image: 'https://v1.sns.id/favicon.ico',
  description: 'Solana Name Service domain offers marketplace',
  tags: ['defi', 'nft'],
  links: {
    website: 'https://sns.id',
  },
} satisfies Platform

export default snsPlatform
