import { type Connection, PublicKey } from '@solana/web3.js'

import type {
  AccountsMap,
  GetProgramAccountsRequest,
  ProgramRequest,
  SolanaAddress,
} from '../types/index'

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
 * Helius getProgramAccountsV2 — cursor-based pagination for programs with
 * potentially large account sets.
 */
async function fetchViaGetProgramAccountsV2(
  rpcUrl: string,
  req: GetProgramAccountsRequest,
): Promise<AccountsMap> {
  const map: AccountsMap = {}
  let paginationKey: string | null = null
  const seenPaginationKeys = new Set<string>()
  let page = 0

  do {
    if (paginationKey != null) {
      if (seenPaginationKeys.has(paginationKey)) break
      seenPaginationKeys.add(paginationKey)
    }

    const options: Record<string, unknown> = {
      encoding: 'base64',
      filters: req.filters,
      limit: 10000,
    }
    if (paginationKey != null) options.paginationKey = paginationKey

    const body = {
      jsonrpc: '2.0',
      id: `gpa-v2-${page++}`,
      method: 'getProgramAccountsV2',
      params: [req.programId, options],
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

    if (json.error)
      throw new Error(
        `[getProgramAccountsV2] ${req.programId}: ${json.error.message}`,
      )
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
  } while (paginationKey != null)

  return map
}

async function fetchViaGetProgramAccounts(
  connection: Connection,
  req: GetProgramAccountsRequest,
): Promise<AccountsMap> {
  const accounts = await connection.getProgramAccounts(
    new PublicKey(req.programId),
    {
      filters: req.filters,
      encoding: 'base64',
    },
  )

  const map: AccountsMap = {}
  for (const entry of accounts) {
    const addr = entry.pubkey.toBase58()
    map[addr] = {
      exists: true,
      address: addr,
      lamports: BigInt(entry.account.lamports),
      programAddress: entry.account.owner.toBase58(),
      data: new Uint8Array(entry.account.data as Buffer),
    }
  }

  return map
}

export async function fetchProgramAccountsBatch(
  connection: Connection,
  req: ProgramRequest,
): Promise<AccountsMap> {
  if (req.kind === 'getTokenAccountsByOwner') {
    const r = await connection.getTokenAccountsByOwner(
      new PublicKey(req.owner),
      {
        programId: new PublicKey(req.programId),
      },
    )
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

  try {
    return await fetchViaGetProgramAccountsV2(connection.rpcEndpoint, req)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('Method not found') ||
      message.includes('getProgramAccountsV2')
    ) {
      return fetchViaGetProgramAccounts(connection, req)
    }
    throw error
  }
}

export function createFetchAccounts(connection: Connection) {
  return (addresses: SolanaAddress[]) =>
    fetchAccountsBatch(connection, addresses)
}

export function createFetchProgramAccounts(connection: Connection) {
  return (req: ProgramRequest) => fetchProgramAccountsBatch(connection, req)
}
