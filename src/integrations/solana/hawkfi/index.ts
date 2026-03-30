import { PublicKey } from '@solana/web3.js'

import type {
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import {
  meteoraIntegration,
  PROGRAM_IDS as METEORA_PROGRAM_IDS,
} from '../meteora'
import { orcaIntegration, PROGRAM_IDS as ORCA_PROGRAM_IDS } from '../orca'
import {
  PROGRAM_IDS as RAYDIUM_PROGRAM_IDS,
  raydiumIntegration,
} from '../raydium'

const HAWKFI_PLATFORM_ID = 'hawkfi' as const
const HAWKFI_MAIN_PROGRAM_ID = 'FqGg2Y1FNxMiGd51Q6UETixQWkF5fB92MysbYogRJb3P'
const HAWKFI_EXTENSION_PROGRAM_ID =
  'EZiUb6ydWpR3ciizBTJ1J36KCqLyPKVjh4yZEJbs5Uno'

const FARM_ACCOUNT_MULTI_DISCRIMINATOR_B64 = Buffer.from([
  106, 215, 38, 140, 164, 236, 159, 54,
]).toString('base64')

const USER_PDA_SEED = 'multi-user'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [
  HAWKFI_MAIN_PROGRAM_ID,
  HAWKFI_EXTENSION_PROGRAM_ID,
  ...ORCA_PROGRAM_IDS,
  ...METEORA_PROGRAM_IDS,
  ...RAYDIUM_PROGRAM_IDS,
] as const

function deriveUserPda(wallet: string, farm: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(USER_PDA_SEED),
      new PublicKey(farm).toBuffer(),
      new PublicKey(wallet).toBuffer(),
    ],
    new PublicKey(HAWKFI_MAIN_PROGRAM_ID),
  )

  return pda.toBase58()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function attachHawkfiMeta(
  position: UserDefiPosition,
  sourcePlatform: string,
  userPda: string,
  farm: string,
): UserDefiPosition {
  const existingMeta = position.meta ?? {}
  const existingHawkfiMeta = existingMeta.hawkfi

  return {
    ...position,
    platformId: HAWKFI_PLATFORM_ID,
    meta: {
      ...existingMeta,
      hawkfi: {
        ...(isRecord(existingHawkfiMeta) ? existingHawkfiMeta : {}),
        sourcePlatform,
        userPda,
        farm,
      },
    },
  }
}

export const hawkfiIntegration: SolanaIntegration = {
  platformId: HAWKFI_PLATFORM_ID,

  getUserPositions: async function* (
    address: string,
    { endpoint, tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const farmAccounts = yield {
      kind: 'getProgramAccounts' as const,
      programId: HAWKFI_MAIN_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: FARM_ACCOUNT_MULTI_DISCRIMINATOR_B64,
            encoding: 'base64',
          },
        },
      ],
    }

    const farms = Object.values(farmAccounts)
      .filter((account) => account.exists)
      .map((account) => account.address)

    if (farms.length === 0) return []

    const uniqueFarms = [...new Set(farms)]
    const userPdaToFarm = new Map<string, string>()
    const candidateUserPdas = uniqueFarms.map((farm) => {
      const userPda = deriveUserPda(address, farm)
      userPdaToFarm.set(userPda, farm)
      return userPda
    })

    const userPdaAccounts = yield candidateUserPdas
    const existingUserPdas = candidateUserPdas.filter(
      (userPda) => userPdaAccounts[userPda]?.exists,
    )

    if (existingUserPdas.length === 0) return []

    const result: UserDefiPosition[] = []
    const sourceIntegrations = [
      orcaIntegration,
      meteoraIntegration,
      raydiumIntegration,
    ]

    for (const userPda of existingUserPdas) {
      const farm = userPdaToFarm.get(userPda)
      if (!farm) continue

      for (const sourceIntegration of sourceIntegrations) {
        if (!sourceIntegration.getUserPositions) continue

        const sourcePlatform = sourceIntegration.platformId

        const sourcePositions = yield* sourceIntegration.getUserPositions(
          userPda,
          { endpoint, tokens },
        )

        for (const sourcePosition of sourcePositions) {
          result.push(
            attachHawkfiMeta(sourcePosition, sourcePlatform, userPda, farm),
          )
        }
      }
    }

    return result
  },
}

export default hawkfiIntegration
