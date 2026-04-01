import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import type {
  RewardDefiPosition,
  StakingDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { jupiterDaoIntegration, testAddress } from './index'

const solanaRpcUrl = process.env.SOLANA_RPC_URL
if (!solanaRpcUrl) {
  throw new Error(
    'SOLANA_RPC_URL is required. Set it in your environment or .env.',
  )
}

const wallets = [
  testAddress,
  'AveF9QMdkx3aj8abTfBVZhugrNQQqEJnZsWWenAjTUUY',
  '71kG5LnbjVFp3Grj7VZ8WCqTNU6XRihoPuHRTMvmZGKb',
]

const cooldownWallet = 'AveF9QMdkx3aj8abTfBVZhugrNQQqEJnZsWWenAjTUUY'

const { getUserPositions } = jupiterDaoIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('jupiter-dao integration', () => {
  it('fetches staking and ASR reward positions for the primary wallet', async () => {
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

    const stakingPositions = positions.filter(
      (position): position is StakingDefiPosition =>
        position.positionKind === 'staking',
    )
    const rewardPositions = positions.filter(
      (position): position is RewardDefiPosition =>
        position.positionKind === 'reward',
    )

    console.log(`\nFound ${positions.length} Jupiter DAO positions`)
    console.log(
      `RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`,
    )
    console.log('Positions:', JSON.stringify(positions, null, 2))

    expect(stakingPositions.length).toBeGreaterThan(0)
    expect(rewardPositions.length).toBeGreaterThan(0)
    expect(
      rewardPositions.some((position) => position.sourceId === 'asr-q4'),
    ).toBe(true)
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
      wallets.map((wallet) => trackYields(getUserPositions(wallet, plugins))),
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

    const totalPositions = results.reduce(
      (sum, positions) => sum + positions.length,
      0,
    )
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
    wallets.forEach((wallet, index) => {
      console.log(
        `  ${wallet.slice(0, 8)}…  ${results[index]?.length ?? 0} positions`,
      )
    })

    expect(results).toHaveLength(wallets.length)
    expect(
      results.some((positions) =>
        positions.some(
          (position) =>
            position.positionKind === 'reward' &&
            position.platformId === 'jupiter-dao',
        ),
      ),
    ).toBe(true)

    const cooldownWalletPositions =
      results[wallets.findIndex((wallet) => wallet === cooldownWallet)] ?? []
    const cooldownStakingPositions = cooldownWalletPositions.filter(
      (position): position is StakingDefiPosition =>
        position.positionKind === 'staking',
    )
    expect(
      cooldownStakingPositions.some(
        (position) =>
          (position.unbonding?.length ?? 0) > 0 &&
          position.lockDuration === '604800',
      ),
    ).toBe(true)
  }, 60000)
})
