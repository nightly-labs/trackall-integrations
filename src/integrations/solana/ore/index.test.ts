import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import type { UserPositionsPlan } from '../../../types/index'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { oreIntegration, testAddress } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const wallets = [
  testAddress,
  'D2TKNY5CwCHCTu5YPbpouC9D4DGuoSvFsaYnMyEg7djn',
  'MWKpvtFpvXWnSbe8Pe5CajXnKFQucD6VDYyBvt7fYEi',
  'DixNFxHwEYi2cQJviL6XdZf6534WKyxMugXD5KMKtTbf',
  '7D5ZwmDH9HPJ3konuh5HRtVnWE1f7sKDz1pqyJ9LDcUP',
]

const { getUserPositions } = oreIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('ore integration', () => {
  it('fetches user positions', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0

    const [positions] = await runIntegrations(
      [getUserPositions(testAddress, plugins)],
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

    console.log(`\nFound ${positions.length} positions`)
    console.log(
      `RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`,
    )
    if (positions.length > 0) {
      console.log('Sample position:', JSON.stringify(positions[0], null, 2))
    }

    expect(Array.isArray(positions)).toBe(true)
  }, 60000)

  it('fetches positions for multiple wallets in batched RPC calls', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0
    let naiveTotal = 0

    function trackYields(plan: UserPositionsPlan): UserPositionsPlan {
      return (async function* (): UserPositionsPlan {
        let step = await plan.next()
        while (!step.done) {
          if (Array.isArray(step.value)) naiveTotal += step.value.length
          const accounts = yield step.value
          step = await plan.next(accounts)
        }
        return step.value
      })()
    }

    const results = await runIntegrations(
      wallets.map((w) => trackYields(getUserPositions(w, plugins))),
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

    const totalPositions = results.reduce((sum, p) => sum + p.length, 0)
    const saved = naiveTotal - totalAccounts
    const savedPct = naiveTotal > 0 ? Math.round((saved / naiveTotal) * 100) : 0
    console.log(
      `\n${wallets.length} wallets → ${totalPositions} total positions`,
    )
    console.log(
      `RPC batches: ${totalBatches}, actual accounts fetched: ${totalAccounts}`,
    )
    console.log(
      `Sequential would have fetched: ${naiveTotal} — saved ${saved} (${savedPct}%)`,
    )
    wallets.forEach((w, i) => {
      console.log(`  ${w.slice(0, 8)}…  ${results[i]?.length ?? 0} positions`)
    })

    expect(results).toHaveLength(wallets.length)
    for (const positions of results) {
      expect(Array.isArray(positions)).toBe(true)
    }
  }, 60000)
})
