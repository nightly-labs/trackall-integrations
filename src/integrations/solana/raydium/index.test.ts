import { describe, expect, it } from 'bun:test'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, PublicKey } from '@solana/web3.js'
import type { AccountsMap, ProgramRequest } from '../../../types/index'
import { runIntegrations, TokenPlugin } from '../../../types/index'
import {
  fetchAccountsBatch,
  fetchProgramAccountsBatch,
} from '../../../utils/solana'
import clmmIdl from './idls/amm_v3.json'
import { raydiumIntegration } from './index'

const solanaRpcUrl =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const wallet = '93PSyNrS7zBhrXaHHfU1ZtfegcKq5SaCYc35ZwPVrK3K'

const { getUserPositions } = raydiumIntegration
if (!getUserPositions) throw new Error('getUserPositions not implemented')

function buildTokenAccountData(mint: PublicKey, amount: bigint): Uint8Array {
  const buf = Buffer.alloc(165, 0)
  mint.toBuffer().copy(buf, 0)
  buf.writeBigUInt64LE(amount, 64)
  return new Uint8Array(buf)
}

describe('raydium integration', () => {
  it('uses split mint sources: SPL for CP/AMM and Token-2022 for CLMM', async () => {
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    const splMint = new PublicKey('So11111111111111111111111111111111111111112')
    const token2022Mint = new PublicKey(
      'Es9vMFrzaCER8f6A2QxYDs2fzGEGZm4G6dkprdFM5oc',
    )

    const clmmProgram = new PublicKey((clmmIdl as { address: string }).address)
    const [splClmmPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), splMint.toBuffer()],
      clmmProgram,
    )
    const [token2022ClmmPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position'), token2022Mint.toBuffer()],
      clmmProgram,
    )

    let capturedPhase2Addresses: string[] = []
    const queriedMints = new Set<string>()
    let getProgramAccountsCalls = 0

    const [positions] = await runIntegrations(
      [getUserPositions(wallet, plugins)],
      async (addresses) => {
        if (addresses.length > 0) capturedPhase2Addresses = [...addresses]
        return {}
      },
      async (req: ProgramRequest): Promise<AccountsMap> => {
        if (req.kind === 'getTokenAccountsByOwner') {
          if (req.programId === TOKEN_PROGRAM_ID.toBase58()) {
            return {
              splAta: {
                exists: true,
                address: 'splAta',
                lamports: 0n,
                programAddress: TOKEN_PROGRAM_ID.toBase58(),
                data: buildTokenAccountData(splMint, 5n),
              },
            }
          }
          if (req.programId === TOKEN_2022_PROGRAM_ID.toBase58()) {
            return {
              token2022Ata: {
                exists: true,
                address: 'token2022Ata',
                lamports: 0n,
                programAddress: TOKEN_2022_PROGRAM_ID.toBase58(),
                data: buildTokenAccountData(token2022Mint, 7n),
              },
            }
          }
          return {}
        }

        if (req.kind !== 'getProgramAccounts') return {}

        getProgramAccountsCalls++
        const mintFilter = req.filters.find(
          (f: (typeof req.filters)[number]) =>
            'memcmp' in f && f.memcmp.offset !== 0,
        )
        if (mintFilter && 'memcmp' in mintFilter) {
          queriedMints.add(mintFilter.memcmp.bytes)
        }
        return {}
      },
    )

    expect(positions).toEqual([])
    expect(getProgramAccountsCalls).toBe(2)
    expect(queriedMints.has(splMint.toBase58())).toBe(true)
    expect(queriedMints.has(token2022Mint.toBase58())).toBe(false)
    expect(capturedPhase2Addresses).toEqual([token2022ClmmPda.toBase58()])
    expect(capturedPhase2Addresses.includes(splClmmPda.toBase58())).toBe(false)
  })

  it('fetches user positions from Raydium CLMM + CP', async () => {
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const tokens = new TokenPlugin()
    const plugins = { endpoint: solanaRpcUrl, tokens }

    let totalBatches = 0
    let totalAccounts = 0
    let getProgramAccountsCalls = 0
    let getTokenAccountsByOwnerCalls = 0

    const [positions] = await runIntegrations(
      [getUserPositions(wallet, plugins)],
      async (addresses) => {
        totalBatches++
        totalAccounts += addresses.length
        console.log(
          `  batch ${totalBatches}: fetching ${addresses.length} accounts`,
        )
        return fetchAccountsBatch(connection, addresses)
      },
      (req) => {
        if (req.kind === 'getProgramAccounts') {
          getProgramAccountsCalls++
        } else if (req.kind === 'getTokenAccountsByOwner') {
          getTokenAccountsByOwnerCalls++
        }
        return fetchProgramAccountsBatch(connection, req)
      },
    )

    if (!positions) throw new Error('No results returned')

    const liquidityPositions = positions.filter(
      (p) => p.positionKind === 'liquidity',
    )

    console.log(`\nFound ${positions.length} Raydium positions`)
    console.log(
      `RPC batches: ${totalBatches}, total accounts fetched: ${totalAccounts}`,
    )
    console.log(
      `Program requests: getProgramAccounts=${getProgramAccountsCalls}, getTokenAccountsByOwner=${getTokenAccountsByOwnerCalls}`,
    )
    console.log('Sample position:', JSON.stringify(liquidityPositions, null, 2))

    expect(Array.isArray(positions)).toBe(true)
    expect(getProgramAccountsCalls).toBe(0)
    expect(getTokenAccountsByOwnerCalls).toBe(2)
  }, 1800000)
})
