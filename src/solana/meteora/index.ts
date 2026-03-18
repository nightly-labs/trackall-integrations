import {
  ClockLayout,
  LBCLMM_PROGRAM_IDS,
  createProgram,
  decodeAccount,
  getPriceOfBinByBinId,
  positionOwnerFilter,
  positionV2Filter,
  wrapPosition,
} from '@meteora-ag/dlmm'

const BIN_ARRAY_SIZE = 70 // SDK MAX_BIN_ARRAY_SIZE constant
import { unpackMint } from '@solana/spl-token'
import type { AccountInfo } from '@solana/web3.js'
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js'
import BN from 'bn.js'

import type {
  ConcentratedRangeLiquidityDefiPosition,
  SolanaAccount,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../types/index'

export const meteoraIntegration: SolanaIntegration = {
  platform: {
    id: 'meteora',
    network: 'solana',
    name: 'Meteora',
    image: 'https://meteora.ag/logo.png',
    description: 'Meteora DLMM liquidity pools on Solana',
    tags: [],
    defiLlamaId: 'meteora',
  },

  getUserPositions: async function* (address: string, { endpoint, tokens }: SolanaPlugins): UserPositionsPlan {
    const programId = new PublicKey(LBCLMM_PROGRAM_IDS['mainnet-beta'])
    const connection = new Connection(endpoint)
    const program = createProgram(connection)
    const walletPubkey = new PublicKey(address)

    // Phase 0: discover positions via getProgramAccounts (through runner)
    const phase0Map = yield {
      kind: 'getProgramAccounts' as const,
      programId: LBCLMM_PROGRAM_IDS['mainnet-beta'],
      filters: [positionV2Filter(), positionOwnerFilter(walletPubkey)],
    }

    const rawPositions = Object.values(phase0Map)
      .filter((acc): acc is SolanaAccount => acc.exists)
      .map((acc) => ({
        pubkey: new PublicKey(acc.address),
        account: {
          data: Buffer.from(acc.data),
          owner: new PublicKey(acc.programAddress),
          lamports: Number(acc.lamports),
          executable: false,
          rentEpoch: 0,
        } as AccountInfo<Buffer>,
      }))

    if (rawPositions.length === 0) return []

    const positions = rawPositions.map((p) => wrapPosition(program, p.pubkey, p.account))

    // Collect unique lb pair keys and all bin array keys; cache coverage keys per position
    const lbPairKeySet = new Set<string>()
    const binArrayKeySet = new Set<string>()
    const positionCoverageKeys = new Map<(typeof positions)[number], string[]>()
    for (const pos of positions) {
      lbPairKeySet.add(pos.lbPair().toBase58())
      const keys = pos.getBinArrayKeysCoverage(programId).map((k) => k.toBase58())
      positionCoverageKeys.set(pos, keys)
      for (const key of keys) binArrayKeySet.add(key)
    }

    const lbPairKeys = [...lbPairKeySet]
    const binArrayKeys = [...binArrayKeySet]

    // Round 1: fetch lb pairs + bin arrays + clock
    const round1 = yield [
      ...lbPairKeys,
      ...binArrayKeys,
      SYSVAR_CLOCK_PUBKEY.toBase58(),
    ]

    const lbPairMap = new Map<string, any>()
    for (const key of lbPairKeys) {
      const acc = round1[key]
      if (acc?.exists) lbPairMap.set(key, decodeAccount(program, 'lbPair', Buffer.from(acc.data)))
    }

    const binArrayMap = new Map<string, any>()
    for (const key of binArrayKeys) {
      const acc = round1[key]
      if (acc?.exists) binArrayMap.set(key, decodeAccount(program, 'binArray', Buffer.from(acc.data)))
    }

    const clockAcc = round1[SYSVAR_CLOCK_PUBKEY.toBase58()]
    const clock = clockAcc?.exists ? ClockLayout.decode(Buffer.from(clockAcc.data)) : null

    // Collect mint addresses from lb pair data
    const mintKeySet = new Set<string>()
    for (const lbPair of lbPairMap.values()) {
      mintKeySet.add((lbPair as any).tokenXMint.toBase58())
      mintKeySet.add((lbPair as any).tokenYMint.toBase58())
    }

    const mintKeys = [...mintKeySet]

    // Round 2: fetch mints only
    const round2 = yield mintKeys

    const mintMap = new Map<string, ReturnType<typeof unpackMint>>()
    for (const key of mintKeys) {
      const acc = round2[key]
      if (acc && acc.exists) {
        mintMap.set(
          key,
          unpackMint(
            new PublicKey(key),
            { data: Buffer.from(acc.data), owner: new PublicKey(acc.programAddress), lamports: Number(acc.lamports) } as any,
            new PublicKey(acc.programAddress),
          ),
        )
      }
    }

    // Build positions
    const result: UserDefiPosition[] = []

    for (const pos of positions) {
      const lbPairKey = pos.lbPair().toBase58()
      const lbPair = lbPairMap.get(lbPairKey) as any
      if (!lbPair || !clock) continue

      const mintX = mintMap.get(lbPair.tokenXMint.toBase58())
      const mintY = mintMap.get(lbPair.tokenYMint.toBase58())
      if (!mintX || !mintY) continue

      const lowerBinId = pos.lowerBinId().toNumber()
      const upperBinId = pos.upperBinId().toNumber()
      const activeBinId: number = lbPair.activeId

      const decimalAdjust = 10 ** (mintX.decimals - mintY.decimals)
      const lowerPrice = getPriceOfBinByBinId(lowerBinId, lbPair.binStep).mul(decimalAdjust).toString()
      const upperPrice = getPriceOfBinByBinId(upperBinId, lbPair.binStep).mul(decimalAdjust).toString()
      const currentPrice = getPriceOfBinByBinId(activeBinId, lbPair.binStep).mul(decimalAdjust).toString()

      let totalXAmount = new BN(0)
      let totalYAmount = new BN(0)
      const liquidityShares = pos.liquidityShares()

      // Pre-build binArrayIndex→data map from cached coverage keys to avoid per-bin PDA derivation
      const coverageKeys = positionCoverageKeys.get(pos)!
      const startArrayIndex = Math.floor(lowerBinId / BIN_ARRAY_SIZE)
      const posArrays = new Map<number, any>()
      coverageKeys.forEach((key, i) => {
        const data = binArrayMap.get(key)
        if (data) posArrays.set(startArrayIndex + i, data)
      })

      for (let i = 0; i < liquidityShares.length; i++) {
        const binId = lowerBinId + i
        const binArrayIndex = Math.floor(binId / BIN_ARRAY_SIZE)
        const binArray = posArrays.get(binArrayIndex)
        if (!binArray) continue

        const binIndexInArray = binId % BIN_ARRAY_SIZE

        const bin = binArray.bins[binIndexInArray]
        if (!bin || bin.liquiditySupply.isZero()) continue

        const posShare = liquidityShares[i]
        if (!posShare) continue
        totalXAmount = totalXAmount.add(posShare.mul(bin.amountX).div(bin.liquiditySupply))
        totalYAmount = totalYAmount.add(posShare.mul(bin.amountY).div(bin.liquiditySupply))
      }

      const mintXKey = lbPair.tokenXMint.toBase58()
      const mintYKey = lbPair.tokenYMint.toBase58()
      const tokenX = tokens.get(mintXKey)
      const tokenY = tokens.get(mintYKey)

      const usdValueX =
        tokenX?.priceUsd !== undefined
          ? (Number(totalXAmount) / 10 ** mintX.decimals) * tokenX.priceUsd
          : undefined
      const usdValueY =
        tokenY?.priceUsd !== undefined
          ? (Number(totalYAmount) / 10 ** mintY.decimals) * tokenY.priceUsd
          : undefined

      const valueUsd =
        usdValueX !== undefined && usdValueY !== undefined
          ? (usdValueX + usdValueY).toString()
          : usdValueX !== undefined
            ? usdValueX.toString()
            : usdValueY !== undefined
              ? usdValueY.toString()
              : undefined

      result.push({
        positionKind: 'liquidity',
        liquidityModel: 'concentrated-range',
        platformId: 'meteora',
        isActive: lowerBinId <= activeBinId && activeBinId <= upperBinId,
        lowerPriceUsd: lowerPrice,
        upperPriceUsd: upperPrice,
        currentPriceUsd: currentPrice,
        ...(valueUsd !== undefined && { valueUsd }),
        poolTokens: [
          {
            amount: { token: mintXKey, amount: totalXAmount.toString(), decimals: mintX.decimals.toString() },
            ...(tokenX?.priceUsd !== undefined && { priceUsd: tokenX.priceUsd.toString() }),
            ...(usdValueX !== undefined && { usdValue: usdValueX.toString() }),
          },
          {
            amount: { token: mintYKey, amount: totalYAmount.toString(), decimals: mintY.decimals.toString() },
            ...(tokenY?.priceUsd !== undefined && { priceUsd: tokenY.priceUsd.toString() }),
            ...(usdValueY !== undefined && { usdValue: usdValueY.toString() }),
          },
        ],
        poolAddress: lbPairKey,
      } satisfies ConcentratedRangeLiquidityDefiPosition)
    }

    return result
  },
}

export default meteoraIntegration
