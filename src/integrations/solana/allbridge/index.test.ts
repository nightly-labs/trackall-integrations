import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import type { UserPositionsPlan } from '../../../types/index'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { allbridgeIntegration, testAddress } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const wallets = [
  testAddress,
  'Gq7SwXPRRCXsHiHSjGqoo3dWoDhU2hVS1eFss3sDg6QN',
  'BpxRA2KqqyxkaNptLWxFNaheqKne3xK6eYn8KMEhL3yU',
  'HdaRAeQZ2F7L7oS5UEWRSF9Fham5hNEQYfKMYxXdmxZV',
  'AwYM7AoTsd9r1NquB9hrv2ztyk8wFYRNpun3vJdMYPfH',
]

const { getUserPositions } = allbridgeIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('allbridge integration', () => {
  it('fetches user positions using getProgramAccounts only', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalAccountBatches = 0
    let totalAccountsFetched = 0
    let getProgramAccountsCalls = 0
    const otherProgramKinds = new Set<string>()

    const [positions] = await runIntegrations(
      [getUserPositions(testAddress, plugins)],
      async (addresses) => {
        totalAccountBatches++
        totalAccountsFetched += addresses.length
        console.log(
          `  account batch ${totalAccountBatches}: fetching ${addresses.length} accounts`,
        )
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => {
        if (req.kind === 'getProgramAccounts') {
          getProgramAccountsCalls++
        } else {
          otherProgramKinds.add(req.kind)
        }

        console.log(
          `  program request ${getProgramAccountsCalls}: kind=${req.kind} programId=${req.kind === 'getProgramAccounts' ? req.programId : 'n/a'}`,
        )
        return fetchProgramAccountsBatch(connection, req)
      },
    )

    if (!positions) throw new Error('No results returned')

    console.log(`\nFound ${positions.length} Allbridge positions`)
    console.log(
      `Address batches: ${totalAccountBatches}, accounts fetched: ${totalAccountsFetched}`,
    )
    console.log(`getProgramAccounts calls: ${getProgramAccountsCalls}`)

    if (positions.length > 0) {
      console.log('Sample position:', JSON.stringify(positions[0], null, 2))
    }

    expect(Array.isArray(positions)).toBe(true)
    expect(getProgramAccountsCalls).toBeGreaterThan(0)
    expect(totalAccountBatches).toBe(0)
    expect(otherProgramKinds.size).toBe(0)
  }, 60000)

  it('fetches positions for multiple wallets via getProgramAccounts', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalAccountBatches = 0
    let totalAccountsFetched = 0
    let naiveProgramRequests = 0
    let actualProgramRequests = 0
    const otherProgramKinds = new Set<string>()

    function trackYields(plan: UserPositionsPlan): UserPositionsPlan {
      return (async function* (): UserPositionsPlan {
        let step = await plan.next()
        while (!step.done) {
          if (Array.isArray(step.value)) {
            if (step.value.length > 0 && typeof step.value[0] !== 'string') {
              naiveProgramRequests += step.value.length
            }
          } else {
            naiveProgramRequests++
          }

          const accounts = yield step.value
          step = await plan.next(accounts)
        }
        return step.value
      })()
    }

    const results = await runIntegrations(
      wallets.map((wallet) => trackYields(getUserPositions(wallet, plugins))),
      async (addresses) => {
        totalAccountBatches++
        totalAccountsFetched += addresses.length
        console.log(
          `  account batch ${totalAccountBatches}: fetching ${addresses.length} accounts`,
        )
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => {
        if (req.kind === 'getProgramAccounts') {
          actualProgramRequests++
        } else {
          otherProgramKinds.add(req.kind)
        }
        return fetchProgramAccountsBatch(connection, req)
      },
    )

    const totalPositions = results.reduce((sum, positions) => sum + positions.length, 0)
    console.log(`\n${wallets.length} wallets -> ${totalPositions} total positions`)
    console.log(
      `Program requests: naive=${naiveProgramRequests}, actual=${actualProgramRequests}`,
    )
    console.log(
      `Address batches: ${totalAccountBatches}, accounts fetched: ${totalAccountsFetched}`,
    )

    expect(results).toHaveLength(wallets.length)
    for (const positions of results) {
      expect(Array.isArray(positions)).toBe(true)
    }
    expect(otherProgramKinds.size).toBe(0)
    expect(totalAccountBatches).toBe(0)
    expect(actualProgramRequests).toBeGreaterThan(0)
  }, 60000)
})
