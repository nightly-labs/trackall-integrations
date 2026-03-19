import type { Platform } from '../types/platform'
import jupiterLendPlatform from './jupiter'
import meteoraPlatform from './meteora'
import raydiumPlatform from './raydium'
import yuzuPlatform from './yuzu'

export const platforms = [
  meteoraPlatform,
  jupiterLendPlatform,
  raydiumPlatform,
  yuzuPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
