import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import type { ProgramRequest, UserPositionsPlan } from '../../../types/index'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { jupiterPredictionIntegration, testAddress } from './index'

const solanaRpcUrl = process.env.SOLANA_RPC_URL
if (!solanaRpcUrl) {
  throw new Error('SOLANA_RPC_URL is required. Set it in your environment or .env.')
}

const wallets = [testAddress, '8nXKQRr9H2L2QfM9aEgQspRFehWyvghMSscL5Pjv9xYQ']

const { getUserPositions } = jupiterPredictionIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

function trackYields(
  plan: UserPositionsPlan,
  onProgramRequest: (req: ProgramRequest) => void,
  onAddressBatch: (len: number) => void,
): UserPositionsPlan {
  return (async function* (): UserPositionsPlan {
    let step = await plan.next()
    while (!step.done) {
      const yielded = step.value
      if (Array.isArray(yielded)) {
        if (yielded.length > 0 && typeof yielded[0] === 'string') {
          onAddressBatch(yielded.length)
        } else {
          for (const req of yielded as ProgramRequest[]) onProgramRequest(req)
        }
      } else {
        onProgramRequest(yielded)
      }

      const accounts = yield yielded
      step = await plan.next(accounts)
    }
    return step.value
  })()
}

describe('jupiter-prediction integration', () => {
  it('fetches positions from on-chain data only', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0
    const programRequests: ProgramRequest[] = []

    const [positions] = await runIntegrations(
      [
        trackYields(
          getUserPositions(testAddress, plugins),
          (req) => programRequests.push(req),
          () => {},
        ),
      ],
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    if (!positions) throw new Error('No results returned')

    expect(
      programRequests.some((request) => request.kind === 'getHttpJson'),
    ).toBe(false)
    expect(positions.length).toBeGreaterThan(0)
    expect(
      positions.some((position) => position.platformId === 'jupiter-prediction'),
    ).toBe(true)
    expect(
      positions.some(
        (position) =>
          position.positionKind === 'reward' || position.positionKind === 'trading',
      ),
    ).toBe(true)
    expect(
      positions.some(
        (position) =>
          position.meta?.jupiterPrediction?.contracts === '0' &&
          position.meta?.jupiterPrediction?.payoutClaimed === true &&
          position.meta?.jupiterPrediction?.openOrders === 0,
      ),
    ).toBe(false)

    console.log(`positions: ${positions.length}`)
    console.log(`RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`)
  }, 60_000)

  it('batches across multiple wallets and remains on-chain only', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0
    let naiveTotal = 0
    const programRequests: ProgramRequest[] = []

    const results = await runIntegrations(
      wallets.map((wallet) =>
        trackYields(
          getUserPositions(wallet, plugins),
          (req) => programRequests.push(req),
          (len) => {
            naiveTotal += len
          },
        ),
      ),
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    const totalPositions = results.reduce((sum, list) => sum + list.length, 0)
    const saved = naiveTotal - totalAccounts
    const savedPct = naiveTotal > 0 ? Math.round((saved / naiveTotal) * 100) : 0

    expect(results).toHaveLength(wallets.length)
    expect(
      programRequests.some((request) => request.kind === 'getHttpJson'),
    ).toBe(false)
    expect(totalPositions).toBeGreaterThan(0)

    console.log(`${wallets.length} wallets -> ${totalPositions} total positions`)
    console.log(`RPC batches: ${totalBatches}, actual accounts fetched: ${totalAccounts}`)
    console.log(
      `Sequential would have fetched: ${naiveTotal} -> saved ${saved} (${savedPct}%)`,
    )
  }, 60_000)
})
