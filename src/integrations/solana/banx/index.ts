import { BorshCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type {
  LendingBorrowedAsset,
  LendingDefiPosition,
  LendingSuppliedAsset,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import bondsIdl from './idls/bonds.json'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

const BONDS_PROGRAM_ID = '4tdmkuY6EStxbS6Y8s5ueznL3VPMSugrvQuDeAHGZhSt'
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BANX_SOL_MINT = 'BANXyWgPpa519e2MtQF1ecRbKYKKDMXPF1dyBxUq9NQG'

const BOND_TRADE_TRANSACTION_DISCRIMINATOR_B58 = 'b6hwxHZor7i'
const BOND_OFFER_DISCRIMINATOR_B58 = 'A6YWkLyWjLB'
const USER_VAULT_DISCRIMINATOR_B58 = '4u2LxSnUbZf'

const BTT_USER_OFFSET = 41
const BTT_SELLER_OFFSET = 147
const BOND_OFFER_ASSET_RECEIVER_OFFSET = 130
const USER_VAULT_USER_OFFSET = 9

const ACTIVE_LOAN_STATES = new Set([
  'perpetualActive',
  'perpetualManualTerminating',
  'perpetualPartialRepaid',
  'perpetualRefinancedActive',
  'perpetualBorrowerListing',
  'perpetualLenderListing',
  'perpetualSellingLoan',
  'perpetualSellingListing',
  'perpetualAutoTerminating',
])

const OPEN_OFFER_STATES = new Set([
  'perpetualOnMarket',
  'perpetualBondingCurveOnMarket',
  'perpetualListing',
])

export const PROGRAM_IDS = [BONDS_PROGRAM_ID] as const

const bondsCoder = new BorshCoder(bondsIdl as never)

type LendingTokenType = 'nativeSol' | 'usdc' | 'banxSol'

interface BondTradeTransactionV3Raw {
  bondTradeTransactionState: unknown
  bondOffer: unknown
  user: unknown
  seller: unknown
  fbondTokenMint: unknown
  lendingToken: unknown
  currentRemainingLent: unknown
  lenderOriginalLent: unknown
  borrowerOriginalLent: unknown
  soldAt: unknown
  redeemedAt: unknown
}

interface BondOfferV3Raw {
  pairState: unknown
  assetReceiver: unknown
  fundsSolOrTokenBalance: unknown
  buyOrdersQuantity: unknown
  bondingCurve: {
    bondingType: unknown
  }
}

interface FraktBondRaw {
  fraktBondState: unknown
  fbondIssuer: unknown
}

interface UserVaultRaw {
  userVaultState: unknown
  user: unknown
  lendingTokenType: unknown
  offerLiquidityAmount: unknown
  liquidityInLoansAmount: unknown
  repaymentsAmount: unknown
  interestRewardsAmount: unknown
}

interface ActiveLoan {
  address: string
  state: string
  user: string
  seller: string
  bondOffer: string
  fraktBond: string
  lendingTokenType: LendingTokenType
  currentRemainingLent: bigint
  lenderOriginalLent: bigint
  borrowerOriginalLent: bigint
  soldAt: bigint
  redeemedAt: bigint
}

interface OfferPositionSource {
  address: string
  pairState: string
  assetReceiver: string
  lendingTokenType: LendingTokenType
  fundsBalance: bigint
  buyOrdersQuantity: bigint
}

interface UserVaultPositionSource {
  address: string
  state: string
  user: string
  lendingTokenType: LendingTokenType
  offerLiquidityAmount: bigint
  liquidityInLoansAmount: bigint
  repaymentsAmount: bigint
  interestRewardsAmount: bigint
}

function decodeAccount<T>(name: string, data: Uint8Array): T | null {
  try {
    return bondsCoder.accounts.decode(name, Buffer.from(data)) as T
  } catch {
    return null
  }
}

function enumName(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value as Record<string, unknown>)
  return keys.length === 1 ? (keys[0] ?? null) : null
}

function toAddress(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value instanceof PublicKey) return value.toBase58()
  if (
    value &&
    typeof value === 'object' &&
    'toBase58' in value &&
    typeof (value as { toBase58?: unknown }).toBase58 === 'function'
  ) {
    return (value as { toBase58: () => string }).toBase58()
  }
  return null
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.length > 0) return BigInt(value)
  if (
    value &&
    typeof value === 'object' &&
    'toString' in value &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    return BigInt((value as { toString: () => string }).toString())
  }
  return 0n
}

function toLendingTokenType(value: unknown): LendingTokenType | null {
  const name = enumName(value)
  if (name === 'nativeSol' || name === 'usdc' || name === 'banxSol') return name
  return null
}

