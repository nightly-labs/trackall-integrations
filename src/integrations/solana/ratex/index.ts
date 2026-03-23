import { PublicKey } from '@solana/web3.js'
import type {
  SolanaIntegration,
  SolanaPlugins,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

// Rate-X deployed programs
// Program 1: SOL LST markets (JitoSOL, bbSOL, BNSOL, INF, ...)
// Program 2: JLP markets
const RATEX_PROGRAM_1 = 'RAtEwzA1rerjeWip6uMuheQtzykxYCrEQRaSFCCrf2D'
const RATEX_PROGRAM_2 = 'RATEuvat8kBBvomUgsbGDS2EV4KjKCoMKCP3DpxYmF8'
const PROGRAMS = [RATEX_PROGRAM_1, RATEX_PROGRAM_2] as const

// Account discriminators (from ratex-earn-sdk IDL)
const USER_DISCRIMINATOR = Buffer.from([159, 117, 95, 227, 239, 151, 58, 236])
const USER_STATS_DISCRIMINATOR = Buffer.from([176, 223, 136, 27, 122, 79, 32, 227])

// UserStats layout
const USER_STATS_NUM_CREATED_OFFSET = 74 // u16: number_of_sub_accounts_created

// User account layout
const USER_MARGIN_POSITIONS_OFFSET = 40   // [MarginPosition; 2], 48 bytes each
const USER_YIELD_POSITIONS_OFFSET = 3720  // [YieldPosition; 8], 64 bytes each
const MARGIN_POSITION_SIZE = 48
const YIELD_POSITION_SIZE = 64
const MAX_MARGIN_POSITIONS = 2
const MAX_YIELD_POSITIONS = 8

// MarginPosition field offsets (within each 48-byte slot)
const MP_BALANCE = 0      // i64: deposited collateral amount
const MP_MARKET_INDEX = 8 // u32: which MarginMarket
const MP_DECIMALS = 12    // u32: collateral token decimals

// YieldPosition field offsets (within each 64-byte slot)
const YP_BASE_AMOUNT = 0   // i64: YT exposure (positive = long yield)
const YP_MARKET_INDEX = 24 // u32: which YieldMarket

// MarginMarket layout
const MARGIN_MARKET_MINT_OFFSET = 40      // pubkey: SPL token mint
const MARGIN_MARKET_DECIMALS_OFFSET = 176 // u32: token decimals
// Pre-fetch margin market indices 0–2 per program (covers all known collateral types)
const PREFETCH_MARGIN_INDICES = [0, 1, 2]

// YieldMarket layout
const YIELD_MARKET_NAME_OFFSET = 72    // [u8; 32]: human-readable name (e.g. "JitoSOL-2506")
const YIELD_MARKET_EXPIRE_OFFSET = 864 // i64: market expiry Unix timestamp
const YIELD_MARKET_MARGIN_OFFSET = 908 // u32: margin_index referencing collateral MarginMarket

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const RATEX_INDEXED_PROGRAMS = [RATEX_PROGRAM_1, RATEX_PROGRAM_2] as const

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

function readPubkey(data: Uint8Array, offset: number): string {
  return new PublicKey(Buffer.from(data).subarray(offset, offset + 32)).toBase58()
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

function deriveUserPda(authority: PublicKey, subId: number, programId: string): string {
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

export const ratexIntegration: SolanaIntegration = {
  platformId: 'ratex',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const authority = new PublicKey(address)

    // Phase 0: fetch UserStats for both programs to learn sub-account counts
    const userStatsPdas = PROGRAMS.map((prog) => deriveUserStatsPda(authority, prog))
    const userStatsMap = yield userStatsPdas

    const subAccountCounts = PROGRAMS.map((_, i) => {
      const pda = userStatsPdas[i]
      const acc = pda !== undefined ? userStatsMap[pda] : undefined
      if (!acc?.exists || !checkDiscriminator(acc.data, USER_STATS_DISCRIMINATOR)) return 0
      if (acc.data.length < USER_STATS_NUM_CREATED_OFFSET + 2) return 0
      return readU16(acc.data, USER_STATS_NUM_CREATED_OFFSET)
    })

    // Phase 1: fetch all User PDAs (always try sub-account 0 even without UserStats)
    const userEntries: Array<{ pda: string; programIndex: number }> = []
    for (const [pi, progId] of PROGRAMS.entries()) {
      const count = Math.max(subAccountCounts[pi] ?? 0, 1)
      for (let si = 0; si < count; si++) {
        userEntries.push({ pda: deriveUserPda(authority, si, progId), programIndex: pi })
      }
    }

    const userAccounts = yield userEntries.map((e) => e.pda)

    // Parse User accounts to collect active margin and yield positions
    type MarginPos = { balance: bigint; marketIndex: number; decimals: number; programIndex: number }
    type YieldPos = { baseAmount: bigint; marketIndex: number; programIndex: number }

    const marginPositions: MarginPos[] = []
    const yieldPositions: YieldPos[] = []
    const yieldMarketsByProgram = new Map<number, Set<number>>() // programIndex -> Set<marketIndex>

    const minUserSize = USER_YIELD_POSITIONS_OFFSET + YIELD_POSITION_SIZE * MAX_YIELD_POSITIONS
    for (const { pda, programIndex } of userEntries) {
      const acc = userAccounts[pda]
      if (!acc?.exists || !checkDiscriminator(acc.data, USER_DISCRIMINATOR)) continue
      if (acc.data.length < minUserSize) continue

      for (let i = 0; i < MAX_MARGIN_POSITIONS; i++) {
        const base = USER_MARGIN_POSITIONS_OFFSET + i * MARGIN_POSITION_SIZE
        const balance = readI64(acc.data, base + MP_BALANCE)
        if (balance <= 0n) continue
        const marketIndex = readU32(acc.data, base + MP_MARKET_INDEX)
        const decimals = readU32(acc.data, base + MP_DECIMALS)
        marginPositions.push({ balance, marketIndex, decimals, programIndex })
      }

      for (let i = 0; i < MAX_YIELD_POSITIONS; i++) {
        const base = USER_YIELD_POSITIONS_OFFSET + i * YIELD_POSITION_SIZE
        const baseAmount = readI64(acc.data, base + YP_BASE_AMOUNT)
        if (baseAmount === 0n) continue
        const marketIndex = readU32(acc.data, base + YP_MARKET_INDEX)
        yieldPositions.push({ baseAmount, marketIndex, programIndex })
        let set = yieldMarketsByProgram.get(programIndex)
        if (!set) {
          set = new Set()
          yieldMarketsByProgram.set(programIndex, set)
        }
        set.add(marketIndex)
      }
    }

    if (marginPositions.length === 0 && yieldPositions.length === 0) return []

    // Phase 2: fetch MarginMarket accounts (fixed small set) and YieldMarket accounts
    const phase2Pdas = new Map<string, string>() // key -> address

    for (const [pi, progId] of PROGRAMS.entries()) {
      for (const idx of PREFETCH_MARGIN_INDICES) {
        phase2Pdas.set(`m:${pi}:${idx}`, deriveMarginMarketPda(idx, progId))
      }
    }
    for (const [pi, indices] of yieldMarketsByProgram) {
      const progId = PROGRAMS[pi as 0 | 1]
      for (const idx of indices) {
        phase2Pdas.set(`y:${pi}:${idx}`, deriveYieldMarketPda(idx, progId))
      }
    }

    const phase2Map = yield [...new Set(phase2Pdas.values())]

    // Build margin market info lookup
    const marginMarketInfo = new Map<string, { mint: string; decimals: number }>()
    for (let pi = 0; pi < PROGRAMS.length; pi++) {
      for (const idx of PREFETCH_MARGIN_INDICES) {
        const addr = phase2Pdas.get(`m:${pi}:${idx}`)
        if (!addr) continue
        const acc = phase2Map[addr]
        if (!acc?.exists || acc.data.length < MARGIN_MARKET_DECIMALS_OFFSET + 4) continue
        const mint = readPubkey(acc.data, MARGIN_MARKET_MINT_OFFSET)
        const decimals = readU32(acc.data, MARGIN_MARKET_DECIMALS_OFFSET)
        marginMarketInfo.set(`${pi}:${idx}`, { mint, decimals })
      }
    }

    // Build yield market info lookup
    type YieldMarketInfo = { name: string; expireTs: bigint; marginIndex: number }
    const yieldMarketInfo = new Map<string, YieldMarketInfo>()
    for (const [pi, indices] of yieldMarketsByProgram) {
      for (const idx of indices) {
        const addr = phase2Pdas.get(`y:${pi}:${idx}`)
        if (!addr) continue
        const acc = phase2Map[addr]
        if (!acc?.exists || acc.data.length < YIELD_MARKET_MARGIN_OFFSET + 4) continue
        const name = readName(acc.data, YIELD_MARKET_NAME_OFFSET)
        const expireTs = readI64(acc.data, YIELD_MARKET_EXPIRE_OFFSET)
        const marginIndex = readU32(acc.data, YIELD_MARKET_MARGIN_OFFSET)
        yieldMarketInfo.set(`${pi}:${idx}`, { name, expireTs, marginIndex })
      }
    }

    const result: UserDefiPosition[] = []

    // Margin positions — deposited collateral backing yield trades
    for (const { balance, marketIndex, decimals, programIndex } of marginPositions) {
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
            amount: { token: info.mint, amount: balance.toString(), decimals: decimals.toString() },
            ...(token?.priceUsd !== undefined && { priceUsd: token.priceUsd.toString() }),
            ...(usdValue !== undefined && { usdValue }),
          },
        ],
        ...(usdValue !== undefined && { usdValue }),
      }
      result.push(position)
    }

    // Yield positions — leveraged yield token (YT) trading exposure
    for (const { baseAmount, marketIndex, programIndex } of yieldPositions) {
      const yInfo = yieldMarketInfo.get(`${programIndex}:${marketIndex}`)
      const mInfo = yInfo ? marginMarketInfo.get(`${programIndex}:${yInfo.marginIndex}`) : undefined

      const token = mInfo ? tokens.get(mInfo.mint) : undefined
      const absAmount = baseAmount < 0n ? -baseAmount : baseAmount
      const usdValue =
        token?.priceUsd !== undefined && mInfo !== undefined
          ? ((Number(absAmount) / 10 ** mInfo.decimals) * token.priceUsd).toString()
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
              ...(token?.priceUsd !== undefined && { priceUsd: token.priceUsd.toString() }),
              ...(usdValue !== undefined && { usdValue }),
            },
          ],
        }),
        ...(usdValue !== undefined && { usdValue }),
        meta: {
          yieldPosition: {
            direction: baseAmount > 0n ? 'long' : 'short',
            marketName: yInfo?.name ?? `market-${marketIndex}`,
            ...(yInfo?.expireTs !== undefined && { expiresAt: yInfo.expireTs.toString() }),
          },
        },
      }
      result.push(position)
    }

    return result
  },
}

export default ratexIntegration
