import { describe, expect, it } from 'bun:test'
import { Connection, PublicKey } from '@solana/web3.js'
import {
  runIntegrations,
  TokenPlugin,
  type AccountsMap,
  type ProgramRequest,
  type SolanaAccount,
} from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import { allbridgeIntegration, testAddress } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

const { getUserPositions } = allbridgeIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

const ALLBRIDGE_PROGRAM_ID = 'BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB'
const USER_DEPOSIT_SIZE = 88
const POOL_SIZE = 131
const USER_DEPOSIT_OWNER_OFFSET = 8
const USER_DEPOSIT_MINT_OFFSET = 40
const USER_DEPOSIT_LP_AMOUNT_OFFSET = 72
const USER_DEPOSIT_REWARD_DEBT_OFFSET = 80
const POOL_MINT_OFFSET = 8
const POOL_DECIMALS_OFFSET = 80
const POOL_ACC_REWARD_PER_SHARE_P_OFFSET = 105
const REWARD_SHIFT_BITS = 48n

function makeAddress(byte: number): string {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte)).toBase58()
}

function writePubkey(data: Uint8Array, offset: number, address: string): void {
  data.set(new PublicKey(address).toBytes(), offset)
}

function writeU64(data: Uint8Array, offset: number, value: bigint): void {
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).writeBigUInt64LE(
    value,
    offset,
  )
}

function writeU128(data: Uint8Array, offset: number, value: bigint): void {
  for (let idx = 0; idx < 16; idx++) {
    data[offset + idx] = Number((value >> (8n * BigInt(idx))) & 0xffn)
  }
}

function makeAccount(address: string, data: Uint8Array): SolanaAccount {
  return {
    exists: true,
    address,
    lamports: 0n,
    programAddress: ALLBRIDGE_PROGRAM_ID,
    data,
  }
}

function makeUserDepositAccount(args: {
  address: string
  owner: string
  mint: string
  lpAmount: bigint
  rewardDebt: bigint
}): SolanaAccount {
  const data = new Uint8Array(USER_DEPOSIT_SIZE)
  writePubkey(data, USER_DEPOSIT_OWNER_OFFSET, args.owner)
  writePubkey(data, USER_DEPOSIT_MINT_OFFSET, args.mint)
  writeU64(data, USER_DEPOSIT_LP_AMOUNT_OFFSET, args.lpAmount)
  writeU64(data, USER_DEPOSIT_REWARD_DEBT_OFFSET, args.rewardDebt)
  return makeAccount(args.address, data)
}

function makePoolAccount(args: {
  address: string
  mint: string
  decimals: number
  accRewardPerShareP: bigint
}): SolanaAccount {
  const data = new Uint8Array(POOL_SIZE)
  writePubkey(data, POOL_MINT_OFFSET, args.mint)
  data[POOL_DECIMALS_OFFSET] = args.decimals
  writeU128(data, POOL_ACC_REWARD_PER_SHARE_P_OFFSET, args.accRewardPerShareP)
  return makeAccount(args.address, data)
}

async function getMockedPositions(tokens: TokenPlugin): Promise<
  ReturnType<typeof runIntegrations>
> {
  if (!getUserPositions) throw new Error('getUserPositions not implemented')

  const mint = makeAddress(7)
  const depositAddress = makeAddress(8)
  const poolAddress = makeAddress(9)

  const depositAccount = makeUserDepositAccount({
    address: depositAddress,
    owner: testAddress,
    mint,
    lpAmount: 2_000n,
    rewardDebt: 0n,
  })
  const poolAccount = makePoolAccount({
    address: poolAddress,
    mint,
    decimals: 6,
    accRewardPerShareP: 1n << REWARD_SHIFT_BITS,
  })

  return runIntegrations(
    [getUserPositions(testAddress, { endpoint: solanaRpcUrl, tokens })],
    async () => ({}),
    async (req: ProgramRequest): Promise<AccountsMap> => {
      if (req.kind !== 'getProgramAccounts') return {}

      const hasUserDepositSizeFilter = req.filters.some(
        (filter) => 'dataSize' in filter && filter.dataSize === USER_DEPOSIT_SIZE,
      )

      if (hasUserDepositSizeFilter) {
        return { [depositAddress]: depositAccount }
      }

      return { [poolAddress]: poolAccount }
    },
  )
}

describe('allbridge integration', () => {
  it('fetches user positions using getProgramAccounts only', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalAccountBatches = 0
    let totalAccountsFetched = 0
    let getProgramAccountsCalls = 0
    const otherProgramKinds = new Set<string>()

    const [positions] = await runIntegrations(
      [getUserPositions(testAddress, plugins)],
      async (addresses) => {
        totalAccountBatches++
        totalAccountsFetched += addresses.length
        console.log(
          `  account batch ${totalAccountBatches}: fetching ${addresses.length} accounts`,
        )
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => {
        if (req.kind === 'getProgramAccounts') {
          getProgramAccountsCalls++
        } else {
          otherProgramKinds.add(req.kind)
        }

        console.log(
          `  program request ${getProgramAccountsCalls}: kind=${req.kind} programId=${
            req.kind === 'getProgramAccounts' ? req.programId : 'n/a'
          }`,
        )
        return fetchProgramAccountsBatch(connection, req)
      },
    )

    if (!positions) throw new Error('No results returned')

    console.log(`\nFound ${positions.length} Allbridge positions`)
    console.log(
      `Address batches: ${totalAccountBatches}, accounts fetched: ${totalAccountsFetched}`,
    )
    console.log(`getProgramAccounts calls: ${getProgramAccountsCalls}`)

    if (positions.length > 0) {
      console.log('Sample position:', JSON.stringify(positions[0], null, 2))
    }

    expect(Array.isArray(positions)).toBe(true)
    expect(getProgramAccountsCalls).toBeGreaterThan(0)
    expect(totalAccountBatches).toBe(0)
    expect(otherProgramKinds.size).toBe(0)
  }, 60000)

  it('populates top-level pctUsdValueChange24 from eligible token components', async () => {
    const tokens = new TokenPlugin()
    const mint = makeAddress(7)
    tokens.set(mint, {
      mintAddress: mint,
      decimals: 6,
      priceUsd: 2,
      pctPriceChange24h: 4.5,
    })

    const [positions] = await getMockedPositions(tokens)
    if (!positions) throw new Error('No mocked positions returned')
    expect(positions).toHaveLength(1)
    expect(positions[0]?.usdValue).toBe('4.004')
    expect(positions[0]?.pctUsdValueChange24).toBe('4.5')
  })

  it('leaves pctUsdValueChange24 unset when no eligible component has token change data', async () => {
    const tokens = new TokenPlugin()
    const mint = makeAddress(7)
    tokens.set(mint, {
      mintAddress: mint,
      decimals: 6,
      priceUsd: 2,
    })

    const [positions] = await getMockedPositions(tokens)
    if (!positions) throw new Error('No mocked positions returned')
    expect(positions).toHaveLength(1)
    expect(positions[0]?.usdValue).toBe('4.004')
    expect(positions[0]?.pctUsdValueChange24).toBeUndefined()
  })
})
