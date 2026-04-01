import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import type {
  PositionValue,
  SolanaIntegration,
  SolanaPlugins,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const LOCKED_VOTER_PROGRAM_ID = 'LocktDzaV1W2Bm9DeZeiyz4J9zs4fRqNiYqQyracRXw'
const LOCKER_ADDRESS = 'FqEk173TNsqe2maPozsaZk4AvaqpV3FKynyA5s7V4aNq'
const STAKE_POOL_ADDRESS = 'Fu9BYC6tWBo1KMKaP3CFoKfRhqv9akmy3DuYwnCyWiyC'

const VAULT_MINT = 'VAULTVXqi93aaq9FsyPKgdgp6Ge1H1HoSvNC4ZbqFDs'
const VAULT_DECIMALS = 6
const VSOL_MINT = 'vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7'
const VSOL_DECIMALS = 9
const SABER_VSOL_SOL_LP_MINT = 'VLPa8SifUUNL6JvzUuLrjgRibkx7iGr5eVpX6MRR4Qx'
const VAULT_UNSTAKE_LP_MINT = 'EUWoTx5vQQrxaDFdeK2PLUVbnmRWjw4x6sBbmcxBaHjF'

const ESCROW_ACCOUNT_SIZE = 161
const ESCROW_LOCKER_OFFSET = 8
const ESCROW_OWNER_OFFSET = 40
const ESCROW_TOKENS_OFFSET = 73
const ESCROW_AMOUNT_OFFSET = 105
const ESCROW_STARTED_AT_OFFSET = 113
const ESCROW_ENDS_AT_OFFSET = 121
const ESCROW_VOTE_DELEGATE_OFFSET = 129

const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [
  LOCKED_VOTER_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

function readPubkey(data: Uint8Array, offset: number): string | null {
  const buffer = Buffer.from(data)
  if (buffer.length < offset + 32) return null
  return new PublicKey(buffer.subarray(offset, offset + 32)).toBase58()
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  const buffer = Buffer.from(data)
  if (buffer.length < offset + 8) return null
  return buffer.readBigUInt64LE(offset)
}

function readI64(data: Uint8Array, offset: number): bigint | null {
  const buffer = Buffer.from(data)
  if (buffer.length < offset + 8) return null
  return buffer.readBigInt64LE(offset)
}

function buildPositionValue(
  mint: string,
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): PositionValue {
  const value: PositionValue = {
    amount: {
      token: mint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
  }

  if (
    priceUsd !== undefined &&
    amountRaw <= BigInt(Number.MAX_SAFE_INTEGER) &&
    Number.isFinite(priceUsd)
  ) {
    value.priceUsd = priceUsd.toString()
    value.usdValue = ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
  }

  return value
}

type BasicAccount = {
  exists: boolean
  data?: Uint8Array
}

function collectBalancesByMint(accounts: Record<string, BasicAccount>): Map<string, bigint> {
  const balancesByMint = new Map<string, bigint>()

  for (const account of Object.values(accounts)) {
    if (!account.exists || !account.data) continue

    const mint = readPubkey(account.data, TOKEN_ACCOUNT_MINT_OFFSET)
    const amount = readU64(account.data, TOKEN_ACCOUNT_AMOUNT_OFFSET)
    if (!mint || amount === null || amount <= 0n) continue

    balancesByMint.set(mint, (balancesByMint.get(mint) ?? 0n) + amount)
  }

  return balancesByMint
}

export const thevaultIntegration: SolanaIntegration = {
  platformId: 'thevault',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const nowUnix = BigInt(Math.floor(Date.now() / 1000))

    const round0 = yield [
      {
        kind: 'getProgramAccounts' as const,
        programId: LOCKED_VOTER_PROGRAM_ID,
        filters: [
          { dataSize: ESCROW_ACCOUNT_SIZE },
          {
            memcmp: {
              offset: ESCROW_LOCKER_OFFSET,
              bytes: LOCKER_ADDRESS,
              encoding: 'base58' as const,
            },
          },
          {
            memcmp: {
              offset: ESCROW_OWNER_OFFSET,
              bytes: address,
              encoding: 'base58' as const,
            },
          },
        ],
      },
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

    const positions: UserDefiPosition[] = []

    for (const [escrowAddress, account] of Object.entries(round0)) {
      if (!account.exists) continue
      if (account.programAddress !== LOCKED_VOTER_PROGRAM_ID) continue
      if (account.data.length < ESCROW_ACCOUNT_SIZE) continue

      const locker = readPubkey(account.data, ESCROW_LOCKER_OFFSET)
      const owner = readPubkey(account.data, ESCROW_OWNER_OFFSET)
      const escrowTokenVault = readPubkey(account.data, ESCROW_TOKENS_OFFSET)
      const voteDelegate = readPubkey(account.data, ESCROW_VOTE_DELEGATE_OFFSET)
      const amount = readU64(account.data, ESCROW_AMOUNT_OFFSET)
      const escrowStartedAt = readI64(account.data, ESCROW_STARTED_AT_OFFSET)
      const escrowEndsAt = readI64(account.data, ESCROW_ENDS_AT_OFFSET)

      if (!locker || !owner || amount === null || amount <= 0n) continue
      if (locker !== LOCKER_ADDRESS || owner !== address) continue

      const vaultToken = tokens.get(VAULT_MINT)
      const staked = buildPositionValue(
        VAULT_MINT,
        amount,
        VAULT_DECIMALS,
        vaultToken?.priceUsd,
      )

      const position: StakingDefiPosition = {
        platformId: 'thevault',
        positionKind: 'staking',
        staked: [staked],
        ...(staked.usdValue !== undefined && { usdValue: staked.usdValue }),
        ...(escrowEndsAt !== null && { lockedUntil: escrowEndsAt.toString() }),
        ...(escrowStartedAt !== null &&
          escrowEndsAt !== null &&
          escrowEndsAt >= escrowStartedAt && {
            lockDuration: (escrowEndsAt - escrowStartedAt).toString(),
          }),
        meta: {
          thevault: {
            source: 'locker',
            locker,
            escrow: escrowAddress,
            escrowTokenVault: escrowTokenVault ?? null,
            voteDelegate: voteDelegate ?? null,
            lockExpired:
              escrowEndsAt !== null ? escrowEndsAt <= nowUnix : null,
          },
        },
      }

      positions.push(position)
    }

    const balancesByMint = collectBalancesByMint(round0)
    const vsolBalance = balancesByMint.get(VSOL_MINT) ?? 0n
    if (vsolBalance > 0n) {
      const vsolToken = tokens.get(VSOL_MINT)
      const staked = buildPositionValue(
        VSOL_MINT,
        vsolBalance,
        VSOL_DECIMALS,
        vsolToken?.priceUsd,
      )

      positions.push({
        platformId: 'thevault',
        positionKind: 'staking',
        staked: [staked],
        ...(staked.usdValue !== undefined && { usdValue: staked.usdValue }),
        meta: {
          thevault: {
            source: 'stake-pool-token',
            stakePool: STAKE_POOL_ADDRESS,
          },
        },
      } satisfies StakingDefiPosition)
    }

    const deprecatedVaults = [
      {
        mint: SABER_VSOL_SOL_LP_MINT,
        decimals: 9,
        name: 'Saber vSOL-SOL',
        sourceId: 'saber-vsol-sol',
      },
      {
        mint: VAULT_UNSTAKE_LP_MINT,
        decimals: 9,
        name: 'Vault Unstake LP',
        sourceId: 'vault-unstake-lp',
      },
    ] as const

    for (const vault of deprecatedVaults) {
      const balance = balancesByMint.get(vault.mint) ?? 0n
      if (balance <= 0n) continue

      const token = tokens.get(vault.mint)
      const staked = buildPositionValue(
        vault.mint,
        balance,
        vault.decimals,
        token?.priceUsd,
      )

      positions.push({
        platformId: 'thevault',
        positionKind: 'staking',
        staked: [staked],
        ...(staked.usdValue !== undefined && { usdValue: staked.usdValue }),
        meta: {
          thevault: {
            source: 'deprecated-vault',
            deprecated: true,
            vault: vault.sourceId,
            name: vault.name,
          },
        },
      } satisfies StakingDefiPosition)
    }

    return positions
  },
}

export default thevaultIntegration
