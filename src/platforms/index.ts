import type { Platform } from '../types/platform'
import canopyPlatform from './canopy'
import driftPlatform from './drift'
import echelonPlatform from './echelon'
import jupiterDaoPlatform from './jupiter-dao'
import jupiterLendPlatform from './jupiter'
import kaminoPlatform from './kamino'
import luloPlatform from './lulo'
import meridianPlatform from './meridian'
import meteoraPlatform from './meteora'
import mosaicPlatform from './mosaic'
import movepositionPlatform from './moveposition'
import orcaPlatform from './orca'
import orePlatform from './ore'
import raydiumPlatform from './raydium'
import yuzuPlatform from './yuzu'

export const platforms = [
  driftPlatform,
  meteoraPlatform,
  jupiterDaoPlatform,
  jupiterLendPlatform,
  kaminoPlatform,
  luloPlatform,
  meridianPlatform,
  mosaicPlatform,
  movepositionPlatform,
  orcaPlatform,
  orePlatform,
  raydiumPlatform,
  yuzuPlatform,
  canopyPlatform,
  echelonPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
