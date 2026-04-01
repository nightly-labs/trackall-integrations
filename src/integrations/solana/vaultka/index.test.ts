import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import { testIntegration } from '../../../test/solana-integration'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { testAddress, vaultkaIntegration } from './index'

testIntegration(vaultkaIntegration, testAddress)

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const VAULTKA_GROUP = '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8'

describe('vaultka integration shape', () => {
  it('returns only vaultka-attributed positions for the production group', async () => {
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

    for (const position of positions) {
      expect(position.platformId).toBe('vaultka')
      expect(position.meta?.project0).toBeUndefined()
      expect(position.meta?.vaultka?.group).toBe(VAULTKA_GROUP)
    }
  }, 60000)
})
