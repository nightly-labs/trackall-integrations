import type { Platform } from '../types/platform'

const echelonPlatform = {
  id: 'echelon' as const,
  networks: ['movement'],
  name: 'Echelon',
  image: 'https://app.echelon.market/apple-touch-icon.png',
  description: 'Echelon non-custodial lending protocol on Movement',
  tags: ['lending'],
  links: {
    website: 'https://app.echelon.market/',
    documentation: 'https://docs.echelon.market/',
  },
} satisfies Platform

export default echelonPlatform
