import type { Platform } from '../types/platform'
import { PlatformTag } from '../types/platformTag'

const echelonPlatform = {
  id: 'echelon' as const,
  networks: ['movement'],
  name: 'Echelon',
  image: 'https://app.echelon.market/echelon-logo.svg',
  description: 'Echelon non-custodial lending protocol on Movement',
  tags: [PlatformTag.Lending],
  links: {
    website: 'https://app.echelon.market/',
    documentation: 'https://docs.echelon.market/',
  },
} satisfies Platform

export default echelonPlatform
