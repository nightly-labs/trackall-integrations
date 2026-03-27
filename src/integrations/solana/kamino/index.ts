import { FarmState, UserState } from '@kamino-finance/farms-sdk'
import { Obligation, Reserve, VaultState } from '@kamino-finance/klend-sdk'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
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

export const testAddress = '93PSyNrS7zBhrXaHHfU1ZtfegcKq5SaCYc35ZwPVrK3K'

const KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'
const KVAULT_PROGRAM_ID = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd'
const FARMS_PROGRAM_ID = 'FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr'

export const PROGRAM_IDS = [
  KLEND_PROGRAM_ID,
  KVAULT_PROGRAM_ID,
  FARMS_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

const DEFAULT_PUBKEY = '11111111111111111111111111111111'
const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64
const KVAULT_SHARES_MINT_OFFSET = 184
const SF_DENOMINATOR = 1n << 60n
const FARMS_WAD = 10n ** 18n
const KLEND_RESERVES_TTL_MS = 5 * 60 * 1000

interface KlendDeposit {
  depositReserve: string
  depositedAmount: bigint
  marketValueSf: bigint
}

interface KlendBorrow {
  borrowReserve: string
  borrowedAmountSf: bigint
  marketValueSf: bigint
}

interface KlendObligationDecoded {
  owner: string
  deposits: KlendDeposit[]
  borrows: KlendBorrow[]
  depositedValueSf: bigint
  borrowedAssetsMarketValueSf: bigint
  allowedBorrowValueSf: bigint
  borrowFactorAdjustedDebtValueSf: bigint
}

interface KlendReserveDecoded {
  liquidityMint: string
  liquidityDecimals: number
  collateralMint: string
  liquidityAvailableAmount: bigint
  liquidityBorrowedAmountSf: bigint
  accumulatedProtocolFeesSf: bigint
  accumulatedReferrerFeesSf: bigint
  pendingReferrerFeesSf: bigint
  collateralMintTotalSupply: bigint
}

interface FarmsUserStateAggregate {
  activeStakeScaled: bigint
  pendingWithdrawalUnstakeScaled: bigint
  rewardsIssuedUnclaimed: bigint[]
}

interface PublicKeyLike {
  toString(): string
}

interface KlendObligationWire {
  owner: PublicKeyLike
  deposits: Array<{
    depositReserve: string
    depositedAmount: unknown
    marketValueSf: unknown
  }>
  borrows: Array<{
    borrowReserve: string
    borrowedAmountSf: unknown
    marketValueSf: unknown
  }>
  depositedValueSf: unknown
  borrowedAssetsMarketValueSf: unknown
  allowedBorrowValueSf: unknown
  borrowFactorAdjustedDebtValueSf: unknown
}

interface KlendReserveWire {
  liquidity: {
    mintPubkey: string
    mintDecimals: unknown
    availableAmount: unknown
    borrowedAmountSf: unknown
    accumulatedProtocolFeesSf: unknown
    accumulatedReferrerFeesSf: unknown
    pendingReferrerFeesSf: unknown
  }
  collateral: {
    mintPubkey: string
    mintTotalSupply: unknown
  }
}

interface KVaultStateWire {
  sharesMint: string
  sharesMintDecimals: unknown
}

interface FarmsUserStateWire {
  farmState: PublicKeyLike
  activeStakeScaled: unknown
  pendingWithdrawalUnstakeScaled: unknown
  rewardsIssuedUnclaimed: unknown[]
}

interface FarmStateWire {
  token: {
    mint: PublicKeyLike
    decimals: unknown
  }
  rewardInfos: Array<{
    token: {
      mint: PublicKeyLike
      decimals: unknown
    }
  }>
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return BigInt(String(value))
  }
  return 0n
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return Number(String(value))
  }
  return 0
}

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset)
}

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58()
}

function readTokenAccountMint(data: Uint8Array): string | null {
  const buf = Buffer.from(data)
  if (buf.length < TOKEN_ACCOUNT_MINT_OFFSET + 32) return null
  return readPubkey(buf, TOKEN_ACCOUNT_MINT_OFFSET)
}

