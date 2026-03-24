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
import marginfiIdl from './idls/marginfi_0.1.7.json'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

const MARGINFI_PROGRAM_ID = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA'

export const PROGRAM_IDS = [MARGINFI_PROGRAM_ID] as const

const MARGINFI_ACCOUNT_DISC_B64 = accountDiscriminatorBase64(
  marginfiIdl as {
    accounts?: Array<{ name: string; discriminator?: number[] }>
  },
  'MarginfiAccount',
)

const MARGINFI_ACCOUNT_AUTHORITY_OFFSET = 40
const I80F48_SCALE = 1n << 48n
const I80F48_SCALE_SQUARED = I80F48_SCALE * I80F48_SCALE

const ASSET_TAG_DEFAULT = 0
const ASSET_TAG_SOL = 1
const ASSET_TAG_STAKED = 2
const ASSET_TAG_KAMINO = 3
const ASSET_TAG_DRIFT = 4
const ASSET_TAG_SOLEND = 5

type OriginProtocol = 'project0' | 'kamino' | 'drift' | 'solend'

const marginfiCoder = new BorshCoder(marginfiIdl as never)

interface WrappedI80F48 {
  value: number[] | Uint8Array
}

interface MarginfiBalanceRaw {
  active: number | boolean
  bank_pk: PublicKey
  asset_shares: WrappedI80F48
  liability_shares: WrappedI80F48
}

interface MarginfiAccountRaw {
  group: PublicKey
  lending_account: {
    balances: MarginfiBalanceRaw[]
  }
}

interface MarginfiBankRaw {
  group: PublicKey
  mint: PublicKey
  mint_decimals: number
  asset_share_value: WrappedI80F48
  liability_share_value: WrappedI80F48
  config: {
    asset_tag: number
  }
}

interface AggregatedPositionAmount {
  mint: string
  amountRaw: bigint
  decimals: number
}

interface AggregatedPositionByOrigin {
  suppliedByMint: Map<string, AggregatedPositionAmount>
  borrowedByMint: Map<string, AggregatedPositionAmount>
}

function accountDiscriminatorBase64(
  idl: { accounts?: Array<{ name: string; discriminator?: number[] }> },
  accountName: string,
): string {
  const discriminator = idl.accounts?.find(
    (account) => account.name === accountName,
  )?.discriminator

  if (!discriminator) {
    throw new Error(`Missing discriminator for account "${accountName}"`)
  }

  return Buffer.from(discriminator).toString('base64')
}

function decodeSignedI128LE(bytes: number[] | Uint8Array): bigint {
  const buf = Uint8Array.from(bytes)
  let value = 0n

  for (let idx = 0; idx < 16; idx++) {
    value |= BigInt(buf[idx] ?? 0) << (BigInt(idx) * 8n)
  }

  if ((buf[15] ?? 0) & 0x80) {
    value -= 1n << 128n
  }

  return value
}

function wrappedI80F48ToBigInt(value: WrappedI80F48): bigint {
  return decodeSignedI128LE(value.value)
}

function mulDivTrunc(
  numeratorA: bigint,
  numeratorB: bigint,
  denominator: bigint,
) {
  if (denominator === 0n) return 0n

  const negative = numeratorA < 0n !== numeratorB < 0n
  const absA = numeratorA < 0n ? -numeratorA : numeratorA
  const absB = numeratorB < 0n ? -numeratorB : numeratorB
  const quotient = (absA * absB) / denominator

  return negative ? -quotient : quotient
}

function computeAssetAmountRaw(
  shares: WrappedI80F48,
  shareValue: WrappedI80F48,
): bigint {
  return mulDivTrunc(
    wrappedI80F48ToBigInt(shares),
    wrappedI80F48ToBigInt(shareValue),
    I80F48_SCALE_SQUARED,
  )
}

function buildUsdValue(amountRaw: bigint, decimals: number, priceUsd?: number) {
  if (priceUsd === undefined) return undefined
  if (amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) return undefined

  return ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
}

