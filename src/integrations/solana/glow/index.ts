import { unpackAccount, unpackMint } from '@solana/spl-token'
import { type AccountInfo, PublicKey } from '@solana/web3.js'
import type {
  LendingBorrowedAsset,
  LendingDefiPosition,
  LendingSuppliedAsset,
  SolanaAccount,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

const MARGIN_PROGRAM_ID = 'GLoWMgcn3VbyFKiC2FGMgfKxYSyTJS7uKFwKY2CSkq9X'
const MARGIN_POOL_PROGRAM_ID = 'CWPeEXnSpELj7tSz9W4oQAGGRbavBtdnhY2bWMyPoo1'
const AIRSPACE_PROGRAM_ID = 'AmAJeyNxxjNHfhBoCpsNMgWxhukdv3DSu3XpLfJspace'

export const PROGRAM_IDS = [
  MARGIN_PROGRAM_ID,
  MARGIN_POOL_PROGRAM_ID,
  AIRSPACE_PROGRAM_ID,
] as const

const MARGIN_ACCOUNT_DISC_B64 = 'hdyt1bPTK+4='
const TOKEN_CONFIG_DISC_B64 = 'XEn/K2szdWU='
const MARGIN_POOL_DISC_B64 = 'jv8cIMSoqq8='

const OWNER_OFFSET = 16
const AIRSPACE_OFFSET = 48
const LIQUIDATOR_OFFSET = 80
const PUBKEY_SIZE = 32
const TOKEN_CONFIG_MINT_OFFSET = 8
const TOKEN_CONFIG_AIRSPACE_OFFSET = 136
const TOKEN_CONFIG_KIND_OFFSET = 168
const TOKEN_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000
const MARGIN_POOL_CACHE_TTL_MS = 5 * 60 * 1000

const MARGIN_POOL_DEPOSIT_NOTE_MINT_OFFSET = 106
const MARGIN_POOL_LOAN_NOTE_MINT_OFFSET = 138
const MARGIN_POOL_TOKEN_MINT_OFFSET = 170

type TokenKind = 'Collateral' | 'Claim' | 'AdapterCollateral'

interface MarginAccountLite {
  address: string
  owner: string
  airspace: string
  liquidator: string
}

interface TokenConfigLite {
  mint: string
  airspace: string
  kind: TokenKind
}

interface DerivedTokenAccount {
  marginAccount: string
  mint: string
  kind: TokenKind
  tokenAccount: string
}

interface DecodedTokenBalance {
  marginAccount: string
  mint: string
  kind: TokenKind
  tokenAccount: string
  tokenOwner: string
  amountRaw: bigint
}

interface MarginPoolLite {
  address: string
  depositNoteMint: string
  loanNoteMint: string
  tokenMint: string
}

function hasDiscriminator(data: Uint8Array, discriminatorB64: string): boolean {
  const expected = Buffer.from(discriminatorB64, 'base64')
  if (data.length < expected.length) return false
  for (let idx = 0; idx < expected.length; idx++) {
    if (data[idx] !== expected[idx]) return false
  }
  return true
}

function readPubkey(data: Uint8Array, offset: number): string | null {
  if (offset + PUBKEY_SIZE > data.length) return null
  return new PublicKey(data.slice(offset, offset + PUBKEY_SIZE)).toBase58()
}

function decodeMarginAccount(account: SolanaAccount): MarginAccountLite | null {
  if (!hasDiscriminator(account.data, MARGIN_ACCOUNT_DISC_B64)) return null

  const owner = readPubkey(account.data, OWNER_OFFSET)
  const airspace = readPubkey(account.data, AIRSPACE_OFFSET)
  const liquidator = readPubkey(account.data, LIQUIDATOR_OFFSET)

  if (!owner || !airspace || !liquidator) return null

  return {
    address: account.address,
    owner,
    airspace,
    liquidator,
  }
}

function decodeTokenKind(value: number): TokenKind | null {
  switch (value) {
    case 0:
      return 'Collateral'
    case 1:
      return 'Claim'
    case 2:
      return 'AdapterCollateral'
    default:
      return null
  }
}

function decodeTokenConfig(account: SolanaAccount): TokenConfigLite | null {
  if (!hasDiscriminator(account.data, TOKEN_CONFIG_DISC_B64)) return null
  if (account.data.length <= TOKEN_CONFIG_KIND_OFFSET) return null

  const mint = readPubkey(account.data, TOKEN_CONFIG_MINT_OFFSET)
  const airspace = readPubkey(account.data, TOKEN_CONFIG_AIRSPACE_OFFSET)
  const kind = decodeTokenKind(account.data[TOKEN_CONFIG_KIND_OFFSET] ?? 255)

  if (!mint || !airspace || !kind) return null

  return {
    mint,
    airspace,
    kind,
  }
}

function decodeMarginPool(account: SolanaAccount): MarginPoolLite | null {
  if (!hasDiscriminator(account.data, MARGIN_POOL_DISC_B64)) return null

  const depositNoteMint = readPubkey(
    account.data,
    MARGIN_POOL_DEPOSIT_NOTE_MINT_OFFSET,
  )
  const loanNoteMint = readPubkey(
    account.data,
    MARGIN_POOL_LOAN_NOTE_MINT_OFFSET,
  )
  const tokenMint = readPubkey(account.data, MARGIN_POOL_TOKEN_MINT_OFFSET)

  if (!depositNoteMint || !loanNoteMint || !tokenMint) return null

  return {
    address: account.address,
    depositNoteMint,
    loanNoteMint,
    tokenMint,
  }
}

function toAccountInfo(account: SolanaAccount): AccountInfo<Buffer> {
  return {
    data: Buffer.from(account.data),
    executable: false,
    lamports: Number(account.lamports),
    owner: new PublicKey(account.programAddress),
    rentEpoch: 0,
  }
}

function decodeTokenBalance(
  account: SolanaAccount,
): { mint: string; owner: string; amount: bigint } | null {
  try {
    const decoded = unpackAccount(
      new PublicKey(account.address),
      toAccountInfo(account),
      new PublicKey(account.programAddress),
    )
    return {
      mint: decoded.mint.toBase58(),
      owner: decoded.owner.toBase58(),
      amount: decoded.amount,
    }
  } catch {
    return null
  }
}

function decodeMintDecimals(account: SolanaAccount): number | undefined {
  try {
    const decoded = unpackMint(
      new PublicKey(account.address),
      toAccountInfo(account),
      new PublicKey(account.programAddress),
    )
    return decoded.decimals
  } catch {
    return undefined
  }
}

function buildPdaAddress(
  programId: string,
  marginAccount: string,
  mint: string,
): string {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(marginAccount).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(programId),
  )[0].toBase58()
}

