import { Connection, PublicKey } from '@solana/web3.js'

import type { AccountsMap, GetProgramAccountsRequest, ProgramRequest, SolanaAddress } from '../types/index'

export async function fetchAccountsBatch(
  connection: Connection,
  addresses: SolanaAddress[],
): Promise<AccountsMap> {
  if (addresses.length === 0) return {}
  const pubkeys = addresses.map((a) => new PublicKey(a))
  const infos = await connection.getMultipleAccountsInfo(pubkeys)
  const map: AccountsMap = {}
  addresses.forEach((addr, i) => {
    const info = infos[i]
    map[addr] = info
      ? {
          exists: true,
          address: addr,
          lamports: BigInt(info.lamports),
          programAddress: info.owner.toBase58(),
          data: new Uint8Array(info.data as Buffer),
        }
      : { exists: false, address: addr }
  })
  return map
}

/**
 * Helius getProgramAccountsV2 — cursor-based pagination fallback for programs
 * with too many accounts (e.g. AMM v4).
 */
async function fetchViaGetProgramAccountsV2(
  rpcUrl: string,
  req: GetProgramAccountsRequest,
): Promise<AccountsMap> {
  const map: AccountsMap = {}
  let paginationKey: string | null = null
  let page = 0

  do {
    const body = {
      jsonrpc: '2.0',
      id: `gpa-v2-${page++}`,
      method: 'getProgramAccountsV2',
      params: [
        req.programId,
        {
          encoding: 'base64',
          filters: req.filters,
          limit: 10000,
          paginationKey,
        },
      ],
    }

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as {
      result?: {
        accounts: Array<{
          pubkey: string
          account: { lamports: number; owner: string; data: [string, string] }
        }>
        paginationKey: string | null
      }
      error?: { message: string }
    }

    if (json.error) throw new Error(json.error.message)
    if (!json.result) break

    for (const entry of json.result.accounts) {
      const addr = entry.pubkey
      const raw = Buffer.from(entry.account.data[0], 'base64')
      map[addr] = {
        exists: true,
        address: addr,
        lamports: BigInt(entry.account.lamports),
        programAddress: entry.account.owner,
        data: new Uint8Array(raw),
      }
    }

    paginationKey = json.result.paginationKey
    // Stop when no accounts returned or no more pages
    if (json.result.accounts.length === 0) break
  } while (paginationKey != null)

  return map
}

export async function fetchProgramAccountsBatch(
  connection: Connection,
  req: ProgramRequest,
): Promise<AccountsMap> {
  if (req.kind === 'getTokenAccountsByOwner') {
    const r = await connection.getTokenAccountsByOwner(new PublicKey(req.owner), {
      programId: new PublicKey(req.programId),
    })
    const map: AccountsMap = {}
    for (const v of r.value) {
      const addr = v.pubkey.toBase58()
      map[addr] = {
        exists: true,
        address: addr,
        lamports: BigInt(v.account.lamports),
        programAddress: v.account.owner.toBase58(),
        data: new Uint8Array(v.account.data as Buffer),
      }
    }
    return map
  }

  // getProgramAccounts — try standard first, fall back to V2 on deprioritization
  try {
    const results = await connection.getProgramAccounts(new PublicKey(req.programId), {
      filters: req.filters as any,
    })
    const map: AccountsMap = {}
    for (const { pubkey, account } of results) {
      const addr = pubkey.toBase58()
      map[addr] = {
        exists: true,
        address: addr,
        lamports: BigInt(account.lamports),
        programAddress: account.owner.toBase58(),
        data: new Uint8Array(account.data as Buffer),
      }
    }
    return map
  } catch (err: any) {
    const msg: string = err?.message ?? ''
    if (!msg.includes('deprioritized')) throw err
    console.log(`[solana] falling back to getProgramAccountsV2 for ${req.programId}`)
    return fetchViaGetProgramAccountsV2(connection.rpcEndpoint, req)
  }
}

export function createFetchAccounts(connection: Connection) {
  return (addresses: SolanaAddress[]) => fetchAccountsBatch(connection, addresses)
}

export function createFetchProgramAccounts(connection: Connection) {
  return (req: ProgramRequest) => fetchProgramAccountsBatch(connection, req)
}
