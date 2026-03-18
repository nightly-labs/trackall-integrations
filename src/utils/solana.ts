import { Connection, PublicKey } from '@solana/web3.js'

import type { AccountsMap, GetProgramAccountsRequest, SolanaAddress } from '../types/index'

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

export async function fetchProgramAccountsBatch(
  connection: Connection,
  req: GetProgramAccountsRequest,
): Promise<AccountsMap> {
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
}

export function createFetchAccounts(connection: Connection) {
  return (addresses: SolanaAddress[]) => fetchAccountsBatch(connection, addresses)
}

export function createFetchProgramAccounts(connection: Connection) {
  return (req: GetProgramAccountsRequest) => fetchProgramAccountsBatch(connection, req)
}
