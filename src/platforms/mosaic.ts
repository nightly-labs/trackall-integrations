import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const mosaicPlatform = {
  id: 'mosaic' as const,
  networks: ['movement'],
  name: 'Mosaic',
  image: 'https://mosaic.ag/mosaic/thum.png',
  description: 'Mosaic AMM liquidity and LP farming on Movement',
  tags: [PlatformTag.Dex],
  links: {
    website: 'https://app.mosaic.ag/',
    documentation: 'https://docs.mosaic.ag/products/liquidity-protocol',
  },
} satisfies Platform

export default mosaicPlatform
