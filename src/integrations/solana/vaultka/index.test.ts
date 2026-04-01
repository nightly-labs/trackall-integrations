import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import {
  runIntegrations,
  TokenPlugin,
  type LendingDefiPosition,
} from '../../../types/index'
import { testIntegration } from '../../../test/solana-integration'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { testAddress, vaultkaIntegration } from './index'

testIntegration(vaultkaIntegration, testAddress)

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const VAULTKA_LEGACY_GROUP = '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8'
const VAULTKA_V2_GROUP = 'groUPysZbKCi8RbcziZFeP1WSFPa31kC9CsdUBggdkc'
const JLP_MINT = '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

function isLendingPosition(position: unknown): position is LendingDefiPosition {
  return (
    typeof position === 'object' &&
    position !== null &&
    'positionKind' in position &&
    (position as { positionKind?: unknown }).positionKind === 'lending'
  )
}

describe('vaultka integration shape', () => {
  it('returns only vaultka-attributed positions for production groups', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    const getUserPositions = vaultkaIntegration.getUserPositions
    if (!getUserPositions) throw new Error('getUserPositions not implemented')

    const [positions] = await runIntegrations(
      [getUserPositions(testAddress, plugins)],
      (addresses) => fetchAccountsBatch(connection, addresses),
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    if (!positions) throw new Error('No positions returned')

    const groups = new Set<string>()
    let v2HasJlpSupply = false
    let v2HasUsdcBorrow = false

    for (const position of positions) {
      expect(position.platformId).toBe('vaultka')
      expect(position.meta?.project0).toBeUndefined()
      const group = position.meta?.vaultka?.group
      expect(
        group === VAULTKA_LEGACY_GROUP || group === VAULTKA_V2_GROUP,
      ).toBe(true)

      if (typeof group === 'string') groups.add(group)

      if (group === VAULTKA_V2_GROUP && isLendingPosition(position)) {
        v2HasJlpSupply =
          v2HasJlpSupply ||
          (position.supplied?.some((asset) => asset.amount.token === JLP_MINT) ??
            false)
        v2HasUsdcBorrow =
          v2HasUsdcBorrow ||
          (position.borrowed?.some((asset) => asset.amount.token === USDC_MINT) ??
            false)
      }
    }

    expect(groups.has(VAULTKA_LEGACY_GROUP)).toBe(true)
    expect(groups.has(VAULTKA_V2_GROUP)).toBe(true)
    expect(v2HasJlpSupply).toBe(true)
    expect(v2HasUsdcBorrow).toBe(true)
  }, 60000)
})