function buildPositionValue(
  mint: string,
  amountRaw: bigint,
  decimals: number,
  plugins: SolanaPlugins,
): LendingSuppliedAsset {
  const token = plugins.tokens.get(mint)
  const priceUsd = token?.priceUsd
  const usdValue =
    priceUsd !== undefined && amountRaw <= BigInt(Number.MAX_SAFE_INTEGER)
      ? ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
      : undefined

  return {
    amount: {
      token: mint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(priceUsd !== undefined && { priceUsd: priceUsd.toString() }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function groupTokenConfigsByAirspace(
  tokenConfigs: TokenConfigLite[],
): Map<string, TokenConfigLite[]> {
  const grouped = new Map<string, Map<string, TokenConfigLite>>()

  for (const tokenConfig of tokenConfigs) {
    let byMint = grouped.get(tokenConfig.airspace)
    if (!byMint) {
      byMint = new Map<string, TokenConfigLite>()
      grouped.set(tokenConfig.airspace, byMint)
    }

    // Keep one config per mint/airspace to avoid duplicate PDA derivations.
    if (!byMint.has(tokenConfig.mint)) {
      byMint.set(tokenConfig.mint, tokenConfig)
    }
  }

  return new Map(
    [...grouped.entries()].map(([airspace, byMint]) => [
      airspace,
      [...byMint.values()],
    ]),
  )
}

export const glowIntegration: SolanaIntegration = {
  platformId: 'glow',

  getUserPositions: async function* (
    address: string,
    plugins: SolanaPlugins,
  ): UserPositionsPlan {
    const marginAccountsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: MARGIN_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: MARGIN_ACCOUNT_DISC_B64,
            encoding: 'base64',
          },
        },
        {
          memcmp: {
            offset: OWNER_OFFSET,
            bytes: address,
            encoding: 'base58',
          },
        },
      ],
    }

    const marginAccounts: MarginAccountLite[] = []
    for (const account of Object.values(marginAccountsMap)) {
      if (!account.exists) continue
      const decoded = decodeMarginAccount(account)
      if (!decoded) continue
      if (decoded.owner !== address) continue
      marginAccounts.push(decoded)
    }

    if (marginAccounts.length === 0) return []

    const tokenConfigsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: MARGIN_PROGRAM_ID,
      cacheTtlMs: TOKEN_CONFIG_CACHE_TTL_MS,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: TOKEN_CONFIG_DISC_B64,
            encoding: 'base64',
          },
        },
      ],
    }

    const tokenConfigs: TokenConfigLite[] = []
    for (const account of Object.values(tokenConfigsMap)) {
      if (!account.exists) continue
      const decoded = decodeTokenConfig(account)
      if (!decoded) continue
      tokenConfigs.push(decoded)
    }

    if (tokenConfigs.length === 0) return []

    const tokenConfigsByAirspace = groupTokenConfigsByAirspace(tokenConfigs)
    const marginPoolsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: MARGIN_POOL_PROGRAM_ID,
      cacheTtlMs: MARGIN_POOL_CACHE_TTL_MS,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: MARGIN_POOL_DISC_B64,
            encoding: 'base64',
          },
        },
      ],
    }

    const noteMintToUnderlyingMint = new Map<string, string>()
    const noteMintToPool = new Map<string, string>()

    for (const account of Object.values(marginPoolsMap)) {
      if (!account.exists) continue
      const decoded = decodeMarginPool(account)
      if (!decoded) continue

      noteMintToUnderlyingMint.set(decoded.depositNoteMint, decoded.tokenMint)
      noteMintToUnderlyingMint.set(decoded.loanNoteMint, decoded.tokenMint)
      noteMintToPool.set(decoded.depositNoteMint, decoded.address)
      noteMintToPool.set(decoded.loanNoteMint, decoded.address)
    }

    const derivedTokenAccounts: DerivedTokenAccount[] = []
    for (const marginAccount of marginAccounts) {
      const configs = tokenConfigsByAirspace.get(marginAccount.airspace) ?? []
      for (const tokenConfig of configs) {
        const programId =
          tokenConfig.kind === 'Claim'
            ? MARGIN_POOL_PROGRAM_ID
            : MARGIN_PROGRAM_ID

        derivedTokenAccounts.push({
          marginAccount: marginAccount.address,
          mint: tokenConfig.mint,
          kind: tokenConfig.kind,
          tokenAccount: buildPdaAddress(
            programId,
            marginAccount.address,
            tokenConfig.mint,
          ),
        })
      }
    }

    if (derivedTokenAccounts.length === 0) return []

    const tokenAccountAddresses = [
      ...new Set(derivedTokenAccounts.map((entry) => entry.tokenAccount)),
    ]
    const tokenAccountsMap = yield tokenAccountAddresses

    const decodedBalances: DecodedTokenBalance[] = []
    const mintSet = new Set<string>()

    for (const derived of derivedTokenAccounts) {
      const account = tokenAccountsMap[derived.tokenAccount]
      if (!account?.exists) continue

      const decoded = decodeTokenBalance(account)
      if (!decoded || decoded.amount <= 0n) continue
      if (decoded.mint !== derived.mint) continue

      decodedBalances.push({
        marginAccount: derived.marginAccount,
        mint: derived.mint,
        kind: derived.kind,
        tokenAccount: derived.tokenAccount,
        tokenOwner: decoded.owner,
        amountRaw: decoded.amount,
      })
      mintSet.add(derived.mint)

      const underlyingMint = noteMintToUnderlyingMint.get(derived.mint)
      if (underlyingMint) {
        mintSet.add(underlyingMint)
      }
    }

    if (decodedBalances.length === 0 || mintSet.size === 0) return []

    const mintAddresses = [...mintSet]
    const mintAccountsMap = yield mintAddresses
    const decimalsByMint = new Map<string, number>()

    for (const mint of mintAddresses) {
      const account = mintAccountsMap[mint]
      if (!account?.exists) continue
      const decimals = decodeMintDecimals(account)
      if (decimals !== undefined) {
        decimalsByMint.set(mint, decimals)
      }
    }

    const balancesByMarginAccount = new Map<string, DecodedTokenBalance[]>()
    for (const balance of decodedBalances) {
      const list = balancesByMarginAccount.get(balance.marginAccount) ?? []
      list.push(balance)
      balancesByMarginAccount.set(balance.marginAccount, list)
    }

    const positions: UserDefiPosition[] = []

    for (const marginAccount of marginAccounts) {
      const balances = balancesByMarginAccount.get(marginAccount.address) ?? []
      if (balances.length === 0) continue

      const supplied: LendingSuppliedAsset[] = []
      const borrowed: LendingBorrowedAsset[] = []

      balances.sort((left, right) => left.mint.localeCompare(right.mint))

      for (const balance of balances) {
        const displayMint =
          noteMintToUnderlyingMint.get(balance.mint) ?? balance.mint
        const decimals =
          decimalsByMint.get(displayMint) ??
          plugins.tokens.get(displayMint)?.decimals ??
          decimalsByMint.get(balance.mint) ??
          plugins.tokens.get(balance.mint)?.decimals ??
          0

        const value = buildPositionValue(
          displayMint,
          balance.amountRaw,
          decimals,
          plugins,
        )

        if (balance.kind === 'Claim') {
          borrowed.push(value)
        } else {
          supplied.push(value)
        }
      }

      if (supplied.length === 0 && borrowed.length === 0) continue

      positions.push({
        platformId: 'glow',
        positionKind: 'lending',
        ...(supplied.length > 0 && { supplied }),
        ...(borrowed.length > 0 && { borrowed }),
        meta: {
          glow: {
            marginAccount: marginAccount.address,
            owner: marginAccount.owner,
            airspace: marginAccount.airspace,
            liquidator: marginAccount.liquidator,
            noteAccounts: balances.map((balance) => ({
              kind: balance.kind,
              mint: noteMintToUnderlyingMint.get(balance.mint) ?? balance.mint,
              noteMint: balance.mint,
              pool: noteMintToPool.get(balance.mint),
              tokenAccount: balance.tokenAccount,
              tokenOwner: balance.tokenOwner,
              amountRaw: balance.amountRaw.toString(),
            })),
          },
        },
      } satisfies LendingDefiPosition)
    }

    return positions
  },
}

export default glowIntegration
