import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const luloPlatform = {
  id: 'lulo' as const,
  networks: ['solana'],
  name: 'Lulo',
  image: 'https://app.lulo.fi/favicon.ico',
  description: 'Lulo-routed yield positions and lending allocations on Solana',
  tags: [PlatformTag.Lending],
  links: {
    website: 'https://app.lulo.fi',
    documentation: 'https://docs.lulo.fi',
  },
} satisfies Platform

export default luloPlatform
