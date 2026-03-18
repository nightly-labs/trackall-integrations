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

  constructor(rpc: SolanaRpc, cachePath = '.cache/tokens.sqlite') {
    this.rpc = rpc
    const directory = dirname(cachePath)
    if (directory !== '.') {
      mkdirSync(directory, { recursive: true })
    }

    this.db = new Database(cachePath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tokens (
        mint_address TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `)
  }

  /** Load cache from disk. Call once at startup. */
  async load(): Promise<void> {
    try {
      const rows = this.db.prepare('SELECT mint_address, data FROM tokens').all() as Array<{
        mint_address: string
        data: string
      }>
      this.map = new Map(
        rows.flatMap((row) => {
          try {
            return [[row.mint_address as SolanaAddress, JSON.parse(row.data) as TokenData]]
          } catch {
            return []
          }
        }),
      )
    } catch {
      // File doesn't exist or is invalid — start with empty cache
    }
  }

  /** Persist current cache to disk. */
  async save(): Promise<void> {
    const statement = this.db.prepare('INSERT OR REPLACE INTO tokens (mint_address, data) VALUES (?, ?)')
    for (const [mint, tokenData] of this.map.entries()) {
      statement.run(mint, JSON.stringify(tokenData))
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

    if (accountFetchTargets.length > MAX_ACCOUNT_FETCH_SIZE) {
      throw new Error(`fetchMany supports at most ${MAX_ACCOUNT_FETCH_SIZE} uncached mints per call`)
    }

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

        const decimals = mintData[MINT_DECIMALS_OFFSET]!
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
      await this.save()
    }

    return result
  }

  /** Read-only view of the full in-memory map. */
  get tokens(): ReadonlyMap<SolanaAddress, TokenData> {
    return this.map
  }
}
