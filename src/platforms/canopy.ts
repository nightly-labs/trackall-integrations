import type { Platform } from '../types/platform'

const canopyPlatform = {
  id: 'canopy' as const,
  networks: ['movement'],
  name: 'Canopy',
  image: 'https://app.canopyhub.xyz/canopy_512x512_light.svg',
  description:
    'Movement DeFi yield aggregation platform with lending and liquidity vaults',
  tags: ['defi', 'lending', 'dex'],
  links: {
    website: 'https://app.canopyhub.xyz/',
    documentation: 'https://docs.canopyhub.xyz/',
    discord: 'https://discord.com/invite/canopy-1253202292275150890',
    twitter: 'https://x.com/canopyxyz',
  },
} satisfies Platform

export default canopyPlatform
