import { address, createSolanaRpc } from '@solana/kit'
import { fetchMaybeMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata-kit'
import type { SolanaAddress } from '../types/solanaIntegration'

type SolanaRpc = ReturnType<typeof createSolanaRpc>

// SPL Token mint layout: mint_authority (36 bytes) + supply (8 bytes) + decimals (1 byte)
const MINT_DECIMALS_OFFSET = 44

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
  private cachePath: string

  constructor(rpc: SolanaRpc, cachePath = '.cache/tokens.json') {
    this.rpc = rpc
    this.cachePath = cachePath
  }

  /** Load cache from disk. Call once at startup. */
  async load(): Promise<void> {
    try {
      const entries = (await Bun.file(this.cachePath).json()) as [SolanaAddress, TokenData][]
      this.map = new Map(entries)
    } catch {
      // File doesn't exist or is invalid — start with empty cache
    }
  }

  /** Persist current cache to disk. */
  async save(): Promise<void> {
    await Bun.write(this.cachePath, JSON.stringify([...this.map]))
  }

  /** Get a token from the in-memory cache. */
  get(mint: SolanaAddress): TokenData | undefined {
    return this.map.get(mint)
  }

  /** Fetch full metadata for a mint, update in-memory and disk cache. Returns undefined if mint account does not exist. */
  async fetch(mint: SolanaAddress): Promise<TokenData | undefined> {
    const cached = this.map.get(mint)
    if (cached) return cached

    const mintAccount = await this.rpc.getAccountInfo(address(mint), { encoding: 'base64' }).send()
    if (!mintAccount.value) return undefined

    const mintData = Buffer.from(mintAccount.value.data[0] as string, 'base64')
    if (mintData.length < MINT_DECIMALS_OFFSET + 1) return undefined

    const decimals = mintData[MINT_DECIMALS_OFFSET]!
    const tokenData: TokenData = { mintAddress: mint, decimals }

    const metadataAccount = await fetchMaybeMetadataFromSeeds(this.rpc, { mint: address(mint) })

    if (metadataAccount.exists) {
      const metadata = metadataAccount.data
      tokenData.name = metadata.name
      tokenData.symbol = metadata.symbol
      tokenData.uri = metadata.uri
      tokenData.updateAuthority = String(metadata.updateAuthority)
      tokenData.isMutable = metadata.isMutable

      if (metadata.creators.__option === 'Some') {
        tokenData.creators = metadata.creators.value.map((c) => ({
          address: c.address as SolanaAddress,
          verified: c.verified,
          share: c.share,
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
    }

    this.map.set(mint, tokenData)
    await this.save()

    return tokenData
  }

  /** Read-only view of the full in-memory map. */
  get tokens(): ReadonlyMap<SolanaAddress, TokenData> {
    return this.map
  }
}
