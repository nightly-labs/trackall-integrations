import { describe, expect, it } from 'bun:test'
import { address, createSolanaRpc } from '@solana/kit'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

import { TokenPlugin, type TokenData } from './tokens'

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const rpc = createSolanaRpc(RPC_URL)
const TARGET_TOKEN_COUNT = 100
const RAYDIUM_CACHE_FILE = new URL('./raydium-token-addresses.json', import.meta.url)
let cachedRaydiumAddresses: string[] | null = null

async function loadRaydiumTokenAddresses(): Promise<string[]> {
  if (cachedRaydiumAddresses != null) return cachedRaydiumAddresses

  const cached = (await Bun.file(RAYDIUM_CACHE_FILE).json()) as string[]
  cachedRaydiumAddresses = [
    ...new Set(
      cached
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .filter((tokenAddress): tokenAddress is string => {
          try {
            address(tokenAddress)
            return true
          } catch {
            return false
          }
        }),
    ),
  ]
  return cachedRaydiumAddresses
}

function testDbPath(name: string): string {
  return join(process.cwd(), '.cache', `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
}

function createTokensTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      token_address TEXT PRIMARY KEY,
      token_data TEXT NOT NULL
    )
  `)
}

function queryRows(dbPath: string): Array<{ token_address: string; token_data: string }> {
  const db = new Database(dbPath, { strict: true })
  try {
    return db.query('SELECT token_address, token_data FROM tokens').all() as Array<{
      token_address: string
      token_data: string
    }>
  } finally {
    db.close()
  }
}

function closeTokenPluginDb(plugin: TokenPlugin): void {
  ;(plugin as unknown as { db: Database }).db.close()
}

function closeAndDeleteDb(plugin: TokenPlugin, dbPath: string): void {
  closeTokenPluginDb(plugin)
  void Bun.file(dbPath).delete()
}

describe('TokenPlugin', () => {
  describe('fetchMany()', () => {
    it('accepts exactly 100 addresses and rejects 101', async () => {
      const tokenAddresses = await loadRaydiumTokenAddresses()
      if (tokenAddresses.length < TARGET_TOKEN_COUNT + 1) {
        throw new Error(`Expected at least ${TARGET_TOKEN_COUNT + 1} token addresses, got ${tokenAddresses.length}`)
      }

      const plugin = new TokenPlugin(rpc)
      const exactlyLimit = tokenAddresses.slice(0, TARGET_TOKEN_COUNT)
      await expect(plugin.fetchMany(exactlyLimit)).resolves.toBeInstanceOf(Map)

      const tooMany = tokenAddresses.slice(0, TARGET_TOKEN_COUNT + 1)
      const uncachedCheckPlugin = new TokenPlugin(rpc)
      await expect(uncachedCheckPlugin.fetchMany(tooMany)).rejects.toThrow(
        `fetchMany supports at most ${TARGET_TOKEN_COUNT} mints per call`,
      )
    }, 30_000)
  })

  describe('SQLite cache', () => {
    it('loads valid token rows and skips malformed rows', async () => {
      const dbPath = testDbPath('tokens-load')
      const db = new Database(dbPath)
      createTokensTable(db)

      const validToken: TokenData = {
        mintAddress: 'So11111111111111111111111111111111111111112',
        decimals: 9,
        name: 'Wrapped SOL',
        symbol: 'SOL',
      }

      const validInsert = db.prepare('INSERT INTO tokens (token_address, token_data) VALUES (?, ?)')
      validInsert.run(validToken.mintAddress, JSON.stringify(validToken))
      db.prepare('INSERT INTO tokens (token_address, token_data) VALUES (?, ?)').run(
        'BadAddress',
        '{ this is: not json }',
      )
      db.close()

      const plugin = new TokenPlugin(({} as unknown) as never, dbPath)
      await plugin.load()

      expect(plugin.get(validToken.mintAddress)).toEqual(validToken)
      expect(plugin.get('BadAddress')).toBeUndefined()

      closeAndDeleteDb(plugin, dbPath)
    })

    it('saves only explicitly requested token addresses', async () => {
      const dbPath = testDbPath('tokens-save-specified')
      const db = new Database(dbPath)
      createTokensTable(db)

      const initialToken: TokenData = {
        mintAddress: 'TokenB',
        decimals: 6,
        name: 'Old Token B',
        symbol: 'BTOK',
      }
      db.prepare('INSERT INTO tokens (token_address, token_data) VALUES (?, ?)').run(
        initialToken.mintAddress,
        JSON.stringify(initialToken),
      )
      db.close()

      const plugin = new TokenPlugin(({} as unknown) as never, dbPath)
      await plugin.load()

      const pluginAny = plugin as unknown as { map: Map<string, TokenData> }
      const tokenA: TokenData = {
        mintAddress: 'TokenA',
        decimals: 4,
        name: 'New Token A',
        symbol: 'ATOK',
      }
      const updatedTokenB: TokenData = {
        mintAddress: 'TokenB',
        decimals: 8,
        name: 'Should Not Persist',
        symbol: 'BUPD',
      }

      pluginAny.map.set(tokenA.mintAddress, tokenA)
      pluginAny.map.set(updatedTokenB.mintAddress, updatedTokenB)
      await plugin.save([tokenA.mintAddress])

      const rows = queryRows(dbPath)
      expect(rows).toHaveLength(2)

      const tokenARow = rows.find((r) => r.token_address === tokenA.mintAddress)
      const tokenBRow = rows.find((r) => r.token_address === initialToken.mintAddress)

      expect(tokenARow).toBeDefined()
      expect(tokenBRow).toBeDefined()

      const loadedTokenA = JSON.parse(tokenARow!.token_data) as TokenData
      const loadedTokenB = JSON.parse(tokenBRow!.token_data) as TokenData

      expect(loadedTokenA).toEqual(tokenA)
      expect(loadedTokenB).toEqual(initialToken)

      closeAndDeleteDb(plugin, dbPath)
    })

    it('persists full map when save is called without specific addresses', async () => {
      const dbPath = testDbPath('tokens-save-full')
      const plugin = new TokenPlugin(({} as unknown) as never, dbPath)
      const pluginAny = plugin as unknown as { map: Map<string, TokenData> }

      const token: TokenData = {
        mintAddress: 'TokenC',
        decimals: 3,
        name: 'Full Save Token',
        symbol: 'C',
      }
      pluginAny.map.set(token.mintAddress, token)

      await plugin.save()
      const rows = queryRows(dbPath)

      expect(rows).toHaveLength(1)
      expect(JSON.parse(rows[0]!.token_data)).toEqual(token)

      closeAndDeleteDb(plugin, dbPath)
    })
  })
})
