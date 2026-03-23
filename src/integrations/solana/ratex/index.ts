import { PublicKey } from '@solana/web3.js'
import type {
  ConstantProductLiquidityDefiPosition,
  MaybeSolanaAccount,
  SolanaIntegration,
  SolanaPlugins,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

// RateX trader programs from the official contracts page.
const PROGRAMS = [
  'RAtEwzA1rerjeWip6uMuheQtzykxYCrEQRaSFCCrf2D',
  'RATEuvat8kBBvomUgsbGDS2EV4KjKCoMKCP3DpxYmF8',
  'RAtEjoYMC6U3fWrbxcuda1N4hcgDbgqQN8MFCsA7ge2',
  'rAtEti4KRfAtVTYhcdYbVznJkbt8yTAXebwHEAr31xr',
  'ratEH6tibNBomaJtiFtivmPk7pxcPPvRg3mEt8vZiEK',
  'rATeLFtHiGs6Q1rz4VNsp62vc3B8dLsDrNFm2NzKHSR',
  'rATEA6NzH5jVXbJkAwPsknuvviVrSnSpARNATkG2ZJ6',
  'RaTEiNdQ31benKiF11k1kzv48EeK69HHNadvQXiFq6Z',
  'raTeSRo3LFRvsrcXFKgu1P8F4DLE39h6b1zeT2HfwAq',
  'RAtegmyRsp72GuTVFrg68KC4EryqHYp5tWNdm9qJ3ub',
  'raTeSq8Ebeb1JR3xRgSz7i2DP35Fyz5zsszkijgnXKm',
  'rAtERVnFCEdaY3BqP7w1wdMJFphHz9m8uTyLjRkw8Fu',
  'RaTeUhvvohYGErSb2Sy3RA5EdMv9A9jtiJe8FHTg7uK',
  'rAtewzmMSgn1QGewCM8PHdoW49bbuzrDQi4ftFoTFWo',
  // Additional live market programs exposed by the production app asset maps.
  'RAtELWRTmTxPtDUue6ihnoXRhLzjbFixvJmH9RwymLo',
  'RateNeT2BXBKaV33ECFRNwwi2nGGsZWPdWEJMncBsU8',
  'RAtEizi1p6eXCashGSnMtzbJNwxmpeRHBPFRsS9uKBH',
] as const

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
const RATEX_GATEWAY_URL = 'https://api.rate-x.io'
const RATEX_SESSION_ID = 'trackall-integrations'

// Account discriminators (from ratex-earn-sdk IDL)
const USER_DISCRIMINATOR = Buffer.from([159, 117, 95, 227, 239, 151, 58, 236])
const USER_STATS_DISCRIMINATOR = Buffer.from([
  176, 223, 136, 27, 122, 79, 32, 227,
])

// UserStats layout
const USER_STATS_NUM_CREATED_OFFSET = 74 // u16: number_of_sub_accounts_created

// User account layout
const USER_MARGIN_POSITIONS_OFFSET = 40 // [MarginPosition; 2], 48 bytes each
const USER_YIELD_POSITIONS_OFFSET = 3720 // [YieldPosition; 8], 64 bytes each
const MARGIN_POSITION_SIZE = 48
const YIELD_POSITION_SIZE = 64
const MAX_MARGIN_POSITIONS = 2
const MAX_YIELD_POSITIONS = 8

// MarginPosition field offsets (within each 48-byte slot)
const MP_BALANCE = 0 // i64: deposited collateral amount
const MP_MARKET_INDEX = 8 // u32: which MarginMarket
const MP_DECIMALS = 12 // u32: collateral token decimals

// YieldPosition field offsets (within each 64-byte slot)
const YP_BASE_AMOUNT = 0 // i64: YT exposure (positive = long yield)
const YP_MARKET_INDEX = 24 // u32: which YieldMarket

// MarginMarket layout
const MARGIN_MARKET_MINT_OFFSET = 40 // pubkey: SPL token mint
const MARGIN_MARKET_DECIMALS_OFFSET = 176 // u32: token decimals
// YieldMarket layout
const YIELD_MARKET_NAME_OFFSET = 72 // [u8; 32]: human-readable name (e.g. "JitoSOL-2506")
const YIELD_MARKET_EXPIRE_OFFSET = 864 // i64: market expiry Unix timestamp
const YIELD_MARKET_MARGIN_OFFSET = 908 // u32: margin_index referencing collateral MarginMarket

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = PROGRAMS

type RatexGatewayResponse<T> = {
  code?: number
  data?: T
}

type RatexLpRecordRow = {
  Lower?: string
  MarginAmount?: string
  MarketIndicator?: string
  SecurityID?: string
  SettlCurrency?: string
  TransactTime?: string
  Upper?: string
}

type RatexPriceMap = Record<string, number | string>

function checkDiscriminator(data: Uint8Array, expected: Buffer): boolean {
  if (data.length < 8) return false
  return Buffer.from(data.subarray(0, 8)).equals(expected)
}

function readI64(data: Uint8Array, offset: number): bigint {
  return Buffer.from(data).readBigInt64LE(offset)
}

function readU32(data: Uint8Array, offset: number): number {
  return Buffer.from(data).readUInt32LE(offset)
}

function readU16(data: Uint8Array, offset: number): number {
  return Buffer.from(data).readUInt16LE(offset)
}

function readU64(data: Uint8Array, offset: number): bigint {
  return Buffer.from(data).readBigUInt64LE(offset)
}

function readPubkey(data: Uint8Array, offset: number): string {
  return new PublicKey(
    Buffer.from(data).subarray(offset, offset + 32),
  ).toBase58()
}

function readName(data: Uint8Array, offset: number): string {
  return Buffer.from(data)
    .subarray(offset, offset + 32)
    .toString('utf8')
    .replace(/\0+$/, '')
    .trim()
}

function deriveUserStatsPda(authority: PublicKey, programId: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stats'), authority.toBuffer()],
    new PublicKey(programId),
  )
  return pda.toBase58()
}

