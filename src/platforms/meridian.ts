import type { Platform } from '../types/platform'

const meridianPlatform = {
  id: 'meridian' as const,
  networks: ['movement'],
  name: 'Meridian',
  image: 'https://app.meridian.money/assets/og.png',
  description: 'Meridian lending and liquidity on Movement',
  tags: ['dex', 'lending'],
  links: {
    website: 'https://app.meridian.money/',
  },
} satisfies Platform

export default meridianPlatform
