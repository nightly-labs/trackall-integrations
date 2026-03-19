import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const meridianPlatform = {
  id: 'meridian' as const,
  networks: ['movement'],
  name: 'Meridian',
  image: 'https://app.meridian.money/assets/og.png',
  description: 'Meridian lending and liquidity on Movement',
  tags: [PlatformTag.Dex, PlatformTag.Lending],
  links: {
    website: 'https://app.meridian.money/',
  },
} satisfies Platform

export default meridianPlatform