function deriveUserPda(
  authority: PublicKey,
  subId: number,
  programId: string,
): string {
  const subIdBuf = Buffer.alloc(2)
  subIdBuf.writeUInt16LE(subId)
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user'), authority.toBuffer(), subIdBuf],
    new PublicKey(programId),
  )
  return pda.toBase58()
}

function deriveMarginMarketPda(index: number, programId: string): string {
  const idxBuf = Buffer.alloc(4)
  idxBuf.writeUInt32LE(index)
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('margin_market'), idxBuf],
    new PublicKey(programId),
  )
  return pda.toBase58()
}

function deriveYieldMarketPda(index: number, programId: string): string {
  const idxBuf = Buffer.alloc(4)
  idxBuf.writeUInt32LE(index)
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('yield_market'), idxBuf],
    new PublicKey(programId),
  )
  return pda.toBase58()
}

function deriveMetadataPda(mint: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      new PublicKey(METADATA_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(METADATA_PROGRAM_ID),
  )
  return pda.toBase58()
}

function readMetaplexString(
  data: Uint8Array,
  offset: number,
): {
  nextOffset: number
  value: string
} {
  const length = readU32(data, offset)
  const start = offset + 4
  const end = start + length
  if (end > data.length) return { nextOffset: end, value: '' }
  return {
    nextOffset: end,
    value: Buffer.from(data)
      .subarray(start, end)
      .toString('utf8')
      .replace(/\0+$/, '')
      .trim(),
  }
}

function readMetadataNameAndSymbol(data: Uint8Array): {
  name: string
  symbol: string
} {
  if (data.length < 69) return { name: '', symbol: '' }
  const name = readMetaplexString(data, 65)
  const symbol = readMetaplexString(data, name.nextOffset)
  return { name: name.value, symbol: symbol.value }
}

