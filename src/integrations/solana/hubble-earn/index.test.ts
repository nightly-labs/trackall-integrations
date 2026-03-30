import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import { fetchAccountsBatch, fetchProgramAccountsBatch } from '../../../utils/solana'
import { hubbleEarnIntegration, testAddress } from './index'

const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const { getUserPositions } = hubbleEarnIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('hubble-earn integration', () => {
  it('fetches user positions via Kamino-compatible earn/lending extraction', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0

    const [positions] = await runIntegrations(
      [getUserPositions(testAddress, plugins)],
      async addresses => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(`  batch ${totalBatches}: fetching ${addresses.length} accounts`)
        return fetchAccountsBatch(connection, addresses)
      },
      req => fetchProgramAccountsBatch(connection, req)
    )

    if (!positions) throw new Error('No results returned')

    console.log(`\nFound ${positions.length} Hubble Earn positions`)
    console.log(`RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`)
    if (positions.length > 0) {
      console.log('Sample position:', JSON.stringify(positions, null, 2))
    }

    expect(Array.isArray(positions)).toBe(true)
    expect(positions.length).toBeGreaterThan(0)

    for (const position of positions) {
      expect(position.platformId).toBe('hubble-earn')
      expect(['staking', 'lending', 'reward']).toContain(position.positionKind)
    }
  }, 120000)
})
