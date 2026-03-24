import { createHash } from 'node:crypto'
import { BorshCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import type {
  LendingDefiPosition,
  ProgramRequest,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'
import bundleV1Idl from './idls/bundle-v1.json'
import bundleV2Idl from './idls/bundle-v2.json'
import driftVaultIdl from './idls/drift-vaults.json'
import neutralVaults from './vaults.json'

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

const BUNDLE_PROGRAM_ID_V1 = 'BUNDDh4P5XviMm1f3gCvnq2qKx6TGosAGnoUK12e7cXU'
const BUNDLE_PROGRAM_ID_V2 = 'BUNDeH5A4c47bcEoAjBhN3sCjLgYnRsmt9ibMztqVkC9'
const DRIFT_VAULT_PROGRAM_ID_DEFAULT =
  'vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR'

const BUNDLE_SEED_USER = Buffer.from('USER_BUNDLE')
const BUNDLE_SEED_ORACLE = Buffer.from('ORACLE')
const DRIFT_DEPOSITOR_AUTHORITY_OFFSET = 8 + 32 + 32
const RPC_CACHE_TTL_MS = 5 * 60 * 1000

const TOKEN_BY_SYMBOL: Record<string, { token: string; decimals: number }> = {
  USDC: { token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  USDT: { token: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  SOL: { token: 'So11111111111111111111111111111111111111112', decimals: 9 },
}

interface NeutralVault {
  vaultId: number
  name: string
  subname?: string
  type: 'Bundle' | 'Drift' | 'Kamino' | 'Hyperliquid'
  category: string
  vaultAddress: string
  depositToken: string
  pfee?: number
  driftProgramId?: string
  bundleProgramId?: string
}

const SUPPORTED_VAULTS = (neutralVaults as NeutralVault[]).filter(
  (vault) => vault.type === 'Bundle' || vault.type === 'Drift',
)

const BUNDLE_VAULTS = SUPPORTED_VAULTS.filter(
  (vault): vault is NeutralVault & { type: 'Bundle' } => vault.type === 'Bundle',
)
const DRIFT_VAULTS = SUPPORTED_VAULTS.filter(
  (vault): vault is NeutralVault & { type: 'Drift' } => vault.type === 'Drift',
)

const DRIFT_PROGRAM_IDS = Array.from(
  new Set([
    DRIFT_VAULT_PROGRAM_ID_DEFAULT,
    ...DRIFT_VAULTS.flatMap((vault) =>
      vault.driftProgramId ? [vault.driftProgramId] : [],
    ),
  ]),
)

export const PROGRAM_IDS = [
  BUNDLE_PROGRAM_ID_V1,
  BUNDLE_PROGRAM_ID_V2,
  ...DRIFT_PROGRAM_IDS,
]

function normalizeLegacyIdl<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeLegacyIdl(entry)) as T
  }
  if (value && typeof value === 'object') {
    if (
      'defined' in value &&
      typeof (value as { defined?: unknown }).defined === 'string'
    ) {
      return {
        ...(value as Record<string, unknown>),
        defined: {
          name: (value as { defined: string }).defined,
        },
      } as T
    }

    const entries = Object.entries(value).map(([key, entry]) => [
      key,
      normalizeLegacyIdl(entry),
    ])
    return Object.fromEntries(entries) as T
  }
  if (value === 'publicKey') return 'pubkey' as T
  return value
}

function ensureIdlTypes(idl: Record<string, unknown>) {
  const accounts = idl.accounts
  if (!Array.isArray(accounts)) return idl

  const accountTypes = accounts
    .filter(
      (account): account is { name: string; type: unknown } =>
        !!account &&
        typeof account === 'object' &&
        'name' in account &&
        'type' in account &&
        typeof (account as { name: unknown }).name === 'string',
    )
    .map((account) => ({
      name: account.name,
      type: account.type,
    }))

  const existingTypes = Array.isArray(idl.types)
    ? (idl.types as Array<{ name?: string }>)
    : []
  const existingNames = new Set(existingTypes.map((type) => type.name))
  const mergedTypes = [
    ...existingTypes,
    ...accountTypes.filter((type) => !existingNames.has(type.name)),
  ]

  return {
    ...idl,
    types: mergedTypes,
  }
}

const bundleV1Coder = new BorshCoder(
  ensureIdlTypes(
    normalizeLegacyIdl({
      ...(bundleV1Idl as Record<string, unknown>),
      instructions: [],
      events: [],
    }) as Record<string, unknown>,
  ) as never,
)
const bundleV2Coder = new BorshCoder(bundleV2Idl as never)
const driftVaultCoder = new BorshCoder(
  ensureIdlTypes(
    normalizeLegacyIdl({
      ...(driftVaultIdl as Record<string, unknown>),
      instructions: [],
      events: [],
    }) as Record<string, unknown>,
  ) as never,
)

const BUNDLE_DISC_USER_B64 = discriminatorBase64('UserBundleAccount')
const BUNDLE_DISC_BUNDLE_B64 = discriminatorBase64('Bundle')
const BUNDLE_DISC_ORACLE_B64 = discriminatorBase64('OracleData')
const DRIFT_DISC_VAULT_DEPOSITOR_B64 = discriminatorBase64('VaultDepositor')
const DRIFT_DISC_VAULT_B64 = discriminatorBase64('Vault')

function discriminatorBase64(accountName: string) {
  return Buffer.from(
    createHash('sha256')
      .update(`account:${accountName}`)
      .digest()
      .subarray(0, 8),
  ).toString('base64')
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return BigInt(String(value))
  }
  return 0n
}

