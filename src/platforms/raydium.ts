import type { Platform } from '../types/platform'

const raydiumPlatform = {
  id: 'raydium' as const,
  networks: ['solana'],
  name: 'Raydium',
  image:
    'https://img.raydium.io/icon/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R.png',
  description: 'Raydium CLMM and CP swap pools on Solana',
  tags: [],
  defiLlamaId: 'raydium',
} satisfies Platform

export default raydiumPlatform
