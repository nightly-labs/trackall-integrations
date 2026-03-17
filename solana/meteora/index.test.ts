import { describe, expect, it } from 'bun:test'
import { Connection, PublicKey } from '@solana/web3.js'

import { meteoraIntegration } from './index'
import { createSolanaRpc, runIntegrations, TokenPlugin } from '@trackall/shared'
import type { AccountsMap, MaybeSolanaAccount, SolanaAddress, UserPositionsPlan } from '@trackall/shared'

const solanaRpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const wallet = 'D2TKNY5CwCHCTu5YPbpouC9D4DGuoSvFsaYnMyEg7djn'
const wallets = [
  'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd',
  'D2TKNY5CwCHCTu5YPbpouC9D4DGuoSvFsaYnMyEg7djn',
  'MWKpvtFpvXWnSbe8Pe5CajXnKFQucD6VDYyBvt7fYEi',
  'DixNFxHwEYi2cQJviL6XdZf6534WKyxMugXD5KMKtTbf',
  '7D5ZwmDH9HPJ3konuh5HRtVnWE1f7sKDz1pqyJ9LDcUP',
]

async function fetchAccountsBatch(
  connection: Connection,
  addresses: SolanaAddress[],
): Promise<AccountsMap> {
  if (addresses.length === 0) return {}
  const pubkeys = addresses.map((a) => new PublicKey(a))
  const infos = await connection.getMultipleAccountsInfo(pubkeys)
  const map: AccountsMap = {}
  addresses.forEach((addr, i) => {
    const info = infos[i]
    const entry: MaybeSolanaAccount = info
      ? {
          exists: true,
          address: addr,
          lamports: BigInt(info.lamports),
          programAddress: info.owner.toBase58(),
          data: new Uint8Array(info.data as Buffer),
        }
      : { exists: false, address: addr }
    map[addr] = entry
  })
  return map
}

describe('meteora integration', () => {
  it('fetches user positions from Meteora DLMM', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin(createSolanaRpc(solanaRpcUrl))
    const plugins = { connection, tokens }

    let totalBatches = 0
    let totalAccounts = 0

    const [positions] = await runIntegrations(
      [meteoraIntegration.getUserPositions!(wallet, plugins)],
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(`  batch ${totalBatches}: fetching ${addresses.length} accounts`)
        return fetchAccountsBatch(connection, addresses)
      },
    )

    if (!positions) throw new Error('No results returned')

    const liquidityPositions = positions.filter((p) => p.positionKind === 'liquidity')

    // Warm the token cache for all mints, then the integration uses get() internally
    const mints = [...new Set(liquidityPositions.flatMap((p) => p.poolTokens.map((t) => t.amount.token)))]
    await Promise.all(mints.map((mint) => tokens.fetch(mint)))

    console.log(`\nFound ${positions.length} Meteora DLMM positions`)
    console.log(`RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`)
    if (liquidityPositions.length > 0) {
      console.log('Sample position:', JSON.stringify(liquidityPositions[1] ?? liquidityPositions[0], null, 2))
    }

    expect(Array.isArray(positions)).toBe(true)
  }, 60000)

  it('fetches positions for multiple wallets in batched RPC calls', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin(createSolanaRpc(solanaRpcUrl))
    const plugins = { connection, tokens }

    let totalBatches = 0
    let totalAccounts = 0
    let naiveTotal = 0 // sum of each generator's yields — what sequential runs would fetch

    // Wraps a plan to count what it yields per round without affecting behaviour
    function trackYields(plan: UserPositionsPlan): UserPositionsPlan {
      return (async function* (): UserPositionsPlan {
        let step = await plan.next()
        while (!step.done) {
          naiveTotal += step.value.length
          const accounts = yield step.value
          step = await plan.next(accounts)
        }
        return step.value
      })()
    }

    const results = await runIntegrations(
      wallets.map((w) => trackYields(meteoraIntegration.getUserPositions!(w, plugins))),
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(`  batch ${totalBatches}: fetching ${addresses.length} accounts`)
        return fetchAccountsBatch(connection, addresses)
      },
    )

    const totalPositions = results.reduce((sum, p) => sum + p.length, 0)
    const saved = naiveTotal - totalAccounts
    const savedPct = naiveTotal > 0 ? Math.round((saved / naiveTotal) * 100) : 0
    console.log(`\n${wallets.length} wallets → ${totalPositions} total positions`)
    console.log(`RPC batches: ${totalBatches}, actual accounts fetched: ${totalAccounts}`)
    console.log(`Sequential would have fetched: ${naiveTotal} — saved ${saved} (${savedPct}%)`)
    wallets.forEach((w, i) => {
      console.log(`  ${w.slice(0, 8)}…  ${results[i]?.length ?? 0} positions`)
    })

    expect(results).toHaveLength(wallets.length)
    for (const positions of results) {
      expect(Array.isArray(positions)).toBe(true)
    }
  }, 60000)
})
