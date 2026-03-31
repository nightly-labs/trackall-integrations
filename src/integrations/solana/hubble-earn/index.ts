import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import type {
  LendingDefiPosition,
  PositionValue,
  ProgramRequest,
  RewardDefiPosition,
  SolanaIntegration,
  SolanaPlugins,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

const KAMINO_STRATEGY_PROGRAM_ID = '6LtLpnUFNByNXLyCoK9wA2MykKAmQNZKBdY8s47dehDc'
const STRATEGY_ACCOUNT_SIZE = 4064
const STRATEGY_CACHE_TTL_MS = 5 * 60 * 1000
const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64
const MINT_AUTHORITY_OPTION_OFFSET = 0
const MINT_AUTHORITY_OFFSET = 4
const MINT_DECIMALS_OFFSET = 44
const MINT_ACCOUNT_SIZE = 82

const STRATEGY_SHARES_MINT_OFFSET = 720
const STRATEGY_SHARES_ISSUED_OFFSET = 800
const STRATEGY_STATUS_OFFSET = 808
const STRATEGY_TOKEN_A_MINT_OFFSET = 544
const STRATEGY_TOKEN_B_MINT_OFFSET = 576
const STRATEGY_TOKEN_A_AMOUNT_OFFSET = 624
const STRATEGY_TOKEN_B_AMOUNT_OFFSET = 632
const STRATEGY_REWARD_0_AMOUNT_OFFSET = 816
const STRATEGY_REWARD_0_VAULT_OFFSET = 824
const STRATEGY_REWARD_1_AMOUNT_OFFSET = 872
const STRATEGY_REWARD_1_VAULT_OFFSET = 880
const STRATEGY_REWARD_2_AMOUNT_OFFSET = 928
const STRATEGY_REWARD_2_VAULT_OFFSET = 936

const WHIRLPOOL_STRATEGY_DISCRIMINATOR = Buffer.from([
  190, 178, 231, 184, 49, 186, 103, 13,
])
const WHIRLPOOL_STRATEGY_DISCRIMINATOR_B64 =
  WHIRLPOOL_STRATEGY_DISCRIMINATOR.toString('base64')

type RewardState = {
  amount: bigint
  vault: string
}

type StrategyState = {
  address: string
  shareMint: string
  sharesIssued: bigint
  status: bigint
  tokenAMint: string
  tokenBMint: string
  tokenAAmount: bigint
  tokenBAmount: bigint
  rewards: RewardState[]
}

export const PROGRAM_IDS = [
  KAMINO_STRATEGY_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

function readPubkey(data: Uint8Array, offset: number): string | null {
  const buf = Buffer.from(data)
  if (buf.length < offset + 32) return null
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58()
}

function readU64LE(data: Uint8Array, offset: number): bigint | null {
  const buf = Buffer.from(data)
  if (buf.length < offset + 8) return null
  return buf.readBigUInt64LE(offset)
}

function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) return 0n
  return (a * b) / d
}

function buildPositionValue(
  mint: string,
  amountRaw: bigint,
  plugins: SolanaPlugins,
  decimalsByMint?: Map<string, number>,
): PositionValue {
  const token = plugins.tokens.get(mint)
  const decimals = token?.decimals ?? decimalsByMint?.get(mint) ?? 0
  const value: PositionValue = {
    amount: {
      token: mint,
      amount: amountRaw.toString(),
      decimals: decimals.toString(),
    },
  }

  if (token?.priceUsd !== undefined && amountRaw <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const usd = ((Number(amountRaw) / 10 ** decimals) * token.priceUsd).toString()
    value.priceUsd = token.priceUsd.toString()
    value.usdValue = usd
  }

  return value
}

function sumUsd(values: Array<string | undefined>): string | undefined {
  const present = values.filter((v): v is string => v !== undefined)
  if (present.length === 0) return undefined
  return present.reduce((acc, v) => acc + Number(v), 0).toString()
}

