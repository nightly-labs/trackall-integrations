import type {
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import {
  PROGRAM_IDS as PROJECT0_PROGRAM_IDS,
  project0Integration,
} from '../project0'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = PROJECT0_PROGRAM_IDS

const VAULTKA_GROUP = '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8'

type Project0Meta = {
  marginfiAccount?: unknown
  group?: unknown
  originProtocol?: unknown
}

function remapVaultkaPositions(
  positions: UserDefiPosition[],
): UserDefiPosition[] {
  const remapped: UserDefiPosition[] = []

  for (const position of positions) {
    const project0Meta = position.meta?.project0
    if (!project0Meta || typeof project0Meta !== 'object') continue

    const typedMeta = project0Meta as Project0Meta
    if (typedMeta.group !== VAULTKA_GROUP) continue

    const { project0: _project0, ...restMeta } = position.meta ?? {}
    remapped.push({
      ...position,
      platformId: 'vaultka',
      meta: {
        ...restMeta,
        vaultka: {
          marginfiAccount: typedMeta.marginfiAccount,
          group: typedMeta.group,
          originProtocol: typedMeta.originProtocol,
        },
      },
    })
  }

  return remapped
}

export const vaultkaIntegration: SolanaIntegration = {
  platformId: 'vaultka',

  getUserPositions: async function* (
    address: string,
    plugins: SolanaPlugins,
  ): UserPositionsPlan {
    const getProject0Positions = project0Integration.getUserPositions
    if (!getProject0Positions) return []

    const upstreamPlan = getProject0Positions(address, plugins)

    let step = await upstreamPlan.next()
    while (!step.done) {
      const accounts = yield step.value
      step = await upstreamPlan.next(accounts)
    }

    return remapVaultkaPositions(step.value)
  },
}

export default vaultkaIntegration
