import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { type TokenData, TokenPlugin } from './tokens'

function testDbPath(name: string): string {
  return join(
    process.cwd(),
    '.cache',
    `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  )
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
  describe('price updates', () => {
    it('updates price fields and clears stale 24h change when missing', () => {
      const plugin = new TokenPlugin(':memory:')
      const token: TokenData = {
        mintAddress: 'TokenA',
        decimals: 9,
        priceUsd: 1,
        pctPriceChange24h: 5
      }
      plugin.set(token.mintAddress, token)

      const updated = plugin.updatePrices(
        new Map([
          ['TokenA', { priceUsd: 2.5 }],
          ['TokenB', { priceUsd: 3.5, pctPriceChange24h: 1.2 }]
        ])
      )

      expect(updated).toEqual(['TokenA'])
      expect(plugin.get('TokenA')?.priceUsd).toBe(2.5)
      expect(plugin.get('TokenA')?.pctPriceChange24h).toBeUndefined()

      closeTokenPluginDb(plugin)
    })
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
        symbol: 'SOL'
      }

      const validInsert = db.prepare('INSERT INTO tokens (token_address, token_data) VALUES (?, ?)')
      validInsert.run(validToken.mintAddress, JSON.stringify(validToken))
      db.prepare('INSERT INTO tokens (token_address, token_data) VALUES (?, ?)').run(
        'BadAddress',
        '{ this is: not json }'
      )
      db.close()

      const plugin = new TokenPlugin(dbPath)
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
        symbol: 'BTOK'
      }
      db.prepare('INSERT INTO tokens (token_address, token_data) VALUES (?, ?)').run(
        initialToken.mintAddress,
        JSON.stringify(initialToken)
      )
      db.close()

      const plugin = new TokenPlugin(dbPath)
      await plugin.load()

      const pluginAny = plugin as unknown as { map: Map<string, TokenData> }
      const tokenA: TokenData = {
        mintAddress: 'TokenA',
        decimals: 4,
        name: 'New Token A',
        symbol: 'ATOK'
      }
      const updatedTokenB: TokenData = {
        mintAddress: 'TokenB',
        decimals: 8,
        name: 'Should Not Persist',
        symbol: 'BUPD'
      }

      pluginAny.map.set(tokenA.mintAddress, tokenA)
      pluginAny.map.set(updatedTokenB.mintAddress, updatedTokenB)
      await plugin.save([tokenA.mintAddress])

      const rows = queryRows(dbPath)
      expect(rows).toHaveLength(2)

      const tokenARow = rows.find(r => r.token_address === tokenA.mintAddress)
      const tokenBRow = rows.find(r => r.token_address === initialToken.mintAddress)

      expect(tokenARow).toBeDefined()
      expect(tokenBRow).toBeDefined()
      if (!tokenARow || !tokenBRow) throw new Error('rows not found')

      const loadedTokenA = JSON.parse(tokenARow.token_data) as TokenData
      const loadedTokenB = JSON.parse(tokenBRow.token_data) as TokenData

      expect(loadedTokenA).toEqual(tokenA)
      expect(loadedTokenB).toEqual(initialToken)

      closeAndDeleteDb(plugin, dbPath)
    })

    it('persists full map when save is called without specific addresses', async () => {
      const dbPath = testDbPath('tokens-save-full')
      const plugin = new TokenPlugin(dbPath)
      const pluginAny = plugin as unknown as { map: Map<string, TokenData> }

      const token: TokenData = {
        mintAddress: 'TokenC',
        decimals: 3,
        name: 'Full Save Token',
        symbol: 'C'
      }
      pluginAny.map.set(token.mintAddress, token)

      await plugin.save()
      const rows = queryRows(dbPath)

      expect(rows).toHaveLength(1)
      const row = rows[0]
      if (!row) throw new Error('row not found')
      expect(JSON.parse(row.token_data)).toEqual(token)

      closeAndDeleteDb(plugin, dbPath)
    })
  })
})