function toNumberish(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value === 'object' && 'toString' in value) {
    return Number(String(value))
  }
  return 0
}

function toAddress(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (value instanceof PublicKey) return value.toBase58()
  if (typeof value === 'object' && 'toBase58' in value) {
    return String((value as { toBase58: () => string }).toBase58())
  }
  if (typeof value === 'object' && 'toString' in value) {
    return String(value)
  }
  return undefined
}

function withUnderscore<T extends Record<string, unknown>>(
  value: T,
  camel: string,
  snake: string,
): unknown {
  return camel in value ? value[camel] : value[snake]
}

function hasDiscriminator(data: Uint8Array, discB64: string): boolean {
  if (data.length < 8) return false
  return Buffer.from(data.subarray(0, 8)).toString('base64') === discB64
}

function buildUsdValue(
  amountRaw: bigint,
  decimals: number,
  priceUsd?: number,
): string | undefined {
  if (priceUsd === undefined) return undefined
  if (amountRaw > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
  return ((Number(amountRaw) / 10 ** decimals) * priceUsd).toString()
}

function buildLendingPosition(
  token: string,
  amountRaw: bigint,
  decimals: number,
  platformMeta: Record<string, unknown>,
  tokens: SolanaPlugins['tokens'],
): LendingDefiPosition {
  const tokenData = tokens.get(token)
  const priceUsd = tokenData?.priceUsd
  const usdValue = buildUsdValue(amountRaw, decimals, priceUsd)

  return {
    platformId: 'neutral',
    positionKind: 'lending',
    supplied: [
      {
        amount: {
          token,
          amount: amountRaw.toString(),
          decimals: decimals.toString(),
        },
        ...(priceUsd !== undefined && { priceUsd: priceUsd.toString() }),
        ...(usdValue !== undefined && { usdValue }),
      },
    ],
    ...(usdValue !== undefined && { usdValue }),
    meta: {
      neutral: platformMeta,
    },
  }
}

function deriveBundleUserPda(
  userAddress: string,
  vaultAddress: string,
  programId: string,
): string {
  return PublicKey.findProgramAddressSync(
    [
      BUNDLE_SEED_USER,
      new PublicKey(userAddress).toBuffer(),
      new PublicKey(vaultAddress).toBuffer(),
    ],
    new PublicKey(programId),
  )[0].toBase58()
}

function deriveBundleOraclePda(vaultAddress: string, programId: string): string {
  return PublicKey.findProgramAddressSync(
    [BUNDLE_SEED_ORACLE, new PublicKey(vaultAddress).toBuffer()],
    new PublicKey(programId),
  )[0].toBase58()
}

export const neutralIntegration: SolanaIntegration = {
  platformId: 'neutral',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const authority = new PublicKey(address)

    const requests: ProgramRequest[] = [
      {
        kind: 'getProgramAccounts' as const,
        programId: BUNDLE_PROGRAM_ID_V1,
        cacheTtlMs: RPC_CACHE_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: BUNDLE_DISC_USER_B64,
              encoding: 'base64' as const,
            },
          },
          {
            memcmp: {
              offset: 8,
              bytes: authority.toBase58(),
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: BUNDLE_PROGRAM_ID_V1,
        cacheTtlMs: RPC_CACHE_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: BUNDLE_DISC_BUNDLE_B64,
              encoding: 'base64' as const,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: BUNDLE_PROGRAM_ID_V1,
        cacheTtlMs: RPC_CACHE_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: BUNDLE_DISC_ORACLE_B64,
              encoding: 'base64' as const,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: BUNDLE_PROGRAM_ID_V2,
        cacheTtlMs: RPC_CACHE_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: BUNDLE_DISC_USER_B64,
              encoding: 'base64' as const,
            },
          },
          {
            memcmp: {
              offset: 8,
              bytes: authority.toBase58(),
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: BUNDLE_PROGRAM_ID_V2,
        cacheTtlMs: RPC_CACHE_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: BUNDLE_DISC_BUNDLE_B64,
              encoding: 'base64' as const,
            },
          },
        ],
      },
      {
        kind: 'getProgramAccounts' as const,
        programId: BUNDLE_PROGRAM_ID_V2,
        cacheTtlMs: RPC_CACHE_TTL_MS,
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: BUNDLE_DISC_ORACLE_B64,
              encoding: 'base64' as const,
            },
          },
        ],
      },
      ...DRIFT_PROGRAM_IDS.flatMap((programId) => [
        {
          kind: 'getProgramAccounts' as const,
          programId,
          cacheTtlMs: RPC_CACHE_TTL_MS,
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: DRIFT_DISC_VAULT_DEPOSITOR_B64,
                encoding: 'base64' as const,
              },
            },
            {
              memcmp: {
                offset: DRIFT_DEPOSITOR_AUTHORITY_OFFSET,
                bytes: authority.toBase58(),
              },
            },
          ],
        },
        {
          kind: 'getProgramAccounts' as const,
          programId,
          cacheTtlMs: RPC_CACHE_TTL_MS,
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: DRIFT_DISC_VAULT_B64,
                encoding: 'base64' as const,
              },
            },
          ],
        },
      ]),
    ]

    const accountsMap = yield requests

    const bundleUsersByProgram = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const bundleByProgramAndAddress = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const oracleByProgramAndAddress = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const driftVaultByProgramAndAddress = new Map<
      string,
      Map<string, Record<string, unknown>>
    >()
    const driftDepositorByProgram = new Map<
      string,
      Array<Record<string, unknown>>
    >()

    for (const account of Object.values(accountsMap)) {
      if (!account.exists || account.data.length < 8) continue

      const programId = account.programAddress
      const data = account.data

      if (programId === BUNDLE_PROGRAM_ID_V1 || programId === BUNDLE_PROGRAM_ID_V2) {
        const coder = programId === BUNDLE_PROGRAM_ID_V2 ? bundleV2Coder : bundleV1Coder

        if (hasDiscriminator(data, BUNDLE_DISC_USER_B64)) {
          try {
            const decoded = coder.accounts.decode(
              'UserBundleAccount',
              Buffer.from(data),
            ) as Record<string, unknown>
            const users = bundleUsersByProgram.get(programId) ?? new Map()
            users.set(account.address, decoded)
            bundleUsersByProgram.set(programId, users)
          } catch {
            // Skip malformed account.
          }
          continue
        }

        if (hasDiscriminator(data, BUNDLE_DISC_BUNDLE_B64)) {
          try {
            const decoded = coder.accounts.decode(
              'Bundle',
              Buffer.from(data),
            ) as Record<string, unknown>
            const bundles = bundleByProgramAndAddress.get(programId) ?? new Map()
            bundles.set(account.address, decoded)
            bundleByProgramAndAddress.set(programId, bundles)
          } catch {
            // Skip malformed account.
          }
          continue
        }

        if (hasDiscriminator(data, BUNDLE_DISC_ORACLE_B64)) {
          try {
            const decoded = coder.accounts.decode(
              'OracleData',
              Buffer.from(data),
            ) as Record<string, unknown>
            const oracles = oracleByProgramAndAddress.get(programId) ?? new Map()
            oracles.set(account.address, decoded)
            oracleByProgramAndAddress.set(programId, oracles)
          } catch {
            // Skip malformed account.
          }
        }

        continue
      }

      if (DRIFT_PROGRAM_IDS.includes(programId)) {
        if (hasDiscriminator(data, DRIFT_DISC_VAULT_B64)) {
          try {
            const decoded = driftVaultCoder.accounts.decode(
              'Vault',
              Buffer.from(data),
            ) as Record<string, unknown>
            const vaults = driftVaultByProgramAndAddress.get(programId) ?? new Map()
            vaults.set(account.address, decoded)
            driftVaultByProgramAndAddress.set(programId, vaults)
          } catch {
            // Skip malformed account.
          }
          continue
        }

        if (hasDiscriminator(data, DRIFT_DISC_VAULT_DEPOSITOR_B64)) {
          try {
            const decoded = driftVaultCoder.accounts.decode(
              'VaultDepositor',
              Buffer.from(data),
            ) as Record<string, unknown>
            const depositors = driftDepositorByProgram.get(programId) ?? []
            depositors.push(decoded)
            driftDepositorByProgram.set(programId, depositors)
          } catch {
            // Skip malformed account.
          }
        }
      }
    }

    const positions: UserDefiPosition[] = []

    for (const vault of BUNDLE_VAULTS) {
      const programId = vault.bundleProgramId ?? BUNDLE_PROGRAM_ID_V1
      const userAccountAddress = deriveBundleUserPda(address, vault.vaultAddress, programId)
      const oracleAddress = deriveBundleOraclePda(vault.vaultAddress, programId)

      const user = bundleUsersByProgram.get(programId)?.get(userAccountAddress)
      const bundle = bundleByProgramAndAddress.get(programId)?.get(vault.vaultAddress)
      const oracle = oracleByProgramAndAddress.get(programId)?.get(oracleAddress)
      if (!user || !bundle || !oracle) continue

      const userShares = toBigInt(user.shares)
      const pendingDepositRaw = toBigInt(
        withUnderscore(user, 'pendingDeposit', 'pending_deposit'),
      )
      const totalShares = toBigInt(withUnderscore(bundle, 'totalShares', 'total_shares'))
      const oracleEquity = toBigInt(
        withUnderscore(oracle, 'averageExternalEquity', 'average_external_equity'),
      )
      const underlyingBalance = toBigInt(
        withUnderscore(bundle, 'bundleUnderlyingBalance', 'bundle_underlying_balance'),
      )
      const activeBalanceRaw =
        userShares > 0n && totalShares > 0n
          ? ((oracleEquity + underlyingBalance) * userShares) / totalShares
          : 0n

      if (activeBalanceRaw <= 0n && pendingDepositRaw <= 0n) continue

      const assetToken =
        toAddress(withUnderscore(bundle, 'assetAddress', 'asset_address')) ??
        TOKEN_BY_SYMBOL[vault.depositToken]?.token ??
        vault.depositToken
      const assetDecimals =
        toNumberish(withUnderscore(bundle, 'assetDecimals', 'asset_decimals')) ||
        TOKEN_BY_SYMBOL[vault.depositToken]?.decimals ||
        6

      const suppliedRaw = activeBalanceRaw + pendingDepositRaw

      positions.push(
        buildLendingPosition(
          assetToken,
          suppliedRaw,
          assetDecimals,
          {
            vaultId: vault.vaultId,
            vaultType: vault.type,
            vaultName: vault.name,
            subname: vault.subname,
            category: vault.category,
            vaultAddress: vault.vaultAddress,
            bundleProgramId: programId,
            source: 'bundle',
            accounting: {
              activeBalanceRaw: activeBalanceRaw.toString(),
              pendingDepositRaw: pendingDepositRaw.toString(),
              userShares: userShares.toString(),
              totalShares: totalShares.toString(),
            },
          },
          tokens,
        ),
      )
    }

    const driftVaultsByAddress = new Map(DRIFT_VAULTS.map((v) => [v.vaultAddress, v]))

    for (const [programId, depositors] of driftDepositorByProgram) {
      const vaultAccounts = driftVaultByProgramAndAddress.get(programId) ?? new Map()

      for (const depositor of depositors) {
        const depositorVaultAddress = toAddress(depositor.vault)
        if (!depositorVaultAddress) continue

        const vault = driftVaultsByAddress.get(depositorVaultAddress)
        if (!vault) continue

        const vaultAccount = vaultAccounts.get(vault.vaultAddress)
        if (!vaultAccount) continue

        const netDepositsRaw = toBigInt(depositor.netDeposits)
        const withdrawRequestRaw = toBigInt(
          ((depositor.lastWithdrawRequest as Record<string, unknown> | undefined)
            ?.value ?? 0) as unknown,
        )
        const suppliedRaw = netDepositsRaw - withdrawRequestRaw

        if (suppliedRaw <= 0n) continue

        const tokenInfo = TOKEN_BY_SYMBOL[vault.depositToken]
        const token = tokenInfo?.token ?? vault.depositToken
        const decimals = tokenInfo?.decimals ?? 6

        positions.push(
          buildLendingPosition(
            token,
            suppliedRaw,
            decimals,
            {
              vaultId: vault.vaultId,
              vaultType: vault.type,
              vaultName: vault.name,
              subname: vault.subname,
              category: vault.category,
              vaultAddress: vault.vaultAddress,
              driftProgramId: programId,
              source: 'drift',
              valuationMode: 'accounting',
              accounting: {
                netDepositsRaw: netDepositsRaw.toString(),
                withdrawRequestRaw: withdrawRequestRaw.toString(),
                vaultShares: toBigInt(depositor.vaultShares).toString(),
                totalVaultShares: toBigInt(vaultAccount.totalShares).toString(),
              },
            },
            tokens,
          ),
        )
      }
    }

    return positions
  },
}

export default neutralIntegration
