import { PublicKey } from '@solana/web3.js'
import type {
  GetProgramAccountsRequest,
  SolanaAccount,
  SolanaIntegration,
  SolanaPlugins,
  StakedAsset,
  StakingDefiPosition,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const DIVVY_HOUSE_PROGRAM_ID = 'dvyFwAPniptQNb1ey4eM12L8iLHrzdiDsPPDndd6xAR'
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const HOUSE_DISCRIMINATOR_B58 = '4cEdzVs6LUe'
const HOUSE_ACCOUNT_SIZES = [294, 312] as const

const TOKEN_ACCOUNT_SIZE = 165
const TOKEN_MINT_OFFSET = 0
const TOKEN_OWNER_OFFSET = 32
const TOKEN_AMOUNT_OFFSET = 64

const HOUSE_MINT_OFFSET = 104
const HOUSE_CURRENCY_OFFSET = 136
const HOUSE_CURRENCY_DECIMALS_OFFSET = 168

const MINT_DECIMALS_OFFSET = 44

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [
  DIVVY_HOUSE_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
] as const

type HouseInfo = {
  address: string
  houseMint: string
  currencyMint: string
  currencyDecimals: number
}

function readPubkey(data: Uint8Array, offset: number): string | null {
  if (data.length < offset + 32) return null
  try {
    return new PublicKey(data.slice(offset, offset + 32)).toBase58()
  } catch {
    return null
  }
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null
  return Buffer.from(data).readBigUInt64LE(offset)
}

function parseHouse(account: SolanaAccount): HouseInfo | null {
  if (account.data.length <= HOUSE_CURRENCY_DECIMALS_OFFSET) return null

  const houseMint = readPubkey(account.data, HOUSE_MINT_OFFSET)
  const currencyMint = readPubkey(account.data, HOUSE_CURRENCY_OFFSET)
  if (!houseMint || !currencyMint) return null

  return {
    address: account.address,
    houseMint,
    currencyMint,
    currencyDecimals: account.data[HOUSE_CURRENCY_DECIMALS_OFFSET] ?? 0,
  }
}

function toUsdValue(
  amount: bigint,
  decimals: number,
  priceUsd: number | undefined,
): string | undefined {
  if (priceUsd === undefined) return undefined
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return ((Number(amount) / 10 ** decimals) * priceUsd).toString()
}

function buildStakedAsset(
  token: string,
  amount: bigint,
  decimals: number,
  priceUsd: number | undefined,
): StakedAsset {
  const value: StakedAsset = {
    amount: {
      token,
      amount: amount.toString(),
      decimals: decimals.toString(),
    },
  }

  if (priceUsd !== undefined) {
    value.priceUsd = priceUsd.toString()
    const usdValue = toUsdValue(amount, decimals, priceUsd)
    if (usdValue !== undefined) value.usdValue = usdValue
  }

  return value
}

function getMintDecimals(
  account: SolanaAccount | undefined,
  fallback: number,
): number {
  if (!account) return fallback
  if (account.programAddress !== TOKEN_PROGRAM_ID) return fallback
  if (account.data.length <= MINT_DECIMALS_OFFSET) return fallback
  return account.data[MINT_DECIMALS_OFFSET] ?? fallback
}

export const divvyIntegration: SolanaIntegration = {
  platformId: 'divvy',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const houseRequests: GetProgramAccountsRequest[] = HOUSE_ACCOUNT_SIZES.map(
      (dataSize) => ({
      kind: 'getProgramAccounts' as const,
      programId: DIVVY_HOUSE_PROGRAM_ID,
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: HOUSE_DISCRIMINATOR_B58,
            encoding: 'base58',
          },
        },
        { dataSize },
      ],
      cacheTtlMs: 60_000,
      }),
    )
    const housesMap = yield houseRequests

    const houses = Object.values(housesMap)
      .filter((account): account is SolanaAccount => account.exists)
      .filter((account) => account.programAddress === DIVVY_HOUSE_PROGRAM_ID)
      .map(parseHouse)
      .filter((house): house is HouseInfo => house !== null)

    if (houses.length === 0) return []

    const tokenRequests = houses.flatMap((house) => [
      {
        kind: 'getProgramAccounts' as const,
        programId: TOKEN_PROGRAM_ID,
        filters: [
          { dataSize: TOKEN_ACCOUNT_SIZE },
          { memcmp: { offset: TOKEN_MINT_OFFSET, bytes: house.houseMint } },
          { memcmp: { offset: TOKEN_OWNER_OFFSET, bytes: address } },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: TOKEN_2022_PROGRAM_ID,
        filters: [
          { dataSize: TOKEN_ACCOUNT_SIZE },
          { memcmp: { offset: TOKEN_MINT_OFFSET, bytes: house.houseMint } },
          { memcmp: { offset: TOKEN_OWNER_OFFSET, bytes: address } },
        ],
      },
    ])

    const tokenAccounts = yield tokenRequests

    const houseByMint = new Map(houses.map((house) => [house.houseMint, house]))
    const balancesByMint = new Map<string, bigint>()

    for (const account of Object.values(tokenAccounts)) {
      if (!account.exists) continue

      if (
        account.programAddress !== TOKEN_PROGRAM_ID &&
        account.programAddress !== TOKEN_2022_PROGRAM_ID
      ) {
        continue
      }

      const mint = readPubkey(account.data, TOKEN_MINT_OFFSET)
      const amount = readU64(account.data, TOKEN_AMOUNT_OFFSET)

      if (!mint || amount === null || amount <= 0n) continue
      if (!houseByMint.has(mint)) continue

      const current = balancesByMint.get(mint) ?? 0n
      balancesByMint.set(mint, current + amount)
    }

    const relevantHouses = houses.filter((house) => {
      const balance = balancesByMint.get(house.houseMint)
      return balance !== undefined && balance > 0n
    })

    if (relevantHouses.length === 0) return []

    const uniqueMints = [...new Set(relevantHouses.map((house) => house.houseMint))]
    const mintAccounts = yield uniqueMints

    const positions: UserDefiPosition[] = []
    for (const house of relevantHouses) {
      const amount = balancesByMint.get(house.houseMint)
      if (amount === undefined || amount <= 0n) continue

      const mintAccount = mintAccounts[house.houseMint]
      const mintDecimals =
        mintAccount?.exists === true
          ? getMintDecimals(mintAccount, house.currencyDecimals)
          : house.currencyDecimals

      const token = tokens.get(house.houseMint)
      const stakedValue = buildStakedAsset(
        house.houseMint,
        amount,
        mintDecimals,
        token?.priceUsd,
      )

      const position: StakingDefiPosition = {
        platformId: 'divvy',
        positionKind: 'staking',
        staked: [stakedValue],
        ...(stakedValue.usdValue !== undefined && { usdValue: stakedValue.usdValue }),
        meta: {
          divvy: {
            houseAddress: house.address,
            houseMint: house.houseMint,
            currencyMint: house.currencyMint,
            currencyDecimals: house.currencyDecimals.toString(),
          },
        },
      }

      positions.push(position)
    }

    positions.sort((left, right) => {
      const leftHouse = String(left.meta?.divvy?.houseAddress ?? '')
      const rightHouse = String(right.meta?.divvy?.houseAddress ?? '')
      return leftHouse.localeCompare(rightHouse)
    })

    return positions
  },
}

export default divvyIntegration
