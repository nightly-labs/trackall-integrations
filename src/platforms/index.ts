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
import pythStakingPlatform from './pyth-staking'
import ratexPlatform from './ratex'
import raydiumPlatform from './raydium'
import realmsPlatform from './realms'
import yuzuPlatform from './yuzu'
import zeusPlatform from './zeus'

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
  pythStakingPlatform,
  ratexPlatform,
  raydiumPlatform,
  realmsPlatform,
  yuzuPlatform,
  zeusPlatform,
  canopyPlatform,
  echelonPlatform,
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
