import type { Platform } from '../types/platform'

const ratexPlatform = {
  id: 'ratex' as const,
  networks: ['solana'],
  name: 'Rate-X',
  image: 'https://icons.llama.fi/ratex-dex.jpg',
  description: "World's 1st Leveraged Yield Exchange on Solana",
  tags: [],
  defiLlamaId: 'ratex-dex',
} satisfies Platform

export default ratexPlatform
