---
name: new-solana-integration
description: Scaffold and implement a new Solana DeFi integration — creates files, registers the platform, writes tests, and walks through CI and PR
---

You are helping the user add a new Solana DeFi integration to the `packages/integrations` workspace. Follow the steps below in order. Ask for the protocol name (e.g. `orca`, `raydium`) before starting if it hasn't been provided.

---

## Step 1 — Gather information

Ask the user for:
1. **Protocol name** — lowercase, no spaces (becomes `<protocol>` throughout, e.g. `orca`)
2. **testAddress** — a Solana wallet address known to hold live positions for this protocol
3. **Platform metadata** — `name`, `image` URL, `description`, optional `defiLlamaId`, optional `tags`

If any are missing, ask before proceeding.

---

## Step 2 — Create platform metadata

Create `src/platforms/<protocol>.ts` modelled on `src/platforms/meteora.ts`:

```typescript
import type { Platform } from '../types/platform'

const <protocol>Platform = {
  id: '<protocol>' as const,
  networks: ['solana'],
  name: '<Name>',
  image: '<image-url>',
  description: '<Short description>',
  tags: [],
  defiLlamaId: '<defiLlamaId>',
} satisfies Platform

export default <protocol>Platform
```

Rules:
- `id` must be a unique string literal — it becomes the `PlatformId` union member
- `networks` must include `'solana'`
- `defiLlamaId` may be omitted if unknown

---

## Step 3 — Register in `src/platforms/index.ts`

Read the current file first, then add the import and append to the `platforms` array:

```typescript
import type { Platform } from '../types/platform'
import meteoraPlatform from './meteora'
import <protocol>Platform from './<protocol>'   // ← add this

export const platforms = [meteoraPlatform, <protocol>Platform] as const satisfies readonly Platform[]

export type PlatformId = typeof platforms[number]['id']
```

This automatically adds `'<protocol>'` to the `PlatformId` union used everywhere in TypeScript.

---

## Step 4 — Create `src/solana/<protocol>/index.ts`

Use `src/solana/meteora/index.ts` as the canonical reference. The required shape is:

```typescript
import type {
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../types/index'

export const testAddress = '<wallet-with-known-positions>'

export const <protocol>Integration: SolanaIntegration = {
  platformId: '<protocol>',   // must exactly match the registered platform id

  getUserPositions: async function* (address: string, { endpoint, tokens }: SolanaPlugins): UserPositionsPlan {
    // Phase 0: discover positions via getProgramAccounts
    const phase0Map = yield {
      kind: 'getProgramAccounts' as const,
      programId: '<PROGRAM_ID>',
      filters: [/* owner filter, discriminator filter, … */],
    }

    // Phase 1: batch-fetch required accounts (lb pairs, mints, etc.)
    const round1 = yield ['<account-address-1>', '<account-address-2>']

    // … additional yield phases as needed …

    const result: UserDefiPosition[] = []
    // build and push positions …
    return result
  },

  // Optional stats methods:
  getTvl: async ({ endpoint, tokens }) => '0',
  getVolume: async ({ endpoint, tokens }) => '0',
  getDailyActiveUsers: async ({ endpoint, tokens }) => '0',
}

export default <protocol>Integration
```

Key rules:
- `export default` is **mandatory** — the root auto-discovers integrations via `import.meta.glob('./src/solana/*/index.ts')`
- `export const testAddress` is **mandatory** — the generic CI harness reads it from `mod.testAddress`
- `platformId` must match the `id` registered in Step 2/3 exactly
- Yield `GetProgramAccountsRequest` objects (with `kind: 'getProgramAccounts'`) to discover accounts owned by a program
- Yield `SolanaAddress[]` to batch-fetch arbitrary accounts
- The runner returns an `AccountsMap` (`Record<SolanaAddress, MaybeSolanaAccount>`) for each yield
- Position types available: `ConcentratedRangeLiquidityDefiPosition`, `ConstantProductLiquidityDefiPosition`, `LendingDefiPosition`, `StakingDefiPosition`, `VestingDefiPosition`, `RewardDefiPosition` — all in `src/types/`
- Use nested `rewards` only when rewards belong to a primary position; use top-level `RewardDefiPosition` for standalone claimables like airdrops

---

## Step 5 — Create `src/solana/<protocol>/index.test.ts`

