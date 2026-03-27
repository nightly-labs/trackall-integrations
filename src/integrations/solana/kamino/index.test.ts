import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import type { UserPositionsPlan } from '../../../types/index'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { kaminoIntegration, testAddress } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const wallets = [testAddress, 'Hs9ioQZ2pCUyvS18anwmBxjQJsZrMPShwTMLySD6Us3V']

const { getUserPositions } = kaminoIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

describe('kamino integration', () => {
  it('fetches KLend and KVault positions', async () => {
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

    const lendingPositions = positions.filter(
      (p) => p.positionKind === 'lending',
    )
    const stakingPositions = positions.filter(
      (p) => p.positionKind === 'staking',
    )

    console.log(`\nFound ${positions.length} Kamino positions`)
    console.log(`  lending: ${lendingPositions.length}`)
    console.log(`  staking: ${stakingPositions.length}`)
    console.log(
      `RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`,
    )
    console.log('Sample position:', JSON.stringify(positions, null, 2))

    expect(Array.isArray(positions)).toBe(true)

    for (const position of lendingPositions) {
      let hasComponentUsd = false
      if (position.supplied !== undefined) {
        for (const supplied of position.supplied) {
          if (supplied.priceUsd !== undefined) {
            expect(supplied.usdValue).toBeDefined()
          }
          if (supplied.usdValue !== undefined) hasComponentUsd = true
        }
      }
      if (position.borrowed !== undefined) {
        for (const borrowed of position.borrowed) {
          if (borrowed.priceUsd !== undefined) {
            expect(borrowed.usdValue).toBeDefined()
          }
          if (borrowed.usdValue !== undefined) hasComponentUsd = true
        }
      }
      if (hasComponentUsd) {
        expect(position.usdValue).toBeDefined()
      }
    }

    for (const position of stakingPositions) {
      let hasComponentUsd = false
      if (position.staked !== undefined) {
        expect(Array.isArray(position.staked)).toBe(true)
        for (const staked of position.staked) {
          expect(typeof staked.amount.token).toBe('string')
          expect(typeof staked.amount.amount).toBe('string')
          expect(typeof staked.amount.decimals).toBe('string')
          if (staked.priceUsd !== undefined) {
            expect(staked.usdValue).toBeDefined()
          }
          if (staked.usdValue !== undefined) hasComponentUsd = true
        }
      }
      if (position.unbonding !== undefined) {
        expect(Array.isArray(position.unbonding)).toBe(true)
        for (const unbonding of position.unbonding) {
          expect(typeof unbonding.amount.token).toBe('string')
          expect(typeof unbonding.amount.amount).toBe('string')
          expect(typeof unbonding.amount.decimals).toBe('string')
          if (unbonding.priceUsd !== undefined) {
            expect(unbonding.usdValue).toBeDefined()
          }
          if (unbonding.usdValue !== undefined) hasComponentUsd = true
        }
      }
      if (position.rewards !== undefined) {
        expect(Array.isArray(position.rewards)).toBe(true)
        for (const reward of position.rewards) {
          expect(typeof reward.amount.token).toBe('string')
          expect(typeof reward.amount.amount).toBe('string')
          expect(typeof reward.amount.decimals).toBe('string')
          if (reward.priceUsd !== undefined) {
            expect(reward.usdValue).toBeDefined()
          }
          if (reward.usdValue !== undefined) hasComponentUsd = true
        }
      }
      if (hasComponentUsd) {
        expect(position.usdValue).toBeDefined()
      }
    }
  }, 90000)

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

    expect(results).toHaveLength(wallets.length)
    for (const positions of results) {
      expect(Array.isArray(positions)).toBe(true)
    }
  }, 120000)
})
