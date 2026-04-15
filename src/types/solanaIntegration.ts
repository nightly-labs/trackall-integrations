import type { PlatformId } from '../platforms/index'
import type { TokenPlugin } from '../plugin/solana/tokens'
import type { UserDefiPosition } from './position'

export interface SolanaPlugins {
  endpoint: string
  tokens: TokenPlugin
}

export type ProgramAccountFilter =
  | {
      memcmp: { offset: number; bytes: string; encoding?: 'base58' | 'base64' }
    }
  | { dataSize: number }

export interface GetProgramAccountsRequest {
  kind: 'getProgramAccounts'
  programId: SolanaAddress
  filters: ProgramAccountFilter[]
  cacheTtlMs?: number
}

export interface GetTokenAccountsByOwnerRequest {
  kind: 'getTokenAccountsByOwner'
  owner: SolanaAddress
  programId: SolanaAddress
  cacheTtlMs?: number
}

export interface GetHttpJsonRequest {
  kind: 'getHttpJson'
  url: string
  keyField?: string
  cacheTtlMs?: number
}

export type ProgramRequest =
  | GetProgramAccountsRequest
  | GetTokenAccountsByOwnerRequest
  | GetHttpJsonRequest

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
export type UserPositionsPlan = AsyncGenerator<
  SolanaAddress[] | ProgramRequest | ProgramRequest[],
  UserDefiPosition[],
  AccountsMap
>

export interface UsersFilter {
  programId: SolanaAddress
  discriminator?: Uint8Array
  ownerOffset: number
  dataSize?: number
}

export interface SolanaIntegration {
  /** Platform identifier. */
  platformId: PlatformId
  /** Get the total value locked (TVL) of the integration. */
  getTvl?: (plugins: SolanaPlugins) => Promise<string>
  /** Get the volume of the integration. */
  getVolume?: (plugins: SolanaPlugins) => Promise<string>
  /** Get the number of daily active users of the integration. */
  getDailyActiveUsers?: (plugins: SolanaPlugins) => Promise<string>
  /** Get the user positions of the integration. */
  getUserPositions?: (
    address: string,
    plugins: SolanaPlugins,
  ) => UserPositionsPlan
  /** Get filters describing how to fetch all users of the integration. */
  getUsersFilter?: () => UsersFilter[]
}
