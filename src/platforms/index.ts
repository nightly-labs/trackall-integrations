import type { Platform } from '../types/platform'
import jupiterLendPlatform from './jupiter'
import kaminoPlatform from './kamino'
import meridianPlatform from './meridian'
import meteoraPlatform from './meteora'
import raydiumPlatform from './raydium'
import yuzuPlatform from './yuzu'

export const platforms = [
  meteoraPlatform,
  jupiterLendPlatform,
  kaminoPlatform,
  meridianPlatform,
  raydiumPlatform,
  yuzuPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
