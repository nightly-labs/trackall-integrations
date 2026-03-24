import type { Platform } from '../types/platform'

const yuzuPlatform = {
  id: 'yuzu' as const,
  networks: ['movement'],
  name: 'Yuzu',
  image: 'https://www.yuzu.finance/fruit-logo.png',
  description: 'Yuzu CLMM on Movement',
  tags: [],
  defiLlamaId: 'yuzu',
} satisfies Platform

export default yuzuPlatform
