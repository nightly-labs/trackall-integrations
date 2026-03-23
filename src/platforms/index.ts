import type { Platform } from '../types/platform'
import canopyPlatform from './canopy'
import driftPlatform from './drift'
import echelonPlatform from './echelon'
import jupiterLendPlatform from './jupiter'
import kaminoPlatform from './kamino'
import meridianPlatform from './meridian'
import meteoraPlatform from './meteora'
import mosaicPlatform from './mosaic'
import movepositionPlatform from './moveposition'
import orcaPlatform from './orca'
import raydiumPlatform from './raydium'
import yuzuPlatform from './yuzu'

export const platforms = [
  driftPlatform,
  meteoraPlatform,
  jupiterLendPlatform,
  kaminoPlatform,
  meridianPlatform,
  mosaicPlatform,
  movepositionPlatform,
  orcaPlatform,
  raydiumPlatform,
  yuzuPlatform,
  canopyPlatform,
  echelonPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
