import type { Platform } from '../types/platform'

const project0Platform = {
  id: 'project0' as const,
  networks: ['solana'],
  name: 'Project 0',
  image: 'https://0.xyz/favicon.ico',
  description:
    'Permissionless yield and credit positions powered by Project 0 on Solana',
  tags: ['lending'],
  links: {
    website: 'https://0.xyz',
    documentation: 'https://docs.0.xyz',
    github: 'https://github.com/0dotxyz/marginfi-v2',
  },
} satisfies Platform

export default project0Platform
