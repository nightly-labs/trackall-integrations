import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { raydiumIntegration } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const wallet = '93PSyNrS7zBhrXaHHfU1ZtfegcKq5SaCYc35ZwPVrK3K'

const { getUserPositions } = raydiumIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('raydium integration', () => {
  it('fetches user positions from Raydium CLMM + CP', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0
    let getProgramAccountsCalls = 0
    let getTokenAccountsByOwnerCalls = 0

    const [positions] = await runIntegrations(
      [getUserPositions(wallet, plugins)],
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(
          `  batch ${totalBatches}: fetching ${addresses.length} accounts`,
        )
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => {
        if (req.kind === 'getProgramAccounts') {
          getProgramAccountsCalls++
        } else if (req.kind === 'getTokenAccountsByOwner') {
          getTokenAccountsByOwnerCalls++
        }
        return fetchProgramAccountsBatch(connection, req)
      },
    )

    if (!positions) throw new Error('No results returned')

    const liquidityPositions = positions.filter(
      (p) => p.positionKind === 'liquidity',
    )

    console.log(`\nFound ${positions.length} Raydium positions`)
    console.log(
      `RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`,
    )
    console.log(
      `Program requests: getProgramAccounts=${getProgramAccountsCalls}, getTokenAccountsByOwner=${getTokenAccountsByOwnerCalls}`,
    )
    console.log('Sample position:', JSON.stringify(liquidityPositions, null, 2))

    expect(Array.isArray(positions)).toBe(true)
    expect(getProgramAccountsCalls).toBe(0)
    expect(getTokenAccountsByOwnerCalls).toBe(2)
  }, 180000)
})
