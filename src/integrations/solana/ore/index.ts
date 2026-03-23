import { PublicKey } from '@solana/web3.js'
import type {
  SolanaIntegration,
  SolanaPlugins,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv')
const ORE_MINT = 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp'
const ORE_DECIMALS = 11
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const SOL_DECIMALS = 9

const MINER_DISCRIMINATOR = 103
const STAKE_DISCRIMINATOR = 108

// Miner account offsets (Steel framework, 1-byte discriminator)
const MINER_DEPLOYED_OFFSET = 33   // [u64; 25]
const MINER_REWARDS_SOL_OFFSET = 481
const MINER_REWARDS_ORE_OFFSET = 489
const MINER_REFINED_ORE_OFFSET = 497

// Stake account offsets
const STAKE_BALANCE_OFFSET = 33
const STAKE_REWARDS_OFFSET = 121

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const ORE_INDEXED_PROGRAMS = [
  ORE_PROGRAM_ID.toBase58(),
] as const

function readU64(data: Uint8Array, offset: number): bigint {
  return Buffer.from(data).readBigUInt64LE(offset)
}

function totalDeployed(data: Uint8Array): bigint {
  let sum = 0n
  for (let i = 0; i < 25; i++) {
    sum += readU64(data, MINER_DEPLOYED_OFFSET + i * 8)
  }
  return sum
}

export const oreIntegration: SolanaIntegration = {
  platformId: 'ore',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const authority = new PublicKey(address)

    const [minerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('miner'), authority.toBuffer()],
      ORE_PROGRAM_ID,
    )
    const [stakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('stake'), authority.toBuffer()],
      ORE_PROGRAM_ID,
    )

    const minerKey = minerPda.toBase58()
    const stakeKey = stakePda.toBase58()

    // Round 0: fetch both PDAs in one batch
    const accountsMap = yield [minerKey, stakeKey]

    const result: UserDefiPosition[] = []

    // --- Miner position ---
    const minerAcc = accountsMap[minerKey]
    if (minerAcc?.exists && minerAcc.data[0] === MINER_DISCRIMINATOR) {
      const deployedLamports = totalDeployed(minerAcc.data)
      const rewardsOre = readU64(minerAcc.data, MINER_REWARDS_ORE_OFFSET)
      const refinedOre = readU64(minerAcc.data, MINER_REFINED_ORE_OFFSET)
      const rewardsSol = readU64(minerAcc.data, MINER_REWARDS_SOL_OFFSET)
      const totalOreRewards = rewardsOre + refinedOre

      if (deployedLamports > 0n || totalOreRewards > 0n || rewardsSol > 0n) {
        const solToken = tokens.get(SOL_MINT)
        const oreToken = tokens.get(ORE_MINT)

        const deployedUsd =
          solToken?.priceUsd !== undefined
            ? ((Number(deployedLamports) / 10 ** SOL_DECIMALS) * solToken.priceUsd).toString()
            : undefined
        const oreRewardsUsd =
          oreToken?.priceUsd !== undefined
            ? ((Number(totalOreRewards) / 10 ** ORE_DECIMALS) * oreToken.priceUsd).toString()
            : undefined
        const solRewardsUsd =
          solToken?.priceUsd !== undefined
            ? ((Number(rewardsSol) / 10 ** SOL_DECIMALS) * solToken.priceUsd).toString()
            : undefined

        const position: StakingDefiPosition = {
          platformId: 'ore',
          positionKind: 'staking',
          ...(deployedLamports > 0n && {
            staked: [
              {
                amount: {
                  token: SOL_MINT,
                  amount: deployedLamports.toString(),
                  decimals: SOL_DECIMALS.toString(),
                },
                ...(solToken?.priceUsd !== undefined && {
                  priceUsd: solToken.priceUsd.toString(),
                }),
                ...(deployedUsd !== undefined && { usdValue: deployedUsd }),
              },
            ],
          }),
          rewards: [
            ...(totalOreRewards > 0n
              ? [
                  {
                    amount: {
                      token: ORE_MINT,
                      amount: totalOreRewards.toString(),
                      decimals: ORE_DECIMALS.toString(),
                    },
                    ...(oreToken?.priceUsd !== undefined && {
                      priceUsd: oreToken.priceUsd.toString(),
                    }),
                    ...(oreRewardsUsd !== undefined && { usdValue: oreRewardsUsd }),
                  },
                ]
              : []),
            ...(rewardsSol > 0n
              ? [
                  {
                    amount: {
                      token: SOL_MINT,
                      amount: rewardsSol.toString(),
                      decimals: SOL_DECIMALS.toString(),
                    },
                    ...(solToken?.priceUsd !== undefined && {
                      priceUsd: solToken.priceUsd.toString(),
                    }),
                    ...(solRewardsUsd !== undefined && { usdValue: solRewardsUsd }),
                  },
                ]
              : []),
          ],
        }

        const usdParts = [deployedUsd, oreRewardsUsd, solRewardsUsd].filter(
          (v): v is string => v !== undefined,
        )
        if (usdParts.length > 0) {
          position.usdValue = usdParts
            .reduce((sum, v) => sum + Number(v), 0)
            .toString()
        }

        result.push(position)
      }
    }

    // --- Stake position ---
    const stakeAcc = accountsMap[stakeKey]
    if (stakeAcc?.exists && stakeAcc.data[0] === STAKE_DISCRIMINATOR) {
      const balance = readU64(stakeAcc.data, STAKE_BALANCE_OFFSET)
      const rewards = readU64(stakeAcc.data, STAKE_REWARDS_OFFSET)

      if (balance > 0n) {
        const oreToken = tokens.get(ORE_MINT)

        const stakedUsd =
          oreToken?.priceUsd !== undefined
            ? ((Number(balance) / 10 ** ORE_DECIMALS) * oreToken.priceUsd).toString()
            : undefined
        const rewardsUsd =
          oreToken?.priceUsd !== undefined && rewards > 0n
            ? ((Number(rewards) / 10 ** ORE_DECIMALS) * oreToken.priceUsd).toString()
            : undefined

        const position: StakingDefiPosition = {
          platformId: 'ore',
          positionKind: 'staking',
          staked: [
            {
              amount: {
                token: ORE_MINT,
                amount: balance.toString(),
                decimals: ORE_DECIMALS.toString(),
              },
              ...(oreToken?.priceUsd !== undefined && {
                priceUsd: oreToken.priceUsd.toString(),
              }),
              ...(stakedUsd !== undefined && { usdValue: stakedUsd }),
            },
          ],
          ...(rewards > 0n && {
            rewards: [
              {
                amount: {
                  token: ORE_MINT,
                  amount: rewards.toString(),
                  decimals: ORE_DECIMALS.toString(),
                },
                ...(oreToken?.priceUsd !== undefined && {
                  priceUsd: oreToken.priceUsd.toString(),
                }),
                ...(rewardsUsd !== undefined && { usdValue: rewardsUsd }),
              },
            ],
          }),
        }

        const usdParts = [stakedUsd, rewardsUsd].filter(
          (v): v is string => v !== undefined,
        )
        if (usdParts.length > 0) {
          position.usdValue = usdParts
            .reduce((sum, v) => sum + Number(v), 0)
            .toString()
        }

        result.push(position)
      }
    }

    return result
  },
}

export default oreIntegration