function parseStrategy(accountAddress: string, data: Uint8Array): StrategyState | null {
  if (data.length < STRATEGY_ACCOUNT_SIZE) return null
  if (
    !Buffer.from(data)
      .subarray(0, WHIRLPOOL_STRATEGY_DISCRIMINATOR.length)
      .equals(WHIRLPOOL_STRATEGY_DISCRIMINATOR)
  ) {
    return null
  }

  const shareMint = readPubkey(data, STRATEGY_SHARES_MINT_OFFSET)
  const sharesIssued = readU64LE(data, STRATEGY_SHARES_ISSUED_OFFSET)
  const status = readU64LE(data, STRATEGY_STATUS_OFFSET)
  const tokenAMint = readPubkey(data, STRATEGY_TOKEN_A_MINT_OFFSET)
  const tokenBMint = readPubkey(data, STRATEGY_TOKEN_B_MINT_OFFSET)
  const tokenAAmount = readU64LE(data, STRATEGY_TOKEN_A_AMOUNT_OFFSET)
  const tokenBAmount = readU64LE(data, STRATEGY_TOKEN_B_AMOUNT_OFFSET)
  const reward0Amount = readU64LE(data, STRATEGY_REWARD_0_AMOUNT_OFFSET)
  const reward0Vault = readPubkey(data, STRATEGY_REWARD_0_VAULT_OFFSET)
  const reward1Amount = readU64LE(data, STRATEGY_REWARD_1_AMOUNT_OFFSET)
  const reward1Vault = readPubkey(data, STRATEGY_REWARD_1_VAULT_OFFSET)
  const reward2Amount = readU64LE(data, STRATEGY_REWARD_2_AMOUNT_OFFSET)
  const reward2Vault = readPubkey(data, STRATEGY_REWARD_2_VAULT_OFFSET)

  if (
    !shareMint ||
    sharesIssued === null ||
    status === null ||
    !tokenAMint ||
    !tokenBMint ||
    tokenAAmount === null ||
    tokenBAmount === null ||
    reward0Amount === null ||
    !reward0Vault ||
    reward1Amount === null ||
    !reward1Vault ||
    reward2Amount === null ||
    !reward2Vault
  ) {
    return null
  }

  return {
    address: accountAddress,
    shareMint,
    sharesIssued,
    status,
    tokenAMint,
    tokenBMint,
    tokenAAmount,
    tokenBAmount,
    rewards: [
      { amount: reward0Amount, vault: reward0Vault },
      { amount: reward1Amount, vault: reward1Vault },
      { amount: reward2Amount, vault: reward2Vault },
    ],
  }
}

function isKaminoShareMint(mintAddress: string, mintData: Uint8Array): boolean {
  const buf = Buffer.from(mintData)
  if (buf.length < MINT_ACCOUNT_SIZE) return false
  const mintAuthorityOption = buf.readUInt32LE(MINT_AUTHORITY_OPTION_OFFSET)
  if (mintAuthorityOption === 0) return false

  const mintAuthority = new PublicKey(
    buf.subarray(MINT_AUTHORITY_OFFSET, MINT_AUTHORITY_OFFSET + 32),
  )
  const [expectedAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('authority'), new PublicKey(mintAddress).toBuffer()],
    new PublicKey(KAMINO_STRATEGY_PROGRAM_ID),
  )
  return mintAuthority.equals(expectedAuthority)
}

