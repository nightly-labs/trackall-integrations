import { Database } from 'bun:sqlite'
import { address, createSolanaRpc } from '@solana/kit'
import { fetchMaybeMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata-kit'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { SolanaAddress } from '../types/solanaIntegration'

type SolanaRpc = ReturnType<typeof createSolanaRpc>

// SPL Token mint layout: mint_authority (36 bytes) + supply (8 bytes) + decimals (1 byte)
const MINT_DECIMALS_OFFSET = 44
const MAX_ACCOUNT_FETCH_SIZE = 100

export interface TokenCreator {
  address: SolanaAddress
  verified: boolean
  share: number
}

export interface TokenData {
  mintAddress: SolanaAddress
  decimals: number
  // On-chain Metaplex metadata
  name?: string
  symbol?: string
  uri?: string
  updateAuthority?: string
  isMutable?: boolean
  creators?: TokenCreator[]
  // Off-chain JSON metadata (fetched from uri)
  description?: string
  image?: string
  // Price data
  priceUsd?: number
}

export type TokensMap = Map<SolanaAddress, TokenData>

export class TokenPlugin {
  private map: TokensMap = new Map()
  private rpc: SolanaRpc
  private db: Database
  private upsertTokenStmt: ReturnType<Database['prepare']>

  constructor(rpc: SolanaRpc, cachePath = '.cache/tokens.sqlite') {
    this.rpc = rpc
    const directory = dirname(cachePath)
    if (directory !== '.') {
      mkdirSync(directory, { recursive: true })
    }

    this.db = new Database(cachePath)

    const tableInfo = this.db.query('PRAGMA table_info(tokens)').all() as Array<{ name: string }>
    const hasTokenAddress = tableInfo.some((column) => column.name === 'token_address')
    const hasTokenData = tableInfo.some((column) => column.name === 'token_data')
    const hasLegacyMintAddress = tableInfo.some((column) => column.name === 'mint_address')
    const hasLegacyData = tableInfo.some((column) => column.name === 'data')

    if (!hasTokenAddress && !hasTokenData && hasLegacyMintAddress && hasLegacyData) {
      this.db.run('ALTER TABLE tokens RENAME COLUMN mint_address TO token_address')
      this.db.run('ALTER TABLE tokens RENAME COLUMN data TO token_data')
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        token_address TEXT PRIMARY KEY,
        token_data TEXT NOT NULL
      )
    `)

    this.upsertTokenStmt = this.db.prepare(
      'INSERT INTO tokens (token_address, token_data) VALUES (?, ?) ON CONFLICT(token_address) DO UPDATE SET token_data = excluded.token_data',
    )
  }

  /** Load cache from sqlite. Call once at startup. */
  async load(): Promise<void> {
    this.map.clear()

    let rows: Array<{ token_address: string; token_data: string }> = []
    try {
      rows = this.db.query('SELECT token_address, token_data FROM tokens').all() as Array<{
        token_address: string
        token_data: string
      }>
    } catch {
      // Backward compatibility for older schema name if present
      try {
        const legacyRows = this.db.query('SELECT mint_address, data FROM tokens').all() as Array<{
          mint_address: string
          data: string
        }>
        rows = legacyRows.map((row) => ({ token_address: row.mint_address, token_data: row.data }))
      } catch {
        // Table missing or unreadable — start with empty cache
      }
    }

    for (const { token_address, token_data } of rows) {
      try {
        const tokenData = JSON.parse(token_data) as TokenData
        if (tokenData?.mintAddress) {
          this.map.set(token_address, tokenData)
        }
      } catch {
        // Invalid row payload — skip this token and continue
      }
    }
  }

  /** Persist selected token(s) from in-memory cache to sqlite. If no mint list is provided, persists current full map. */
  async save(tokenAddresses?: readonly SolanaAddress[]): Promise<void> {
    const entries:
      | IterableIterator<[SolanaAddress, TokenData]>
      | Array<[SolanaAddress, TokenData]> =
      tokenAddresses == null
        ? this.map.entries()
        : tokenAddresses.flatMap((mint) => {
            const tokenData = this.map.get(mint)
            return tokenData === undefined ? [] : [[mint, tokenData]]
          })

    this.db.run('BEGIN')
    try {
      for (const [tokenAddress, tokenData] of entries) {
        this.upsertTokenStmt.run(tokenAddress, JSON.stringify(tokenData))
      }
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  /** Get a token from the in-memory cache. */
  get(mint: SolanaAddress): TokenData | undefined {
    return this.map.get(mint)
  }

  /** Fetch full metadata for a mint, update in-memory and disk cache. Returns undefined if mint account does not exist. */
  async fetch(mint: SolanaAddress): Promise<TokenData | undefined> {
    const result = await this.fetchMany([mint])
    return result.get(mint)
  }

  async fetchMany(mints: readonly SolanaAddress[]): Promise<Map<SolanaAddress, TokenData | undefined>> {
    const uniqueMints = [...new Set(mints)]
    if (uniqueMints.length > MAX_ACCOUNT_FETCH_SIZE) {
      throw new Error(`fetchMany supports at most ${MAX_ACCOUNT_FETCH_SIZE} mints per call`)
    }

    const result = new Map<SolanaAddress, TokenData | undefined>()

    const uncachedMints: SolanaAddress[] = []
    for (const mint of uniqueMints) {
      const cached = this.map.get(mint)
      if (cached) {
        result.set(mint, cached)
      } else {
        uncachedMints.push(mint)
      }
    }

    if (uncachedMints.length === 0) return result

    const accountFetchTargets: Array<{ mint: SolanaAddress; address: ReturnType<typeof address> }> = []
    for (const mint of uncachedMints) {
      try {
        accountFetchTargets.push({ mint, address: address(mint) })
      } catch {
        result.set(mint, undefined)
      }
    }

    if (accountFetchTargets.length === 0) return result

    const allTokens: Array<{ mint: SolanaAddress; tokenData: TokenData }> = []
    try {
      const accountInfos = await this.rpc
        .getMultipleAccounts(
          accountFetchTargets.map((target) => target.address),
          { encoding: 'base64' },
        )
        .send()

      accountInfos.value.forEach((accountInfo, index) => {
        const target = accountFetchTargets[index]
        if (!target) return

        if (!accountInfo || !accountInfo.data || !Array.isArray(accountInfo.data)) {
          result.set(target.mint, undefined)
          return
        }

        const mintData = Buffer.from(accountInfo.data[0] as string, 'base64')
        if (mintData.length < MINT_DECIMALS_OFFSET + 1) {
          result.set(target.mint, undefined)
          return
        }

        const decimals = mintData[MINT_DECIMALS_OFFSET]
        if (decimals === undefined) {
          result.set(target.mint, undefined)
          return
        }

        const tokenData: TokenData = { mintAddress: target.mint, decimals }
        result.set(target.mint, tokenData)
        allTokens.push({ mint: target.mint, tokenData })
      })
    } catch {
      accountFetchTargets.forEach((target) => {
        result.set(target.mint, undefined)
      })
    }

    await Promise.all(
      allTokens.map(async ({ tokenData }) => {
        try {
          const metadataAccount = await fetchMaybeMetadataFromSeeds(this.rpc, { mint: address(tokenData.mintAddress) })
          if (!metadataAccount.exists) return

          const metadata = metadataAccount.data
          tokenData.name = metadata.name
          tokenData.symbol = metadata.symbol
          tokenData.uri = metadata.uri
          tokenData.updateAuthority = String(metadata.updateAuthority)
          tokenData.isMutable = metadata.isMutable

          if (metadata.creators.__option === 'Some') {
            tokenData.creators = metadata.creators.value.map((creator) => ({
              address: creator.address as SolanaAddress,
              verified: creator.verified,
              share: creator.share,
            }))
          }

          if (metadata.uri) {
            try {
              const offChain = (await fetch(metadata.uri).then((r) => r.json())) as {
                description?: string
                image?: string
              }
              if (offChain.description) tokenData.description = offChain.description
              if (offChain.image) tokenData.image = offChain.image
            } catch {
              // Off-chain metadata fetch failed — proceed without it
            }
          }
        } catch {
          // Metadata lookup failed for this mint — keep base data
        }
      }),
    )

    if (allTokens.length > 0) {
      allTokens.forEach(({ mint, tokenData }) => {
        this.map.set(mint, tokenData)
      })
      await this.save(allTokens.map((entry) => entry.mint))
    }

    return result
  }

  /** Read-only view of the full in-memory map. */
  get tokens(): ReadonlyMap<SolanaAddress, TokenData> {
    return this.map
  }
}
