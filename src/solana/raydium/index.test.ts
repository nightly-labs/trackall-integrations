import { describe, expect, it } from 'bun:test'
import { createSolanaRpc } from '@solana/kit'
import { Connection } from '@solana/web3.js'
import { runIntegrations, TokenPlugin } from '../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../utils/solana'
import { raydiumIntegration } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const wallet = '93PSyNrS7zBhrXaHHfU1ZtfegcKq5SaCYc35ZwPVrK3K'

const { getUserPositions } = raydiumIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('raydium integration', () => {
  it('fetches user positions from Raydium CLMM + CP', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin(createSolanaRpc(solanaRpcUrl))
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0

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
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    if (!positions) throw new Error('No results returned')

    const liquidityPositions = positions.filter(
      (p) => p.positionKind === 'liquidity',
    )

    // Warm the token cache for all mints, then the integration uses get() internally
    const mints = [
      ...new Set(
        liquidityPositions.flatMap((p) =>
          p.poolTokens.map((t) => t.amount.token),
        ),
      ),
    ]
    await Promise.all(mints.map((mint) => tokens.fetch(mint)))

    console.log(`\nFound ${positions.length} Raydium positions`)
    console.log(
      `RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`,
    )
    console.log('Sample position:', JSON.stringify(liquidityPositions, null, 2))

    expect(Array.isArray(positions)).toBe(true)
  }, 120000)
})
