import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const manifestPlatform = {
  id: 'manifest' as const,
  networks: ['solana'],
  name: 'Manifest',
  image: 'https://manifest.trade/og-image.png',
  description: 'Manifest spot orderbook markets on Solana',
  tags: [PlatformTag.Dex, PlatformTag.DeFi],
  links: {
    website: 'https://manifest.trade',
    github: 'https://github.com/Bonasa-Tech/manifest',
  },
} satisfies Platform

export default manifestPlatform
