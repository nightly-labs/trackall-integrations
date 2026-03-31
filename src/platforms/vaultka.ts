import type { Platform } from '../types/platform'

const vaultkaPlatform = {
  id: 'vaultka' as const,
  networks: ['solana'],
  name: 'Vaultka',
  image: 'https://solana.vaultka.com/apple-touch-icon.png',
  description:
    'Vaultka V2 lending and leverage positions powered by Marginfi on Solana',
  tags: ['lending'],
  links: {
    website: 'https://solana.vaultka.com',
    documentation: 'https://docs.vaultka.com/welcome-to-vaultka/overview',
    twitter: 'https://twitter.com/Vaultkaofficial',
    telegram: 'https://t.me/vaultkaofficial',
  },
} satisfies Platform

export default vaultkaPlatform