function bondingCurveTypeToLendingTokenType(
  value: unknown,
): LendingTokenType | null {
  const name = enumName(value)
  if (name === 'linear' || name === 'exponential') return 'nativeSol'
  if (name === 'linearUsdc' || name === 'exponentialUsdc') return 'usdc'
  if (name === 'linearBanxSol' || name === 'exponentialBanxSol')
    return 'banxSol'
  return null
}

function lendingTokenTypeToMint(lendingTokenType: LendingTokenType): string {
  if (lendingTokenType === 'usdc') return USDC_MINT
  if (lendingTokenType === 'banxSol') return BANX_SOL_MINT
  return WRAPPED_SOL_MINT
}

function lendingTokenTypeToDecimals(lendingTokenType: LendingTokenType): number {
  if (lendingTokenType === 'usdc') return 6
  return 9
}

function buildUsdValue(
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): string | undefined {
  if (priceUsd === undefined) return undefined
  if (amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
}

function buildSuppliedAsset(
  lendingTokenType: LendingTokenType,
  amountRaw: bigint,
  tokens: SolanaPlugins['tokens'],
): LendingSuppliedAsset | null {
  if (amountRaw <= 0n) return null
  const tokenMint = lendingTokenTypeToMint(lendingTokenType)
  const token = tokens.get(tokenMint)
  const decimals = token?.decimals ?? lendingTokenTypeToDecimals(lendingTokenType)
  const usdValue = buildUsdValue(amountRaw, decimals, token?.priceUsd)

  return {
    amount: {
      token: tokenMint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(token?.priceUsd !== undefined && { priceUsd: token.priceUsd.toString() }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function buildBorrowedAsset(
  lendingTokenType: LendingTokenType,
  amountRaw: bigint,
  tokens: SolanaPlugins['tokens'],
): LendingBorrowedAsset | null {
  if (amountRaw <= 0n) return null
  const tokenMint = lendingTokenTypeToMint(lendingTokenType)
  const token = tokens.get(tokenMint)
  const decimals = token?.decimals ?? lendingTokenTypeToDecimals(lendingTokenType)
  const usdValue = buildUsdValue(amountRaw, decimals, token?.priceUsd)

  return {
    amount: {
      token: tokenMint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(token?.priceUsd !== undefined && { priceUsd: token.priceUsd.toString() }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function isLoanStateActive(state: string): boolean {
  return ACTIVE_LOAN_STATES.has(state)
}

function isOfferStateOpen(state: string): boolean {
  return OPEN_OFFER_STATES.has(state)
}

function sumPositionUsdValue(
  supplied: LendingSuppliedAsset[] | undefined,
  borrowed: LendingBorrowedAsset[] | undefined,
): string | undefined {
  const values = [...(supplied ?? []), ...(borrowed ?? [])]
    .map((entry) => entry.usdValue)
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0).toString()
}

export const banxIntegration: SolanaIntegration = {
  platformId: 'banx',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const lenderLoanMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: BONDS_PROGRAM_ID,
      filters: [
        { memcmp: { offset: 0, bytes: BOND_TRADE_TRANSACTION_DISCRIMINATOR_B58 } },
        { memcmp: { offset: BTT_USER_OFFSET, bytes: address } },
      ],
    }

    const borrowerLoanMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: BONDS_PROGRAM_ID,
      filters: [
        { memcmp: { offset: 0, bytes: BOND_TRADE_TRANSACTION_DISCRIMINATOR_B58 } },
        { memcmp: { offset: BTT_SELLER_OFFSET, bytes: address } },
      ],
    }

    const offersMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: BONDS_PROGRAM_ID,
      filters: [
        { memcmp: { offset: 0, bytes: BOND_OFFER_DISCRIMINATOR_B58 } },
        { memcmp: { offset: BOND_OFFER_ASSET_RECEIVER_OFFSET, bytes: address } },
      ],
    }

    const userVaultsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: BONDS_PROGRAM_ID,
      filters: [
        { memcmp: { offset: 0, bytes: USER_VAULT_DISCRIMINATOR_B58 } },
        { memcmp: { offset: USER_VAULT_USER_OFFSET, bytes: address } },
      ],
    }

    const activeLoans = new Map<string, ActiveLoan>()
    for (const account of [
      ...Object.values(lenderLoanMap),
      ...Object.values(borrowerLoanMap),
    ]) {
      if (!account.exists || activeLoans.has(account.address)) continue
      const decoded = decodeAccount<BondTradeTransactionV3Raw>(
        'bondTradeTransactionV3',
        account.data,
      )
      if (!decoded) continue

      const state = enumName(decoded.bondTradeTransactionState)
      const user = toAddress(decoded.user)
      const seller = toAddress(decoded.seller)
      const bondOffer = toAddress(decoded.bondOffer)
      const fraktBond = toAddress(decoded.fbondTokenMint)
      const lendingTokenType = toLendingTokenType(decoded.lendingToken)

      if (!state || !isLoanStateActive(state)) continue
      if (!user || !seller || !bondOffer || !fraktBond || !lendingTokenType) continue
      if (user !== address && seller !== address) continue

      activeLoans.set(account.address, {
        address: account.address,
        state,
        user,
        seller,
        bondOffer,
        fraktBond,
        lendingTokenType,
        currentRemainingLent: toBigInt(decoded.currentRemainingLent),
        lenderOriginalLent: toBigInt(decoded.lenderOriginalLent),
        borrowerOriginalLent: toBigInt(decoded.borrowerOriginalLent),
        soldAt: toBigInt(decoded.soldAt),
        redeemedAt: toBigInt(decoded.redeemedAt),
      })
    }

    const relatedAddresses = [
      ...new Set(
        [...activeLoans.values()].flatMap((loan) => [loan.bondOffer, loan.fraktBond]),
      ),
    ]
    const relatedAccounts =
      relatedAddresses.length > 0 ? yield relatedAddresses : {}

    const relatedOffers = new Map<string, OfferPositionSource>()
    const relatedFraktBonds = new Map<string, { state: string; issuer: string }>()

    for (const account of Object.values(relatedAccounts)) {
      if (!account.exists) continue

      const offerDecoded = decodeAccount<BondOfferV3Raw>('bondOfferV3', account.data)
      if (offerDecoded) {
        const pairState = enumName(offerDecoded.pairState)
        const assetReceiver = toAddress(offerDecoded.assetReceiver)
        const lendingTokenType = bondingCurveTypeToLendingTokenType(
          offerDecoded.bondingCurve?.bondingType,
        )
        if (pairState && assetReceiver && lendingTokenType) {
          relatedOffers.set(account.address, {
            address: account.address,
            pairState,
            assetReceiver,
            lendingTokenType,
            fundsBalance: toBigInt(offerDecoded.fundsSolOrTokenBalance),
            buyOrdersQuantity: toBigInt(offerDecoded.buyOrdersQuantity),
          })
        }
      }

      const fraktDecoded = decodeAccount<FraktBondRaw>('fraktBond', account.data)
      if (fraktDecoded) {
        const state = enumName(fraktDecoded.fraktBondState)
        const issuer = toAddress(fraktDecoded.fbondIssuer)
        if (state && issuer) {
          relatedFraktBonds.set(account.address, { state, issuer })
        }
      }
    }

    const ownerOffers: OfferPositionSource[] = []
    for (const account of Object.values(offersMap)) {
      if (!account.exists) continue
      const decoded = decodeAccount<BondOfferV3Raw>('bondOfferV3', account.data)
      if (!decoded) continue

      const pairState = enumName(decoded.pairState)
      const assetReceiver = toAddress(decoded.assetReceiver)
      const lendingTokenType = bondingCurveTypeToLendingTokenType(
        decoded.bondingCurve?.bondingType,
      )
      if (!pairState || !assetReceiver || !lendingTokenType) continue
      if (assetReceiver !== address) continue

      ownerOffers.push({
        address: account.address,
        pairState,
        assetReceiver,
        lendingTokenType,
        fundsBalance: toBigInt(decoded.fundsSolOrTokenBalance),
        buyOrdersQuantity: toBigInt(decoded.buyOrdersQuantity),
      })
    }

    const userVaults = new Map<LendingTokenType, UserVaultPositionSource>()
    for (const account of Object.values(userVaultsMap)) {
      if (!account.exists) continue
      const decoded = decodeAccount<UserVaultRaw>('userVault', account.data)
      if (!decoded) continue
      const state = enumName(decoded.userVaultState)
      const user = toAddress(decoded.user)
      const lendingTokenType = toLendingTokenType(decoded.lendingTokenType)
      if (!state || !user || !lendingTokenType) continue
      if (user !== address) continue

      userVaults.set(lendingTokenType, {
        address: account.address,
        state,
        user,
        lendingTokenType,
        offerLiquidityAmount: toBigInt(decoded.offerLiquidityAmount),
        liquidityInLoansAmount: toBigInt(decoded.liquidityInLoansAmount),
        repaymentsAmount: toBigInt(decoded.repaymentsAmount),
        interestRewardsAmount: toBigInt(decoded.interestRewardsAmount),
      })
    }

    const positions: UserDefiPosition[] = []
    const seenPositionKeys = new Set<string>()

    for (const loan of activeLoans.values()) {
      const fraktBond = relatedFraktBonds.get(loan.fraktBond)
      const bondOffer = relatedOffers.get(loan.bondOffer)
      const vault = userVaults.get(loan.lendingTokenType)

      if (loan.user === address) {
        const key = `loan:${loan.address}:lender`
        if (!seenPositionKeys.has(key)) {
          const amount = loan.currentRemainingLent || loan.lenderOriginalLent
          const supplied = buildSuppliedAsset(loan.lendingTokenType, amount, tokens)
          if (supplied) {
            const position: LendingDefiPosition = {
              platformId: 'banx',
              positionKind: 'lending',
              supplied: [supplied],
              meta: {
                banx: {
                  role: 'lender',
                  state: loan.state,
                  loan: loan.address,
                  bondOffer: loan.bondOffer,
                  fraktBond: loan.fraktBond,
                  soldAt: loan.soldAt.toString(),
                  redeemedAt: loan.redeemedAt.toString(),
                  ...(bondOffer && {
                    offerState: bondOffer.pairState,
                  }),
                  ...(fraktBond && {
                    fraktBondState: fraktBond.state,
                    borrower: fraktBond.issuer,
                  }),
                  ...(vault && {
                    vault: vault.address,
                    vaultState: vault.state,
                    vaultOfferLiquidityAmount: vault.offerLiquidityAmount.toString(),
                    vaultLiquidityInLoansAmount: vault.liquidityInLoansAmount.toString(),
                  }),
                },
              },
            }
            const usdValue = sumPositionUsdValue(position.supplied, position.borrowed)
            if (usdValue !== undefined) position.usdValue = usdValue
            positions.push(position)
            seenPositionKeys.add(key)
          }
        }
      }

      if (loan.seller === address) {
        const key = `loan:${loan.address}:borrower`
        if (!seenPositionKeys.has(key)) {
          const amount = loan.currentRemainingLent || loan.borrowerOriginalLent
          const borrowed = buildBorrowedAsset(loan.lendingTokenType, amount, tokens)
          if (borrowed) {
            const position: LendingDefiPosition = {
              platformId: 'banx',
              positionKind: 'lending',
              borrowed: [borrowed],
              meta: {
                banx: {
                  role: 'borrower',
                  state: loan.state,
                  loan: loan.address,
                  bondOffer: loan.bondOffer,
                  fraktBond: loan.fraktBond,
                  soldAt: loan.soldAt.toString(),
                  redeemedAt: loan.redeemedAt.toString(),
                  ...(bondOffer && {
                    offerState: bondOffer.pairState,
                    lender: bondOffer.assetReceiver,
                  }),
                  ...(fraktBond && {
                    fraktBondState: fraktBond.state,
                    borrower: fraktBond.issuer,
                  }),
                },
              },
            }
            const usdValue = sumPositionUsdValue(position.supplied, position.borrowed)
            if (usdValue !== undefined) position.usdValue = usdValue
            positions.push(position)
            seenPositionKeys.add(key)
          }
        }
      }
    }

    for (const offer of ownerOffers) {
      if (!isOfferStateOpen(offer.pairState)) continue
      if (offer.fundsBalance <= 0n && offer.buyOrdersQuantity <= 0n) continue

      const key = `offer:${offer.address}`
      if (seenPositionKeys.has(key)) continue

      const supplied = buildSuppliedAsset(
        offer.lendingTokenType,
        offer.fundsBalance,
        tokens,
      )
      if (!supplied) continue

      const vault = userVaults.get(offer.lendingTokenType)
      const position: LendingDefiPosition = {
        platformId: 'banx',
        positionKind: 'lending',
        supplied: [supplied],
        meta: {
          banx: {
            role: 'offer',
            offer: offer.address,
            state: offer.pairState,
            buyOrdersQuantity: offer.buyOrdersQuantity.toString(),
            ...(vault && {
              vault: vault.address,
              vaultState: vault.state,
              vaultOfferLiquidityAmount: vault.offerLiquidityAmount.toString(),
              vaultLiquidityInLoansAmount: vault.liquidityInLoansAmount.toString(),
            }),
          },
        },
      }

      const usdValue = sumPositionUsdValue(position.supplied, position.borrowed)
      if (usdValue !== undefined) position.usdValue = usdValue
      positions.push(position)
      seenPositionKeys.add(key)
    }

    return positions
  },
}

export default banxIntegration