export const hubbleEarnIntegration: SolanaIntegration = {
  platformId: 'hubble-earn',

  getUserPositions: async function* (
    address: string,
    plugins: SolanaPlugins,
  ): UserPositionsPlan {
    const tokenAccounts = yield [
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

    const userSharesByMint = new Map<string, bigint>()

    for (const account of Object.values(tokenAccounts)) {
      if (!account.exists) continue

      if (
        account.programAddress === TOKEN_PROGRAM_ID.toBase58() ||
        account.programAddress === TOKEN_2022_PROGRAM_ID.toBase58()
      ) {
        const mint = readPubkey(account.data, TOKEN_ACCOUNT_MINT_OFFSET)
        const amount = readU64LE(account.data, TOKEN_ACCOUNT_AMOUNT_OFFSET)
        if (!mint || amount === null || amount <= 0n) continue
        userSharesByMint.set(mint, (userSharesByMint.get(mint) ?? 0n) + amount)
      }
    }

    if (userSharesByMint.size === 0) return []

    const mintAccounts = yield [...userSharesByMint.keys()]
    const candidateShareMints = [...userSharesByMint.keys()].filter((mint) => {
      const mintAccount = mintAccounts[mint]
      if (!mintAccount?.exists) return false
      return isKaminoShareMint(mint, mintAccount.data)
    })

    if (candidateShareMints.length === 0) return []

    const strategyRequests: ProgramRequest[] = candidateShareMints.map(
      (shareMint) => ({
      kind: 'getProgramAccounts' as const,
      programId: KAMINO_STRATEGY_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: WHIRLPOOL_STRATEGY_DISCRIMINATOR_B64,
            encoding: 'base64',
          },
        },
        { dataSize: STRATEGY_ACCOUNT_SIZE },
        {
          memcmp: {
            offset: STRATEGY_SHARES_MINT_OFFSET,
            bytes: shareMint,
            encoding: 'base58',
          },
        },
      ],
      cacheTtlMs: STRATEGY_CACHE_TTL_MS,
      }),
    )
    const strategyAccounts = yield strategyRequests

    const strategyByShareMint = new Map<string, StrategyState>()
    for (const account of Object.values(strategyAccounts)) {
      if (!account.exists) continue
      if (account.programAddress !== KAMINO_STRATEGY_PROGRAM_ID) continue
      const strategy = parseStrategy(account.address, account.data)
      if (!strategy) continue
      if (!strategyByShareMint.has(strategy.shareMint)) {
        strategyByShareMint.set(strategy.shareMint, strategy)
      }
    }

    const matched = candidateShareMints
      .map((shareMint) => ({
        userShares: userSharesByMint.get(shareMint) ?? 0n,
        strategy: strategyByShareMint.get(shareMint),
      }))
      .filter(
        (
          row,
        ): row is {
          userShares: bigint
          strategy: StrategyState
        } =>
          row.strategy !== undefined &&
          row.userShares > 0n &&
          row.strategy.sharesIssued > 0n &&
          row.strategy.status === 1n,
      )

    if (matched.length === 0) return []

    const rewardVaultAddresses = [
      ...new Set(
        matched.flatMap(({ strategy }) =>
          strategy.rewards
            .filter((reward) => reward.amount > 0n)
            .map((reward) => reward.vault),
        ),
      ),
    ]

    const rewardVaultAccounts =
      rewardVaultAddresses.length > 0 ? yield rewardVaultAddresses : {}

    const rewardMintByVault = new Map<string, string>()
    for (const [vaultAddress, vaultAccount] of Object.entries(rewardVaultAccounts)) {
      if (!vaultAccount.exists) continue
      const mint = readPubkey(vaultAccount.data, TOKEN_ACCOUNT_MINT_OFFSET)
      if (!mint) continue
      rewardMintByVault.set(vaultAddress, mint)
    }

    const positions: UserDefiPosition[] = []

    const allMints = new Set<string>()
    for (const { strategy } of matched) {
      allMints.add(strategy.shareMint)
      allMints.add(strategy.tokenAMint)
      allMints.add(strategy.tokenBMint)
      for (const reward of strategy.rewards) {
        if (reward.amount <= 0n) continue
        const rewardMint = rewardMintByVault.get(reward.vault)
        if (rewardMint) allMints.add(rewardMint)
      }
    }

    const mintAccountsToDecode =
      allMints.size > 0 ? yield [...allMints] : {}
    const decimalsByMint = new Map<string, number>()
    for (const [mint, account] of Object.entries(mintAccountsToDecode)) {
      if (!account.exists) continue
      const tokenDecimals = plugins.tokens.get(mint)?.decimals
      if (tokenDecimals !== undefined) {
        decimalsByMint.set(mint, tokenDecimals)
        continue
      }
      const data = Buffer.from(account.data)
      if (data.length <= MINT_DECIMALS_OFFSET) continue
      decimalsByMint.set(mint, data.readUInt8(MINT_DECIMALS_OFFSET))
    }

    for (const { strategy, userShares } of matched) {
      const stakingValue = buildPositionValue(
        strategy.shareMint,
        userShares,
        plugins,
        decimalsByMint,
      )
      const staking: StakingDefiPosition = {
        platformId: 'hubble-earn',
        positionKind: 'staking',
        staked: [stakingValue],
        ...(stakingValue.usdValue !== undefined && {
          usdValue: stakingValue.usdValue,
          totalStakedUsd: stakingValue.usdValue,
        }),
        meta: {
          strategy: {
            address: strategy.address,
            programId: KAMINO_STRATEGY_PROGRAM_ID,
            sharesMint: strategy.shareMint,
          },
        },
      }
      positions.push(staking)

      const suppliedA = mulDivFloor(strategy.tokenAAmount, userShares, strategy.sharesIssued)
      const suppliedB = mulDivFloor(strategy.tokenBAmount, userShares, strategy.sharesIssued)
      const suppliedValues = [
        suppliedA > 0n
          ? buildPositionValue(
              strategy.tokenAMint,
              suppliedA,
              plugins,
              decimalsByMint,
            )
          : null,
        suppliedB > 0n
          ? buildPositionValue(
              strategy.tokenBMint,
              suppliedB,
              plugins,
              decimalsByMint,
            )
          : null,
      ].filter((value): value is PositionValue => value !== null)

      if (suppliedValues.length > 0) {
        const lendingUsdValue = sumUsd(
          suppliedValues.map((value) => value.usdValue),
        )
        const lending: LendingDefiPosition = {
          platformId: 'hubble-earn',
          positionKind: 'lending',
          supplied: suppliedValues,
          ...(lendingUsdValue !== undefined && { usdValue: lendingUsdValue }),
          meta: {
            strategy: {
              address: strategy.address,
            },
          },
        }
        positions.push(lending)
      }

      const claimable = strategy.rewards
        .map((reward) => {
          if (reward.amount <= 0n) return null
          const rewardMint = rewardMintByVault.get(reward.vault)
          if (!rewardMint) return null
          const amount = mulDivFloor(reward.amount, userShares, strategy.sharesIssued)
          if (amount <= 0n) return null
          return buildPositionValue(rewardMint, amount, plugins, decimalsByMint)
        })
        .filter((value): value is PositionValue => value !== null)

      if (claimable.length > 0) {
        const rewardUsdValue = sumUsd(claimable.map((value) => value.usdValue))
        const rewardPosition: RewardDefiPosition = {
          platformId: 'hubble-earn',
          positionKind: 'reward',
          claimable,
          sourceId: strategy.address,
          ...(rewardUsdValue !== undefined && { usdValue: rewardUsdValue }),
          meta: {
            strategy: {
              address: strategy.address,
            },
          },
        }
        positions.push(rewardPosition)
      }
    }

    return positions
  },
}

export default hubbleEarnIntegration
