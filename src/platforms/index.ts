import type { Platform } from '../types/platform'
import allbridgePlatform from './allbridge'
import banxPlatform from './banx'
import canopyPlatform from './canopy'
import carrotPlatform from './carrot'
import defitunaPlatform from './defituna'
import dflowPlatform from './dflow'
import driftPlatform from './drift'
import echelonPlatform from './echelon'
import glowPlatform from './glow'
import flashtradePlatform from './flashtrade'
import gmtradePlatform from './gmtrade'
import jupiterLendPlatform from './jupiter'
import jupiterDaoPlatform from './jupiter-dao'
import kaminoPlatform from './kamino'
import loopscalePlatform from './loopscale'
import luloPlatform from './lulo'
import manifestPlatform from './manifest'
import meridianPlatform from './meridian'
import metadaoPlatform from './metadao'
import meteoraPlatform from './meteora'
import mosaicPlatform from './mosaic'
import movepositionPlatform from './moveposition'
import neutralPlatform from './neutral'
import nirvanaPlatform from './nirvana'
import omnipairPlatform from './omnipair'
import orcaPlatform from './orca'
import orePlatform from './ore'
import project0Platform from './project0'
import pythStakingPlatform from './pyth-staking'
import ratexPlatform from './ratex'
import raydiumPlatform from './raydium'
import realmsPlatform from './realms'
import saberPlatform from './saber'
import savePlatform from './save'
import stabblePlatform from './stabble'
import titanPlatform from './titan'
import tramplinPlatform from './tramplin'
import wasabiPlatform from './wasabi'
import yuzuPlatform from './yuzu'
import zelofiPlatform from './zelofi'
import zeusPlatform from './zeus'

export const platforms = [
  allbridgePlatform,
  banxPlatform,
  carrotPlatform,
  defitunaPlatform,
  dflowPlatform,
  driftPlatform,
  glowPlatform,
  flashtradePlatform,
  gmtradePlatform,
  meteoraPlatform,
  jupiterDaoPlatform,
  jupiterLendPlatform,
  kaminoPlatform,
  loopscalePlatform,
  luloPlatform,
  manifestPlatform,
  metadaoPlatform,
  meridianPlatform,
  mosaicPlatform,
  movepositionPlatform,
  nirvanaPlatform,
  neutralPlatform,
  omnipairPlatform,
  orcaPlatform,
  orePlatform,
  project0Platform,
  pythStakingPlatform,
  ratexPlatform,
  raydiumPlatform,
  realmsPlatform,
  tramplinPlatform,
  saberPlatform,
  stabblePlatform,
  savePlatform,
  wasabiPlatform,
  titanPlatform,
  yuzuPlatform,
  zelofiPlatform,
  zeusPlatform,
  canopyPlatform,
  echelonPlatform
] as const satisfies readonly Platform[]

export type PlatformId = (typeof platforms)[number]['id']