function getOrCreateIndexSet(
  map: Map<number, Set<number>>,
  programIndex: number,
): Set<number> {
  let set = map.get(programIndex)
  if (!set) {
    set = new Set()
    map.set(programIndex, set)
  }
  return set
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

function isExistingAccount(
  account: MaybeSolanaAccount,
): account is Extract<MaybeSolanaAccount, { exists: true }> {
  return account.exists
}

function parseDecimalAmount(value: string): {
  amount: string
  decimals: number
} {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')

  return {
    amount: negative ? `-${digits || '0'}` : digits || '0',
    decimals: fraction.length,
  }
}

function parseTimestampMs(value?: string): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseYymm(value?: string): number | null {
  if (!value) return null
  const match = /-(\d{4})$/.exec(value)
  if (!match?.[1]) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function getCurrentUtcYymm(): number {
  const now = new Date()
  return (now.getUTCFullYear() % 100) * 100 + (now.getUTCMonth() + 1)
}

function getLpAssetSymbol(row: RatexLpRecordRow): string {
  return row.SecurityID?.split('-')[0] || row.SettlCurrency || 'UNKNOWN'
}

function getRatePrice(
  prices: RatexPriceMap,
  row: RatexLpRecordRow,
  assetSymbol: string,
): number | undefined {
  const candidates = [
    row.MarketIndicator ? `${row.MarketIndicator}USDT` : undefined,
    row.SettlCurrency ? `${row.SettlCurrency}USDT` : undefined,
    `${assetSymbol.toUpperCase()}USDT`,
  ]

  for (const key of candidates) {
    if (!key) continue
    const value = prices[key]
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : NaN
    if (Number.isFinite(numeric)) return numeric
  }

  return undefined
}

async function fetchRatexGatewayData<T>(
  serverName: string,
  method: string,
  content: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    const res = await fetch(RATEX_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        SessionId: RATEX_SESSION_ID,
      },
      body: JSON.stringify({
        serverName,
        method,
        content: {
          cid: RATEX_SESSION_ID,
          ...content,
        },
      }),
    })

    const json = (await res.json()) as RatexGatewayResponse<T>
    if (!res.ok || json.code !== 0) return undefined
    return json.data
  } catch {
    return undefined
  }
}

