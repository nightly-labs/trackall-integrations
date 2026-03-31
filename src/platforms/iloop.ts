import type { Platform } from '../types/platform'

const iloopPlatform = {
  id: 'iloop' as const,
  networks: ['solana'],
  name: 'iLoop',
  image: 'https://app.iloop.finance/logo.svg',
  description: 'iLoop is a Solana lending and borrowing protocol for LST assets.',
  tags: ['lending'],
  links: {
    website: 'https://app.iloop.finance',
    documentation: 'https://iloop-1.gitbook.io/docs.iloop.finance',
  },
} satisfies Platform

export default iloopPlatform
