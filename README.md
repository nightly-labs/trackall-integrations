# @trackall/integrations

Solana DeFi position integrations (Meteora, Raydium, Jupiter Lend) using an async generator protocol that batches RPC calls efficiently across multiple wallets.

## Adding a New Integration

### Step 1: Create the integration directory

```
src/solana/<integration-name>/
  index.ts          # Integration implementation
  index.test.ts     # Tests
  idls/             # (optional) Anchor IDL files
```

### Step 2: Add platform metadata

Create `src/platforms/<integration-name>.ts` with the `Platform` shape:

```ts
import type { Platform } from '../types/platform'

export const myPlatform: Platform = {
  id: 'my-platform',
  name: 'My Platform',
  networks: ['solana'],
  image: 'https://...',
  description: 'Short description',
  defiLlamaId: 'my-platform',
}
```

Register it in `src/platforms/index.ts` → `platforms` array.

### Step 3: Implement `SolanaIntegration`

Export a `default` object implementing `SolanaIntegration` from `index.ts`:

```ts
import type { SolanaIntegration } from '../../types/solanaIntegration'

const integration: SolanaIntegration = {
  getUserPositions(address, plugins) {
    return (async function* () {
      // yield string[] → receive AccountsMap of fetched accounts
      const accounts = yield ['AccountPubkey1', 'AccountPubkey2']

      // yield ProgramRequest → receive AccountsMap from getProgramAccounts / getTokenAccountsByOwner
      const programAccounts = yield { programId: 'ProgramId', filters: [...] }

      // return UserDefiPosition[] when done
      return positions
    })()
  },
}

export default integration
```

**Generator protocol:**
- `yield string[]` — batch-fetch specific accounts; receives an `AccountsMap`
- `yield ProgramRequest` — fetch program accounts or token accounts; receives an `AccountsMap`
- `return UserDefiPosition[]` — signals completion with the final result

Use `plugins.tokens` (`TokenPlugin`) for token metadata and pricing. Do not make direct RPC calls — only yield requests; the runner handles batching across all concurrent integrations.

### Step 4: Write tests in `index.test.ts`

Use the `runIntegrations` + `fetchAccountsBatch` + `fetchProgramAccountsBatch` pattern:

```ts
import { describe, expect, it } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { createSolanaRpc } from '@solana/kit'
import { runIntegrations, TokenPlugin } from '../../types/index'
import { fetchAccountsBatch, fetchProgramAccountsBatch } from '../../utils/solana'
import myIntegration from './index'

const solanaRpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

// A real Solana wallet known to have positions in this protocol
export const testAddress = 'YourWalletAddressHere'

describe('my-platform integration', () => {
  it('fetches user positions', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin(createSolanaRpc(solanaRpcUrl))
    const plugins = { endpoint: solanaRpcUrl, tokens }

    const [positions] = await runIntegrations(
      [myIntegration.getUserPositions!(testAddress, plugins)],
      (addresses) => fetchAccountsBatch(connection, addresses),
      (req) => fetchProgramAccountsBatch(connection, req),
    )

    expect(Array.isArray(positions)).toBe(true)
  }, 60000)

  it('fetches positions for multiple wallets in batched RPC calls', async () => {
    // See src/solana/meteora/index.test.ts for the full multi-wallet batching pattern
  }, 60000)
})
```

Include a multi-wallet batching test (see `src/solana/meteora/index.test.ts` for the full pattern).

### Step 5: Register export (optional)

The main `index.ts` auto-discovers integrations via `readdir`, so no manual registration is needed for `solanaIntegrations`. If you want a named export, add it to the top-level `index.ts`.

## PR Workflow & CI

**How CI works:**

1. On every PR, CI runs `bun run typecheck` then `bun run lint`.
2. It detects which integration changed by scanning `git diff` for `src/solana/<name>/` paths — **only one integration per PR is detected** (first match wins).
3. Two parallel test jobs run:
   - `test-local`: runs `src/solana/<name>/index.test.ts`
   - `test-generic`: runs `src/test/run-integration.test.ts`
4. Results are posted as PR comments (updated on re-run).
5. Tests require the `SOLANA_RPC_URL` secret to be set in the repo.

**PR checklist:**
- [ ] One integration per PR (CI only detects the first changed integration)
- [ ] `index.test.ts` exists with a valid `testAddress`
- [ ] Typecheck passes: `bun run typecheck`
- [ ] Lint passes: `bun run lint`
- [ ] Tests pass locally: `SOLANA_RPC_URL=<url> bun test src/solana/<name>/index.test.ts`
- [ ] Platform metadata added to `src/platforms/`

## Linting & Formatting

This package uses [Biome](https://biomejs.dev) (configured in `biome.json`).

```sh
# Check lint + format
bun run lint

# Auto-format
bun run format
```

## Running Tests Locally

```sh
# Install deps
bun install

# Typecheck
bun run typecheck

# Run a specific integration's tests
SOLANA_RPC_URL=https://... bun test src/solana/meteora/index.test.ts

# Run the generic integration test
SOLANA_RPC_URL=https://... bun test src/test/run-integration.test.ts
```

## Key Types

| Type | File |
|---|---|
| `SolanaIntegration` | `src/types/solanaIntegration.ts` |
| `UserDefiPosition` | `src/types/position.ts` |
| `UserPositionsPlan` | `src/types/solanaIntegration.ts` (async generator alias) |
| `Platform` | `src/types/platform.ts` |
