import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { project0Integration, testAddress } from '.'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const allowedOrigins = new Set(['project0', 'drift', 'kamino', 'solend'])

describe('project0 integration', () => {
  it('fetches positions and tags origin protocol in metadata', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }
    const getUserPositions = project0Integration.getUserPositions
    if (!getUserPositions) {
      throw new Error('project0 getUserPositions is not implemented')
    }

    const [positions] = await runIntegrations(
      [getUserPositions(testAddress, plugins)],
      (addresses) => fetchAccountsBatch(connection, addresses),
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    expect(Array.isArray(positions)).toBe(true)
    expect((positions ?? []).length).toBeGreaterThan(0)

    const originProtocols = new Set<string>()

    for (const position of positions ?? []) {
      expect(position.platformId).toBe('project0')
      expect(position.positionKind).toBe('lending')

      const origin = position.meta?.project0?.originProtocol
      expect(typeof origin).toBe('string')
      expect(allowedOrigins.has(origin as string)).toBe(true)
      originProtocols.add(origin as string)
    }

    // The selected test wallet is expected to include routed balances.
    const hasRoutedProtocol = [...originProtocols].some(
      (origin) => origin !== 'project0',
    )
    expect(hasRoutedProtocol).toBe(true)
  }, 60_000)
})
