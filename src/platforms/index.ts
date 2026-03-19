import type { Platform } from '../types/platform'
import jupiterLendPlatform from './jupiter'
import kaminoPlatform from './kamino'
import meridianPlatform from './meridian'
import meteoraPlatform from './meteora'
import movepositionPlatform from './moveposition'
import raydiumPlatform from './raydium'
import yuzuPlatform from './yuzu'

export const platforms = [
  meteoraPlatform,
  jupiterLendPlatform,
  kaminoPlatform,
  meridianPlatform,
  movepositionPlatform,
  raydiumPlatform,
  yuzuPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
