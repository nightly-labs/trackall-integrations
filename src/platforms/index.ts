import type { Platform } from '../types/platform'
import canopyPlatform from './canopy'
import carrotPlatform from './carrot'
import driftPlatform from './drift'
import echelonPlatform from './echelon'
import jupiterLendPlatform from './jupiter'
import jupiterDaoPlatform from './jupiter-dao'
import kaminoPlatform from './kamino'
import luloPlatform from './lulo'
import manifestPlatform from './manifest'
import meridianPlatform from './meridian'
import meteoraPlatform from './meteora'
import mosaicPlatform from './mosaic'
import movepositionPlatform from './moveposition'
import orcaPlatform from './orca'
import orePlatform from './ore'
import ratexPlatform from './ratex'
import raydiumPlatform from './raydium'
import realmsPlatform from './realms'
import savePlatform from './save'
import yuzuPlatform from './yuzu'

export const platforms = [
  carrotPlatform,
  driftPlatform,
  meteoraPlatform,
  jupiterDaoPlatform,
  jupiterLendPlatform,
  kaminoPlatform,
  luloPlatform,
  manifestPlatform,
  meridianPlatform,
  mosaicPlatform,
  movepositionPlatform,
  orcaPlatform,
  orePlatform,
  ratexPlatform,
  raydiumPlatform,
  realmsPlatform,
  savePlatform,
  yuzuPlatform,
  canopyPlatform,
  echelonPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