export const ratexIntegration: SolanaIntegration = {
  platformId: 'ratex',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const authority = new PublicKey(address)
    const ownerTokenAccounts = yield {
      kind: 'getTokenAccountsByOwner' as const,
      owner: address,
      programId: TOKEN_PROGRAM_ID,
    }

    // Phase 0: fetch UserStats for every supported RateX trader program.
    const userStatsPdas = PROGRAMS.map((prog) =>
      deriveUserStatsPda(authority, prog),
    )
    const userStatsMap = yield userStatsPdas

    const subAccountCounts = PROGRAMS.map((_, i) => {
      const pda = userStatsPdas[i]
      const acc = pda !== undefined ? userStatsMap[pda] : undefined
      if (
        !acc?.exists ||
        !checkDiscriminator(acc.data, USER_STATS_DISCRIMINATOR)
      )
        return 0
      if (acc.data.length < USER_STATS_NUM_CREATED_OFFSET + 2) return 0
      return readU16(acc.data, USER_STATS_NUM_CREATED_OFFSET)
    })

    // Phase 1: fetch all User PDAs (always try sub-account 0 even without UserStats)
    const userEntries: Array<{ pda: string; programIndex: number }> = []
    for (const [pi, progId] of PROGRAMS.entries()) {
      const count = Math.max(subAccountCounts[pi] ?? 0, 1)
      for (let si = 0; si < count; si++) {
        userEntries.push({
          pda: deriveUserPda(authority, si, progId),
          programIndex: pi,
        })
      }
    }

    const userAccounts = yield userEntries.map((e) => e.pda)

    type MarginPos = {
      balance: bigint
      marketIndex: number
      decimals: number
      programIndex: number
    }
    type YieldPos = {
      baseAmount: bigint
      marketIndex: number
      programIndex: number
    }

    const marginPositions: MarginPos[] = []
    const yieldPositions: YieldPos[] = []
    const marginMarketsByProgram = new Map<number, Set<number>>()
    const yieldMarketsByProgram = new Map<number, Set<number>>()

    const minUserSize =
      USER_YIELD_POSITIONS_OFFSET + YIELD_POSITION_SIZE * MAX_YIELD_POSITIONS
    for (const { pda, programIndex } of userEntries) {
      const acc = userAccounts[pda]
      if (!acc?.exists || !checkDiscriminator(acc.data, USER_DISCRIMINATOR))
        continue
      if (acc.data.length < minUserSize) continue

      for (let i = 0; i < MAX_MARGIN_POSITIONS; i++) {
        const base = USER_MARGIN_POSITIONS_OFFSET + i * MARGIN_POSITION_SIZE
        const balance = readI64(acc.data, base + MP_BALANCE)
        if (balance <= 0n) continue
        const marketIndex = readU32(acc.data, base + MP_MARKET_INDEX)
        const decimals = readU32(acc.data, base + MP_DECIMALS)
        marginPositions.push({ balance, marketIndex, decimals, programIndex })
        getOrCreateIndexSet(marginMarketsByProgram, programIndex).add(
          marketIndex,
        )
      }

      for (let i = 0; i < MAX_YIELD_POSITIONS; i++) {
        const base = USER_YIELD_POSITIONS_OFFSET + i * YIELD_POSITION_SIZE
        const baseAmount = readI64(acc.data, base + YP_BASE_AMOUNT)
        if (baseAmount === 0n) continue
        const marketIndex = readU32(acc.data, base + YP_MARKET_INDEX)
        yieldPositions.push({ baseAmount, marketIndex, programIndex })
        getOrCreateIndexSet(yieldMarketsByProgram, programIndex).add(
          marketIndex,
        )
      }
    }

    const phase2Pdas = new Map<string, string>()

    for (const [pi, indices] of marginMarketsByProgram) {
      const progId = PROGRAMS[pi]
      if (!progId) continue
      for (const idx of indices) {
        phase2Pdas.set(`m:${pi}:${idx}`, deriveMarginMarketPda(idx, progId))
      }
    }
    for (const [pi, indices] of yieldMarketsByProgram) {
      const progId = PROGRAMS[pi]
      if (!progId) continue
      for (const idx of indices) {
        phase2Pdas.set(`y:${pi}:${idx}`, deriveYieldMarketPda(idx, progId))
      }
    }

    const phase2Map = yield [...new Set(phase2Pdas.values())]

    const marginMarketInfo = new Map<
      string,
      { mint: string; decimals: number }
    >()
    for (const [pi, indices] of marginMarketsByProgram) {
      for (const idx of indices) {
        const addr = phase2Pdas.get(`m:${pi}:${idx}`)
        if (!addr) continue
        const acc = phase2Map[addr]
        if (!acc?.exists || acc.data.length < MARGIN_MARKET_DECIMALS_OFFSET + 4)
          continue
        const mint = readPubkey(acc.data, MARGIN_MARKET_MINT_OFFSET)
        const decimals = readU32(acc.data, MARGIN_MARKET_DECIMALS_OFFSET)
        marginMarketInfo.set(`${pi}:${idx}`, { mint, decimals })
      }
    }

    type YieldMarketInfo = {
      name: string
      expireTs: bigint
      marginIndex: number
    }
    const yieldMarketInfo = new Map<string, YieldMarketInfo>()
    for (const [pi, indices] of yieldMarketsByProgram) {
      for (const idx of indices) {
        const addr = phase2Pdas.get(`y:${pi}:${idx}`)
        if (!addr) continue
        const acc = phase2Map[addr]
        if (!acc?.exists || acc.data.length < YIELD_MARKET_MARGIN_OFFSET + 4)
          continue
        const name = readName(acc.data, YIELD_MARKET_NAME_OFFSET)
        const expireTs = readI64(acc.data, YIELD_MARKET_EXPIRE_OFFSET)
        const marginIndex = readU32(acc.data, YIELD_MARKET_MARGIN_OFFSET)
        getOrCreateIndexSet(marginMarketsByProgram, pi).add(marginIndex)
        yieldMarketInfo.set(`${pi}:${idx}`, { name, expireTs, marginIndex })
      }
    }

    const phase3Pdas = new Map<string, string>()
    for (const [pi, indices] of marginMarketsByProgram) {
      const progId = PROGRAMS[pi]
      if (!progId) continue
      for (const idx of indices) {
        const key = `${pi}:${idx}`
        if (marginMarketInfo.has(key)) continue
        phase3Pdas.set(key, deriveMarginMarketPda(idx, progId))
      }
    }

    if (phase3Pdas.size > 0) {
      const phase3Map = yield [...new Set(phase3Pdas.values())]
      for (const [key, addr] of phase3Pdas) {
        const acc = phase3Map[addr]
        if (!acc?.exists || acc.data.length < MARGIN_MARKET_DECIMALS_OFFSET + 4)
          continue
        const mint = readPubkey(acc.data, MARGIN_MARKET_MINT_OFFSET)
        const decimals = readU32(acc.data, MARGIN_MARKET_DECIMALS_OFFSET)
        marginMarketInfo.set(key, { mint, decimals })
      }
    }

    const result: UserDefiPosition[] = []

    for (const {
      balance,
      marketIndex,
      decimals,
      programIndex,
    } of marginPositions) {
      const info = marginMarketInfo.get(`${programIndex}:${marketIndex}`)
      if (!info) continue

      const token = tokens.get(info.mint)
      const usdValue =
        token?.priceUsd !== undefined
          ? ((Number(balance) / 10 ** decimals) * token.priceUsd).toString()
          : undefined

      const position: StakingDefiPosition = {
        platformId: 'ratex',
        positionKind: 'staking',
        staked: [
          {
            amount: {
              token: info.mint,
              amount: balance.toString(),
              decimals: decimals.toString(),
            },
            ...(token?.priceUsd !== undefined && {
              priceUsd: token.priceUsd.toString(),
            }),
            ...(usdValue !== undefined && { usdValue }),
          },
        ],
        ...(usdValue !== undefined && { usdValue }),
      }
      result.push(position)
    }

    for (const { baseAmount, marketIndex, programIndex } of yieldPositions) {
      const yInfo = yieldMarketInfo.get(`${programIndex}:${marketIndex}`)
      const mInfo = yInfo
        ? marginMarketInfo.get(`${programIndex}:${yInfo.marginIndex}`)
        : undefined

      const token = mInfo ? tokens.get(mInfo.mint) : undefined
      const absAmount = baseAmount < 0n ? -baseAmount : baseAmount
      const usdValue =
        token?.priceUsd !== undefined && mInfo !== undefined
          ? (
              (Number(absAmount) / 10 ** mInfo.decimals) *
              token.priceUsd
            ).toString()
          : undefined

      const position: StakingDefiPosition = {
        platformId: 'ratex',
        positionKind: 'staking',
        ...(mInfo !== undefined && {
          staked: [
            {
              amount: {
                token: mInfo.mint,
                amount: absAmount.toString(),
                decimals: mInfo.decimals.toString(),
              },
              ...(token?.priceUsd !== undefined && {
                priceUsd: token.priceUsd.toString(),
              }),
              ...(usdValue !== undefined && { usdValue }),
            },
          ],
        }),
        ...(usdValue !== undefined && { usdValue }),
        meta: {
          yieldPosition: {
            direction: baseAmount > 0n ? 'long' : 'short',
            marketName: yInfo?.name ?? `market-${marketIndex}`,
            ...(yInfo?.expireTs !== undefined && {
              expiresAt: yInfo.expireTs.toString(),
            }),
          },
        },
      }
      result.push(position)
    }

    // Current LP balances are indexed by the RateX backend. The production app
    // uses that feed for wallet LP rows, while the stable on-chain account path
    // is not exposed across all current markets.
    const [lpRecords, ratePrices] = await Promise.all([
      fetchRatexGatewayData<RatexLpRecordRow[]>('AdminSvr', 'queryLpRecord', {
        pageNum: 0,
        pageSize: 200,
        user_id: address,
      }),
      fetchRatexGatewayData<RatexPriceMap>('APSSvr', 'ratePrice', {}),
    ])

    if ((lpRecords?.length ?? 0) > 0) {
      const currentYymm = getCurrentUtcYymm()
      const latestLpRowsBySecurity = new Map<string, RatexLpRecordRow>()

      for (const row of lpRecords ?? []) {
        const securityId = row.SecurityID
        if (!securityId) continue

        const current = latestLpRowsBySecurity.get(securityId)
        if (
          current === undefined ||
          parseTimestampMs(row.TransactTime) >=
            parseTimestampMs(current.TransactTime)
        ) {
          latestLpRowsBySecurity.set(securityId, row)
        }
      }

      for (const row of latestLpRowsBySecurity.values()) {
        const securityId = row.SecurityID
        const marginAmount = row.MarginAmount
        if (!securityId || !marginAmount || Number(marginAmount) <= 0) continue

        const maturity = parseYymm(securityId)
        if (maturity !== null && maturity < currentYymm) continue

        const assetSymbol = getLpAssetSymbol(row)
        const parsedAmount = parseDecimalAmount(marginAmount)
        const priceUsd = getRatePrice(ratePrices ?? {}, row, assetSymbol)
        const usdValue =
          priceUsd !== undefined
            ? (Number(marginAmount) * priceUsd).toString()
            : undefined

        const position: ConstantProductLiquidityDefiPosition = {
          platformId: 'ratex',
          positionKind: 'liquidity',
          liquidityModel: 'constant-product',
          poolAddress: securityId,
          poolTokens: [
            {
              amount: {
                token: assetSymbol,
                amount: parsedAmount.amount,
                decimals: parsedAmount.decimals.toString(),
              },
              ...(priceUsd !== undefined && { priceUsd: priceUsd.toString() }),
              ...(usdValue !== undefined && { usdValue }),
            },
          ],
          ...(usdValue !== undefined && { usdValue }),
          meta: {
            liquidityPool: {
              marketName: securityId,
              assetSymbol,
              ...(row.MarketIndicator && {
                marketIndicator: row.MarketIndicator,
              }),
              ...(row.Lower && { lowerRate: row.Lower }),
              ...(row.Upper && { upperRate: row.Upper }),
            },
          },
        }
        result.push(position)
      }
    }

    const nonZeroTokenAccounts = Object.values(ownerTokenAccounts).filter(
      (account): account is Extract<MaybeSolanaAccount, { exists: true }> =>
        isExistingAccount(account) &&
        account.data.length >= 72 &&
        readU64(account.data, 64) > 0n,
    )

    if (nonZeroTokenAccounts.length > 0) {
      const mintAddresses = [
        ...new Set(
          nonZeroTokenAccounts.map((account) => readPubkey(account.data, 0)),
        ),
      ]
      const metadataPdas = new Map(
        mintAddresses.map((mint) => [mint, deriveMetadataPda(mint)]),
      )
      const mintAndMetadataAccounts: Record<
        string,
        (typeof ownerTokenAccounts)[string]
      > = {}

      for (const mintChunk of chunk(mintAddresses, 50)) {
        const addresses = [
          ...mintChunk,
          ...mintChunk.flatMap((mint) => {
            const metadataPda = metadataPdas.get(mint)
            return metadataPda === undefined ? [] : [metadataPda]
          }),
        ]
        const chunkAccounts = yield addresses
        Object.assign(mintAndMetadataAccounts, chunkAccounts)
      }

      for (const account of nonZeroTokenAccounts) {
        const mint = readPubkey(account.data, 0)
        const rawAmount = readU64(account.data, 64)
        if (rawAmount === 0n) continue

        const mintAccount = mintAndMetadataAccounts[mint]
        if (!mintAccount?.exists || mintAccount.data.length < 45) continue
        const decimals = mintAccount.data[44] ?? 0

        const metadataPda = metadataPdas.get(mint)
        const metadataAccount =
          metadataPda !== undefined
            ? mintAndMetadataAccounts[metadataPda]
            : undefined
        const { name, symbol } =
          metadataAccount?.exists && metadataAccount.data.length >= 69
            ? readMetadataNameAndSymbol(metadataAccount.data)
            : { name: '', symbol: '' }

        const isRatexPt =
          (name.startsWith('PT-') || symbol.startsWith('PT')) &&
          name.includes('(RateX)')
        if (!isRatexPt) continue

        const token = tokens.get(mint)
        const amount = Number(rawAmount) / 10 ** decimals
        const usdValue =
          token?.priceUsd !== undefined
            ? (amount * token.priceUsd).toString()
            : undefined

        const position: StakingDefiPosition = {
          platformId: 'ratex',
          positionKind: 'staking',
          staked: [
            {
              amount: {
                token: mint,
                amount: rawAmount.toString(),
                decimals: decimals.toString(),
              },
              ...(token?.priceUsd !== undefined && {
                priceUsd: token.priceUsd.toString(),
              }),
              ...(usdValue !== undefined && { usdValue }),
            },
          ],
          ...(usdValue !== undefined && { usdValue }),
          meta: {
            earnPosition: {
              marketName: name || symbol || mint,
              symbol: symbol || undefined,
            },
          },
        }
        result.push(position)
      }
    }

    return result
  },
}

export default ratexIntegration