function buildSuppliedAsset(
  mint: string,
  amountRaw: bigint,
  decimals: number,
  tokens: SolanaPlugins['tokens'],
): LendingSuppliedAsset {
  const token = tokens.get(mint)
  const usdValue = buildUsdValue(amountRaw, decimals, token?.priceUsd)

  return {
    amount: {
      token: mint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(token?.priceUsd !== undefined && {
      priceUsd: token.priceUsd.toString(),
    }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function buildBorrowedAsset(
  mint: string,
  amountRaw: bigint,
  decimals: number,
  tokens: SolanaPlugins['tokens'],
): LendingBorrowedAsset {
  const token = tokens.get(mint)
  const usdValue = buildUsdValue(amountRaw, decimals, token?.priceUsd)

  return {
    amount: {
      token: mint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
    ...(token?.priceUsd !== undefined && {
      priceUsd: token.priceUsd.toString(),
    }),
    ...(usdValue !== undefined && { usdValue }),
  }
}

function pushAggregatedAmount(
  map: Map<string, AggregatedPositionAmount>,
  mint: string,
  decimals: number,
  amountRaw: bigint,
) {
  const prev = map.get(mint)
  if (prev) {
    prev.amountRaw += amountRaw
    return
  }

  map.set(mint, {
    mint,
    decimals,
    amountRaw,
  })
}

function getOriginProtocol(assetTag: number): OriginProtocol | null {
  switch (assetTag) {
    case ASSET_TAG_DEFAULT:
    case ASSET_TAG_SOL:
    case ASSET_TAG_STAKED:
      return 'project0'
    case ASSET_TAG_KAMINO:
      return 'kamino'
    case ASSET_TAG_DRIFT:
      return 'drift'
    case ASSET_TAG_SOLEND:
      return 'solend'
    default:
      return null
  }
}

export const project0Integration: SolanaIntegration = {
  platformId: 'project0',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const marginfiAccountsMap = yield {
      kind: 'getProgramAccounts' as const,
      programId: MARGINFI_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: MARGINFI_ACCOUNT_DISC_B64,
            encoding: 'base64',
          },
        },
        {
          memcmp: {
            offset: MARGINFI_ACCOUNT_AUTHORITY_OFFSET,
            bytes: address,
          },
        },
      ],
    }

    const parsedAccounts: Array<{
      marginfiAccount: string
      group: string
      balances: MarginfiBalanceRaw[]
    }> = []
    const bankAddressSet = new Set<string>()

    for (const [accountAddress, account] of Object.entries(
      marginfiAccountsMap,
    )) {
      if (!account.exists) continue

      let decoded: MarginfiAccountRaw
      try {
        decoded = marginfiCoder.accounts.decode(
          'MarginfiAccount',
          Buffer.from(account.data),
        ) as MarginfiAccountRaw
      } catch {
        continue
      }

      const activeBalances = decoded.lending_account.balances.filter(
        (balance) => {
          if (balance.active !== 1 && balance.active !== true) return false
          const bankAddress = balance.bank_pk.toBase58()
          return bankAddress !== PublicKey.default.toBase58()
        },
      )

      if (activeBalances.length === 0) continue

      for (const balance of activeBalances) {
        bankAddressSet.add(balance.bank_pk.toBase58())
      }

      parsedAccounts.push({
        marginfiAccount: accountAddress,
        group: decoded.group.toBase58(),
        balances: activeBalances,
      })
    }

    if (parsedAccounts.length === 0 || bankAddressSet.size === 0) {
      return []
    }

    const bankAddresses = [...bankAddressSet]
    const banksMap = yield bankAddresses
    const decodedBanks = new Map<string, MarginfiBankRaw>()

    for (const bankAddress of bankAddresses) {
      const bank = banksMap[bankAddress]
      if (!bank?.exists) continue

      try {
        const decoded = marginfiCoder.accounts.decode(
          'Bank',
          Buffer.from(bank.data),
        ) as MarginfiBankRaw
        decodedBanks.set(bankAddress, decoded)
      } catch {
        // Ignore banks that fail to decode.
      }
    }

    const positions: UserDefiPosition[] = []

    for (const parsedAccount of parsedAccounts) {
      const positionsByOrigin = new Map<
        OriginProtocol,
        AggregatedPositionByOrigin
      >()

      for (const balance of parsedAccount.balances) {
        const bankAddress = balance.bank_pk.toBase58()
        const bank = decodedBanks.get(bankAddress)
        if (!bank) continue

        if (bank.group.toBase58() !== parsedAccount.group) continue
        const originProtocol = getOriginProtocol(bank.config.asset_tag)
        if (!originProtocol) continue

        let aggregated = positionsByOrigin.get(originProtocol)
        if (!aggregated) {
          aggregated = {
            suppliedByMint: new Map<string, AggregatedPositionAmount>(),
            borrowedByMint: new Map<string, AggregatedPositionAmount>(),
          }
          positionsByOrigin.set(originProtocol, aggregated)
        }

        const mint = bank.mint.toBase58()
        const decimals = bank.mint_decimals

        const suppliedRaw = computeAssetAmountRaw(
          balance.asset_shares,
          bank.asset_share_value,
        )
        const borrowedRaw = computeAssetAmountRaw(
          balance.liability_shares,
          bank.liability_share_value,
        )

        if (suppliedRaw > 0n) {
          pushAggregatedAmount(
            aggregated.suppliedByMint,
            mint,
            decimals,
            suppliedRaw,
          )
        }

        if (borrowedRaw > 0n) {
          pushAggregatedAmount(
            aggregated.borrowedByMint,
            mint,
            decimals,
            borrowedRaw,
          )
        }
      }

      for (const [originProtocol, aggregated] of positionsByOrigin) {
        const { suppliedByMint, borrowedByMint } = aggregated
        if (suppliedByMint.size === 0 && borrowedByMint.size === 0) continue

        const supplied = [...suppliedByMint.values()].map((entry) =>
          buildSuppliedAsset(
            entry.mint,
            entry.amountRaw,
            entry.decimals,
            tokens,
          ),
        )

        const borrowed = [...borrowedByMint.values()].map((entry) =>
          buildBorrowedAsset(
            entry.mint,
            entry.amountRaw,
            entry.decimals,
            tokens,
          ),
        )

        positions.push({
          platformId: 'project0',
          positionKind: 'lending',
          ...(supplied.length > 0 && { supplied }),
          ...(borrowed.length > 0 && { borrowed }),
          meta: {
            project0: {
              marginfiAccount: parsedAccount.marginfiAccount,
              group: parsedAccount.group,
              originProtocol,
            },
          },
        } satisfies LendingDefiPosition)
      }
    }

    return positions
  },
}

export default project0Integration
