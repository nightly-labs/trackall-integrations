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
import metadaoPlatform from './metadao'
import meridianPlatform from './meridian'
import meteoraPlatform from './meteora'
import mosaicPlatform from './mosaic'
import movepositionPlatform from './moveposition'
import neutralPlatform from './neutral'
import orcaPlatform from './orca'
import orePlatform from './ore'
import project0Platform from './project0'
import pythStakingPlatform from './pyth-staking'
import ratexPlatform from './ratex'
import raydiumPlatform from './raydium'
import realmsPlatform from './realms'
import saberPlatform from './saber'
import savePlatform from './save'
import wasabiPlatform from './wasabi'
import titanPlatform from './titan'
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
  metadaoPlatform,
  meridianPlatform,
  mosaicPlatform,
  movepositionPlatform,
  neutralPlatform,
  orcaPlatform,
  orePlatform,
  project0Platform,
  pythStakingPlatform,
  ratexPlatform,
  raydiumPlatform,
  realmsPlatform,
  saberPlatform,
  savePlatform,
  wasabiPlatform,
  titanPlatform,
  yuzuPlatform,
  zeusPlatform,
  canopyPlatform,
  echelonPlatform
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
