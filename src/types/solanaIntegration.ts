import type { Connection } from '@solana/web3.js'
import type { TokenPlugin } from '../plugin/tokens'
import type { Platform } from './platform'
import type { UserDefiPosition } from './position'

export interface SolanaPlugins {
  connection: Connection
  tokens: TokenPlugin
}

export type SolanaAddress = string

export interface SolanaAccount {
  exists: true
  address: SolanaAddress
  lamports: bigint
  programAddress: SolanaAddress
  data: Uint8Array
}

export interface SolanaAccountNotFound {
  exists: false
  address: SolanaAddress
}

export type MaybeSolanaAccount = SolanaAccount | SolanaAccountNotFound

export type AccountsMap = Record<SolanaAddress, MaybeSolanaAccount>
export type UserPositionsPlan = AsyncGenerator<SolanaAddress[], UserDefiPosition[], AccountsMap>

export interface SolanaIntegration {
  /** Platform instance. */
  platform: Platform
  /** Get the total value locked (TVL) of the integration. */
  getTvl?: (plugins: SolanaPlugins) => Promise<string>
  /** Get the volume of the integration. */
  getVolume?: (plugins: SolanaPlugins) => Promise<string>
  /** Get the number of daily active users of the integration. */
  getDailyActiveUsers?: (plugins: SolanaPlugins) => Promise<string>
  /** Get the user positions of the integration. */
  getUserPositions?: (address: string, plugins: SolanaPlugins) => UserPositionsPlan
}