function readTokenAccountAmount(data: Uint8Array): bigint | null {
  const buf = Buffer.from(data)
  if (buf.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return null
  return readU64LE(buf, TOKEN_ACCOUNT_AMOUNT_OFFSET)
}

function sfToLamports(valueSf: bigint): bigint {
  return valueSf / SF_DENOMINATOR
}

function divideToDecimalString(
  numerator: bigint,
  denominator: bigint,
  digits = 6,
): string {
  if (denominator === 0n) return '0'
  const negative = numerator < 0n !== denominator < 0n
  const absNum = numerator < 0n ? -numerator : numerator
  const absDen = denominator < 0n ? -denominator : denominator

  const integerPart = absNum / absDen
  const remainder = absNum % absDen
  if (digits <= 0 || remainder === 0n) {
    return `${negative ? '-' : ''}${integerPart}`
  }

  const scale = 10n ** BigInt(digits)
  const frac = (remainder * scale) / absDen
  const fracTrimmed = frac.toString().replace(/0+$/, '')
  if (fracTrimmed.length === 0) {
    return `${negative ? '-' : ''}${integerPart}`
  }

  return `${negative ? '-' : ''}${integerPart}.${fracTrimmed}`
}

function sfToDecimalString(valueSf: bigint, digits = 6): string {
  return divideToDecimalString(valueSf, SF_DENOMINATOR, digits)
}

function scaledWadsToRawAmount(value: bigint): bigint {
  return value / FARMS_WAD
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

function sumUsdValues(values: Array<string | undefined>): string | undefined {
  const present = values.filter((value) => value !== undefined)
  if (present.length === 0) return undefined

  const total = present.reduce((sum, value) => sum + Number(value), 0)
  if (!Number.isFinite(total)) return undefined
  return total.toString()
}

function decodeKlendObligation(
  accountData: Uint8Array,
): KlendObligationDecoded {
  const decoded = Obligation.decode(
    Buffer.from(accountData),
  ) as KlendObligationWire

  const deposits: KlendDeposit[] = decoded.deposits
    .map((d) => ({
      depositReserve: d.depositReserve,
      depositedAmount: toBigInt(d.depositedAmount),
      marketValueSf: toBigInt(d.marketValueSf),
    }))
    .filter(
      (d) => d.depositReserve !== DEFAULT_PUBKEY && d.depositedAmount > 0n,
    )

  const borrows: KlendBorrow[] = decoded.borrows
    .map((b) => ({
      borrowReserve: b.borrowReserve,
      borrowedAmountSf: toBigInt(b.borrowedAmountSf),
      marketValueSf: toBigInt(b.marketValueSf),
    }))
    .filter(
      (b) => b.borrowReserve !== DEFAULT_PUBKEY && b.borrowedAmountSf > 0n,
    )

  return {
    owner: decoded.owner.toString(),
    deposits,
    borrows,
    depositedValueSf: toBigInt(decoded.depositedValueSf),
    borrowedAssetsMarketValueSf: toBigInt(decoded.borrowedAssetsMarketValueSf),
    allowedBorrowValueSf: toBigInt(decoded.allowedBorrowValueSf),
    borrowFactorAdjustedDebtValueSf: toBigInt(
      decoded.borrowFactorAdjustedDebtValueSf,
    ),
  }
}

function decodeKlendReserve(accountData: Uint8Array): KlendReserveDecoded {
  const decoded = Reserve.decode(Buffer.from(accountData)) as KlendReserveWire

  return {
    liquidityMint: decoded.liquidity.mintPubkey,
    liquidityDecimals: toNumber(decoded.liquidity.mintDecimals),
    collateralMint: decoded.collateral.mintPubkey,
    liquidityAvailableAmount: toBigInt(decoded.liquidity.availableAmount),
    liquidityBorrowedAmountSf: toBigInt(decoded.liquidity.borrowedAmountSf),
    accumulatedProtocolFeesSf: toBigInt(
      decoded.liquidity.accumulatedProtocolFeesSf,
    ),
    accumulatedReferrerFeesSf: toBigInt(
      decoded.liquidity.accumulatedReferrerFeesSf,
    ),
    pendingReferrerFeesSf: toBigInt(decoded.liquidity.pendingReferrerFeesSf),
    collateralMintTotalSupply: toBigInt(decoded.collateral.mintTotalSupply),
  }
}

function decodeKVaultSharesMintAndDecimals(
  accountData: Uint8Array,
): { sharesMint: string; sharesDecimals: number } | null {
  const decoded = VaultState.decode(Buffer.from(accountData)) as KVaultStateWire
  if (decoded.sharesMint === DEFAULT_PUBKEY) return null

  return {
    sharesMint: decoded.sharesMint,
    sharesDecimals: toNumber(decoded.sharesMintDecimals),
  }
}

function collateralToUnderlyingAmount(
  depositedCollateralAmount: bigint,
  reserve: KlendReserveDecoded,
): bigint {
  const totalSupplyLamports =
    reserve.liquidityAvailableAmount +
    sfToLamports(reserve.liquidityBorrowedAmountSf) -
    sfToLamports(reserve.accumulatedProtocolFeesSf) -
    sfToLamports(reserve.accumulatedReferrerFeesSf) -
    sfToLamports(reserve.pendingReferrerFeesSf)

  if (reserve.collateralMintTotalSupply <= 0n || totalSupplyLamports <= 0n) {
    return depositedCollateralAmount
  }

  const converted =
    (depositedCollateralAmount * totalSupplyLamports) /
    reserve.collateralMintTotalSupply
  return converted > 0n ? converted : depositedCollateralAmount
}

const OBLIGATION_DISC_B64 = Buffer.from(Obligation.discriminator).toString(
  'base64',
)
const RESERVE_DISC_B64 = Buffer.from(Reserve.discriminator).toString('base64')
const KVAULT_STATE_DISC_B64 = Buffer.from(VaultState.discriminator).toString(
  'base64',
)
const FARMS_USER_STATE_DISC_B64 = Buffer.from(UserState.discriminator).toString(
  'base64',
)

export const kaminoIntegration: SolanaIntegration = {
  platformId: 'kamino',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const userTokenAccounts = yield [
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: address,
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: address,
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      },
    ]

    const userMintBalances = new Map<string, bigint>()
    for (const account of Object.values(userTokenAccounts)) {
      if (!account.exists) continue
      const mint = readTokenAccountMint(account.data)
      const amount = readTokenAccountAmount(account.data)
      if (!mint || amount === null || amount <= 0n) continue

      userMintBalances.set(mint, (userMintBalances.get(mint) ?? 0n) + amount)
    }

    const kvaultRequests = [...userMintBalances.keys()].map((mint) => ({
      kind: 'getProgramAccounts' as const,
      programId: KVAULT_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: KVAULT_STATE_DISC_B64,
            encoding: 'base64' as const,
          },
        },
        {
          memcmp: {
            offset: KVAULT_SHARES_MINT_OFFSET,
            bytes: mint,
          },
        },
      ],
    }))

    const phase1Requests = [
      {
        kind: 'getProgramAccounts' as const,
        programId: KLEND_PROGRAM_ID,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: OBLIGATION_DISC_B64,
              encoding: 'base64' as const,
            },
          },
          {
            memcmp: {
              offset: 64,
              bytes: address,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: KLEND_PROGRAM_ID,
        cacheTtlMs: KLEND_RESERVES_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: RESERVE_DISC_B64,
              encoding: 'base64' as const,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: FARMS_PROGRAM_ID,
        filters: [
          {
            dataSize: UserState.layout.span + 8,
          },
          {
            memcmp: {
              offset: 0,
              bytes: FARMS_USER_STATE_DISC_B64,
              encoding: 'base64' as const,
            },
          },
          {
            memcmp: {
              offset: 48,
              bytes: address,
            },
          },
        ],
      },
      ...kvaultRequests,
    ]
    const phase1Map = yield phase1Requests

    const obligations: KlendObligationDecoded[] = []
    const reserveAddressSet = new Set<string>()
    const reserveByAddress = new Map<string, KlendReserveDecoded>()
    const obligationDepositReserveSet = new Set<string>()
    const farmAddressSet = new Set<string>()
    const farmsUserStates = new Map<string, FarmsUserStateAggregate>()

    const kvaultSharePositions: UserDefiPosition[] = []
    const seenSharesMints = new Set<string>()

    for (const account of Object.values(phase1Map)) {
      if (!account.exists) continue

      if (account.programAddress === KLEND_PROGRAM_ID) {
        try {
          const obligation = decodeKlendObligation(account.data)
          if (obligation.owner !== address) continue
          if (
            obligation.deposits.length === 0 &&
            obligation.borrows.length === 0
          ) {
            continue
          }

          obligations.push(obligation)
          for (const d of obligation.deposits) {
            reserveAddressSet.add(d.depositReserve)
            obligationDepositReserveSet.add(d.depositReserve)
          }
          for (const b of obligation.borrows) {
            reserveAddressSet.add(b.borrowReserve)
          }
        } catch {
          // Ignore decode failures from unexpected account variants.
        }

        try {
          const reserve = decodeKlendReserve(account.data)
          reserveByAddress.set(account.address, reserve)
        } catch {
          // Ignore non-reserve KLend accounts.
        }
      }

      if (account.programAddress === KVAULT_PROGRAM_ID) {
        try {
          const vault = decodeKVaultSharesMintAndDecimals(account.data)
          if (!vault || seenSharesMints.has(vault.sharesMint)) continue

          const userShares = userMintBalances.get(vault.sharesMint)
          if (!userShares || userShares <= 0n) continue

          const token = tokens.get(vault.sharesMint)
          const stakedUsdValue = buildUsdValue(
            userShares,
            vault.sharesDecimals,
            token?.priceUsd,
          )

          seenSharesMints.add(vault.sharesMint)
          kvaultSharePositions.push({
            platformId: 'kamino',
            positionKind: 'staking',
            ...(stakedUsdValue !== undefined && { usdValue: stakedUsdValue }),
            staked: [
              {
                amount: {
                  token: vault.sharesMint,
                  amount: userShares.toString(),
                  decimals: vault.sharesDecimals.toString(),
                },
                ...(token?.priceUsd !== undefined && {
                  priceUsd: token.priceUsd.toString(),
                }),
                ...(stakedUsdValue !== undefined && { usdValue: stakedUsdValue }),
              },
            ],
          })
        } catch {
          // Ignore decode failures from non-vault or incompatible accounts.
        }
      }

      if (account.programAddress === FARMS_PROGRAM_ID) {
        try {
          const userState = UserState.decode(
            Buffer.from(account.data),
          ) as FarmsUserStateWire
          const farmAddress = userState.farmState.toString()
          if (farmAddress === DEFAULT_PUBKEY) continue

          farmAddressSet.add(farmAddress)
          const aggregate = farmsUserStates.get(farmAddress) ?? {
            activeStakeScaled: 0n,
            pendingWithdrawalUnstakeScaled: 0n,
            rewardsIssuedUnclaimed: [],
          }
          aggregate.activeStakeScaled += toBigInt(userState.activeStakeScaled)
          aggregate.pendingWithdrawalUnstakeScaled += toBigInt(
            userState.pendingWithdrawalUnstakeScaled,
          )
          for (const [
            index,
            reward,
          ] of userState.rewardsIssuedUnclaimed.entries()) {
            const previous = aggregate.rewardsIssuedUnclaimed[index] ?? 0n
            aggregate.rewardsIssuedUnclaimed[index] =
              previous + toBigInt(reward)
          }
          farmsUserStates.set(farmAddress, aggregate)
        } catch {
          // Ignore decode failures from incompatible farms accounts.
        }
      }
    }

    const reserveAddresses = [...reserveAddressSet]
    const farmAddresses = [...farmAddressSet]
    const batchAddresses = [...reserveAddresses, ...farmAddresses]
    const fetchedAccountsMap =
      batchAddresses.length > 0 ? yield batchAddresses : {}

    for (const reserveAddress of reserveAddresses) {
      if (reserveByAddress.has(reserveAddress)) continue
      const account = fetchedAccountsMap[reserveAddress]
      if (!account?.exists) continue

      try {
        reserveByAddress.set(reserveAddress, decodeKlendReserve(account.data))
      } catch {
        // Skip reserves that fail to decode.
      }
    }

    const farmsByAddress = new Map<string, FarmStateWire>()
    for (const farmAddress of farmAddresses) {
      const account = fetchedAccountsMap[farmAddress]
      if (!account?.exists) continue

      try {
        farmsByAddress.set(
          farmAddress,
          FarmState.decode(Buffer.from(account.data)) as FarmStateWire,
        )
      } catch {
        // Skip farms that fail to decode.
      }
    }

    const lendingPositions: UserDefiPosition[] = []
    const farmsPositions: UserDefiPosition[] = []
    const collateralOnlySupplied: LendingSuppliedAsset[] = []

    for (const obligation of obligations) {
      const supplied: LendingSuppliedAsset[] = []
      const borrowed: LendingBorrowedAsset[] = []

      for (const deposit of obligation.deposits) {
        const reserve = reserveByAddress.get(deposit.depositReserve)
        if (!reserve || reserve.liquidityMint === DEFAULT_PUBKEY) continue

        const amountRaw = collateralToUnderlyingAmount(
          deposit.depositedAmount,
          reserve,
        )
        const token = tokens.get(reserve.liquidityMint)

        supplied.push({
          amount: {
            token: reserve.liquidityMint,
            amount: amountRaw.toString(),
            decimals: reserve.liquidityDecimals.toString(),
          },
          usdValue: sfToDecimalString(deposit.marketValueSf),
          ...(token?.priceUsd !== undefined && {
            priceUsd: token.priceUsd.toString(),
          }),
        })
      }

      for (const debt of obligation.borrows) {
        const reserve = reserveByAddress.get(debt.borrowReserve)
        if (!reserve || reserve.liquidityMint === DEFAULT_PUBKEY) continue

        const amountRaw = sfToLamports(debt.borrowedAmountSf)
        const token = tokens.get(reserve.liquidityMint)

        borrowed.push({
          amount: {
            token: reserve.liquidityMint,
            amount: amountRaw.toString(),
            decimals: reserve.liquidityDecimals.toString(),
          },
          usdValue: sfToDecimalString(debt.marketValueSf),
          ...(token?.priceUsd !== undefined && {
            priceUsd: token.priceUsd.toString(),
          }),
        })
      }

      if (supplied.length === 0 && borrowed.length === 0) continue

      const netValueSf =
        obligation.depositedValueSf - obligation.borrowedAssetsMarketValueSf

      const position: LendingDefiPosition = {
        platformId: 'kamino',
        positionKind: 'lending',
        ...(supplied.length > 0 && { supplied }),
        ...(borrowed.length > 0 && { borrowed }),
        usdValue: sfToDecimalString(netValueSf),
      }

      if (obligation.borrowFactorAdjustedDebtValueSf > 0n) {
        position.healthFactor = divideToDecimalString(
          obligation.allowedBorrowValueSf,
          obligation.borrowFactorAdjustedDebtValueSf,
          6,
        )
      }

      lendingPositions.push(position)
    }

    for (const [reserveAddress, reserve] of reserveByAddress.entries()) {
      if (obligationDepositReserveSet.has(reserveAddress)) continue
      if (
        reserve.collateralMint === DEFAULT_PUBKEY ||
        reserve.liquidityMint === DEFAULT_PUBKEY
      ) {
        continue
      }

      const collateralBalance = userMintBalances.get(reserve.collateralMint)
      if (!collateralBalance || collateralBalance <= 0n) continue

      const amountRaw = collateralToUnderlyingAmount(collateralBalance, reserve)
      const token = tokens.get(reserve.liquidityMint)
      const usdValue = buildUsdValue(
        amountRaw,
        reserve.liquidityDecimals,
        token?.priceUsd,
      )
      collateralOnlySupplied.push({
        amount: {
          token: reserve.liquidityMint,
          amount: amountRaw.toString(),
          decimals: reserve.liquidityDecimals.toString(),
        },
        ...(usdValue !== undefined && { usdValue }),
        ...(token?.priceUsd !== undefined && {
          priceUsd: token.priceUsd.toString(),
        }),
      })
    }

    if (collateralOnlySupplied.length > 0) {
      const usdValue = sumUsdValues(
        collateralOnlySupplied.map((asset) => asset.usdValue),
      )
      lendingPositions.push({
        platformId: 'kamino',
        positionKind: 'lending',
        supplied: collateralOnlySupplied,
        ...(usdValue !== undefined && { usdValue }),
      })
    }

    for (const [farmAddress, aggregate] of farmsUserStates.entries()) {
      const farm = farmsByAddress.get(farmAddress)
      if (!farm) continue

      const stakedRaw = scaledWadsToRawAmount(aggregate.activeStakeScaled)
      const pendingWithdrawalRaw = scaledWadsToRawAmount(
        aggregate.pendingWithdrawalUnstakeScaled,
      )
      const stakedToken = farm.token.mint.toString()
      const stakedTokenDecimalsNum = toNumber(farm.token.decimals)
      const stakedTokenDecimals = stakedTokenDecimalsNum.toString()
      const stakedTokenInfo = tokens.get(stakedToken)
      const stakedUsdValue = buildUsdValue(
        stakedRaw,
        stakedTokenDecimalsNum,
        stakedTokenInfo?.priceUsd,
      )
      const pendingUsdValue = buildUsdValue(
        pendingWithdrawalRaw,
        stakedTokenDecimalsNum,
        stakedTokenInfo?.priceUsd,
      )
      const rewardUsdValues: Array<string | undefined> = []

      const rewards = farm.rewardInfos
        .map((rewardInfo, index) => {
          const claimableAmountRaw =
            aggregate.rewardsIssuedUnclaimed[index] ?? 0n
          if (
            claimableAmountRaw <= 0n ||
            rewardInfo.token.mint.toString() === DEFAULT_PUBKEY
          ) {
            return null
          }
          const rewardMint = rewardInfo.token.mint.toString()
          const rewardDecimals = toNumber(rewardInfo.token.decimals)
          const rewardToken = tokens.get(rewardMint)
          const rewardUsdValue = buildUsdValue(
            claimableAmountRaw,
            rewardDecimals,
            rewardToken?.priceUsd,
          )
          rewardUsdValues.push(rewardUsdValue)

          return {
            amount: {
              token: rewardMint,
              amount: claimableAmountRaw.toString(),
              decimals: rewardDecimals.toString(),
            },
            ...(rewardToken?.priceUsd !== undefined && {
              priceUsd: rewardToken.priceUsd.toString(),
            }),
            ...(rewardUsdValue !== undefined && { usdValue: rewardUsdValue }),
          }
        })
        .filter((entry) => entry !== null)

      if (
        stakedRaw <= 0n &&
        pendingWithdrawalRaw <= 0n &&
        rewards.length === 0
      ) {
        continue
      }

      const positionUsdValue = sumUsdValues([
        stakedUsdValue,
        pendingUsdValue,
        ...rewardUsdValues,
      ])

      farmsPositions.push({
        platformId: 'kamino',
        positionKind: 'staking',
        ...(positionUsdValue !== undefined && { usdValue: positionUsdValue }),
        ...(stakedRaw > 0n && {
          staked: [
            {
              amount: {
                token: stakedToken,
                amount: stakedRaw.toString(),
                decimals: stakedTokenDecimals,
              },
              ...(stakedTokenInfo?.priceUsd !== undefined && {
                priceUsd: stakedTokenInfo.priceUsd.toString(),
              }),
              ...(stakedUsdValue !== undefined && { usdValue: stakedUsdValue }),
            },
          ],
        }),
        ...(pendingWithdrawalRaw > 0n && {
          unbonding: [
            {
              amount: {
                token: stakedToken,
                amount: pendingWithdrawalRaw.toString(),
                decimals: stakedTokenDecimals,
              },
              ...(stakedTokenInfo?.priceUsd !== undefined && {
                priceUsd: stakedTokenInfo.priceUsd.toString(),
              }),
              ...(pendingUsdValue !== undefined && {
                usdValue: pendingUsdValue,
              }),
            },
          ],
        }),
        ...(rewards.length > 0 && { rewards }),
      })
    }

    return [...lendingPositions, ...kvaultSharePositions, ...farmsPositions]
  },
}

export default kaminoIntegration