Model after `src/solana/meteora/index.test.ts`. Include two `it` blocks:

```typescript
import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { createSolanaRpc } from '@solana/kit'
import { <protocol>Integration, testAddress } from './index'
import { runIntegrations, TokenPlugin } from '../../types/index'
import { fetchAccountsBatch, fetchProgramAccountsBatch } from '../../utils/solana'
import type { UserPositionsPlan } from '../../types/index'

const solanaRpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

const wallets = [
  testAddress,
  // add 4 more wallets with known positions for multi-wallet test
]

describe('<protocol> integration', () => {
  it('fetches user positions', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin(createSolanaRpc(solanaRpcUrl))
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0

    const [positions] = await runIntegrations(
      [<protocol>Integration.getUserPositions!(testAddress, plugins)],
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(`  batch ${totalBatches}: fetching ${addresses.length} accounts`)
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    if (!positions) throw new Error('No results returned')

    console.log(`\nFound ${positions.length} positions`)
    console.log(`RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`)
    if (positions.length > 0) {
      console.log('Sample position:', JSON.stringify(positions[0], null, 2))
    }

    expect(Array.isArray(positions)).toBe(true)
  }, 60000)

  it('fetches positions for multiple wallets in batched RPC calls', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin(createSolanaRpc(solanaRpcUrl))
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
      wallets.map((w) => trackYields(<protocol>Integration.getUserPositions!(w, plugins))),
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(`  batch ${totalBatches}: fetching ${addresses.length} accounts`)
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    const totalPositions = results.reduce((sum, p) => sum + p.length, 0)
    const saved = naiveTotal - totalAccounts
    const savedPct = naiveTotal > 0 ? Math.round((saved / naiveTotal) * 100) : 0
    console.log(`\n${wallets.length} wallets → ${totalPositions} total positions`)
    console.log(`RPC batches: ${totalBatches}, actual accounts fetched: ${totalAccounts}`)
    console.log(`Sequential would have fetched: ${naiveTotal} — saved ${saved} (${savedPct}%)`)

    expect(results).toHaveLength(wallets.length)
    for (const positions of results) {
      expect(Array.isArray(positions)).toBe(true)
    }
  }, 60000)
})
```

---

## Step 6 — Local verification

Run these commands to verify before opening a PR:

```bash
# Run the integration's own rich test (requires an RPC URL)
SOLANA_RPC_URL=<url> bun test src/solana/<protocol>/index.test.ts

# Run via the generic CI harness
SOLANA_RPC_URL=<url> INTEGRATION_NAME=<protocol> bun test src/test/run-integration.test.ts

# Type-check everything
bun run typecheck
```

All three must succeed before opening a PR. If you don't have a private RPC URL, ask the maintainers — `SOLANA_RPC_URL` is also set as a repository secret for CI.

---

## Step 7 — What CI does automatically (no changes needed)

Once a PR is opened that touches `src/solana/<protocol>/`:

1. **`detect` job** — diffs changed `*.ts` files and extracts the integration name from the `src/solana/<name>/` path
2. **`test-local`** — runs `bun test src/solana/<name>/index.test.ts`
3. **`test-generic`** — runs `INTEGRATION_NAME=<name> bun test src/test/run-integration.test.ts`
4. Jobs 2 and 3 run concurrently after `detect` completes
5. Each job posts/updates a collapsible comment on the PR using separate markers — they don't overwrite each other
6. `SOLANA_RPC_URL` must exist as a repo secret — confirm with maintainers if CI fails with an auth error

Do **not** modify `.github/workflows/ci.yml`.

---

## Step 8 — PR checklist

Before submitting, verify:

- [ ] `src/platforms/<protocol>.ts` created with correct `id`, `name`, `networks: ['solana']`
- [ ] `<protocol>Platform` imported and added to `platforms` array in `src/platforms/index.ts`
- [ ] `export const testAddress` in `index.ts` points to a wallet with real, live positions
- [ ] `export default <protocol>Integration` present in `index.ts`
- [ ] `platformId` in integration object matches the registered platform `id` exactly
- [ ] `bun run typecheck` passes with no errors
- [ ] `bun test src/solana/<protocol>/index.test.ts` passes locally (with RPC URL)
- [ ] PR opened against `main`
