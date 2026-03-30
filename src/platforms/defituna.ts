import type { Platform } from '../types/platform'

const defitunaPlatform = {
  id: 'defituna' as const,
  networks: ['solana'],
  name: 'DefiTuna',
  image: 'https://github.com/DefiTuna.png',
  description:
    'DefiTuna lending, leveraged liquidity, and spot-margin exposure on Solana',
  tags: ['lending', 'dex'],
  defiLlamaId: 'defituna',
  links: {
    website: 'https://defituna.com',
    documentation: 'https://docs.defituna.com',
    github: 'https://github.com/DefiTuna/tuna-sdk',
  },
} satisfies Platform

export default defitunaPlatform
