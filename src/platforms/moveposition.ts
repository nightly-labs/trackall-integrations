import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const movepositionPlatform = {
  id: 'moveposition' as const,
  networks: ['movement'],
  name: 'MovePosition',
  image: 'https://app.moveposition.xyz/favicon.png',
  description: 'Next-gen omnichain lending protocol',
  tags: [PlatformTag.Lending],
  links: {
    website: 'https://app.moveposition.xyz/',
    documentation: 'https://docs.moveposition.xyz/',
  },
} satisfies Platform

export default movepositionPlatform
