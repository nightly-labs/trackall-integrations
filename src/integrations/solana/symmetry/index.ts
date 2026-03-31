import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import type {
  ConstantProductLiquidityDefiPosition,
  MaybeSolanaAccount,
  PositionValue,
  SolanaIntegration,
  SolanaPlugins,
  UserDefiPosition,
  UserPositionsPlan,
} from '../../../types/index'

const SYMMETRY_VAULTS_V3_PROGRAM_ID =
  'BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate'

const TOKEN_ACCOUNT_MINT_OFFSET = 0
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64

const MINT_ACCOUNT_MINT_AUTHORITY_OPTION_OFFSET = 0
const MINT_ACCOUNT_MINT_AUTHORITY_OFFSET = 4
const MINT_ACCOUNT_DECIMALS_OFFSET = 44

const VAULT_DISCRIMINATOR_BYTES = 8
const VAULT_VERSION_OFFSET = 0
const VAULT_MINT_OFFSET = 33
const VAULT_SUPPLY_OUTSTANDING_OFFSET = 65
const VAULT_NUM_TOKENS_OFFSET = 1750
const VAULT_COMPOSITION_OFFSET = 1751
const VAULT_MAX_TOKENS = 100

const ASSET_STRIDE = 289
const ASSET_MINT_OFFSET = 0
const ASSET_AMOUNT_OFFSET = 32
const ASSET_WEIGHT_OFFSET = 40
const ASSET_ACTIVE_OFFSET = 42

const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111'
const VAULT_PDA_SEED = Buffer.from('basket')

type DecodedVaultAsset = {
  mint: string
  amountRaw: bigint
  weightBps: number
}

type DecodedVault = {
  version: number
  mint: string
  supplyOutstandingRaw: bigint
  assets: DecodedVaultAsset[]
}

export const testAddress = 'tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd'

export const PROGRAM_IDS = [
  SYMMETRY_VAULTS_V3_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
] as const

function readPubkey(data: Uint8Array, offset: number): string | null {
  if (data.length < offset + 32) return null
  return new PublicKey(data.slice(offset, offset + 32)).toBase58()
}

function readU16(data: Uint8Array, offset: number): number | null {
  if (data.length < offset + 2) return null
  return Buffer.from(data).readUInt16LE(offset)
}

function readU32(data: Uint8Array, offset: number): number | null {
  if (data.length < offset + 4) return null
  return Buffer.from(data).readUInt32LE(offset)
}

function readU64(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null
  return Buffer.from(data).readBigUInt64LE(offset)
}

function readMintDecimals(account: MaybeSolanaAccount | undefined): number | null {
  if (!account?.exists) return null
  if (
    account.programAddress !== TOKEN_PROGRAM_ID.toBase58() &&
    account.programAddress !== TOKEN_2022_PROGRAM_ID.toBase58()
  ) {
    return null
  }

  if (account.data.length <= MINT_ACCOUNT_DECIMALS_OFFSET) return null
  return account.data[MINT_ACCOUNT_DECIMALS_OFFSET] ?? null
}

function readMintAuthority(account: MaybeSolanaAccount | undefined): string | null {
  if (!account?.exists) return null
  if (
    account.programAddress !== TOKEN_PROGRAM_ID.toBase58() &&
    account.programAddress !== TOKEN_2022_PROGRAM_ID.toBase58()
  ) {
    return null
  }

  const option = readU32(account.data, MINT_ACCOUNT_MINT_AUTHORITY_OPTION_OFFSET)
  if (option === null || option === 0) return null

  return readPubkey(account.data, MINT_ACCOUNT_MINT_AUTHORITY_OFFSET)
}

function decodeVault(accountData: Uint8Array): DecodedVault | null {
  if (accountData.length <= VAULT_DISCRIMINATOR_BYTES) return null

  const data = accountData.slice(VAULT_DISCRIMINATOR_BYTES)
  if (data.length < VAULT_COMPOSITION_OFFSET) return null

  const version = data[VAULT_VERSION_OFFSET] ?? 0
  const mint = readPubkey(data, VAULT_MINT_OFFSET)
  const supplyOutstandingRaw = readU64(data, VAULT_SUPPLY_OUTSTANDING_OFFSET)
  const numTokens = data[VAULT_NUM_TOKENS_OFFSET] ?? 0

  if (!mint || supplyOutstandingRaw === null) return null
  if (numTokens > VAULT_MAX_TOKENS) return null

  const requiredLength = VAULT_COMPOSITION_OFFSET + numTokens * ASSET_STRIDE
  if (data.length < requiredLength) return null

  const assets: DecodedVaultAsset[] = []
  for (let index = 0; index < numTokens; index++) {
    const base = VAULT_COMPOSITION_OFFSET + index * ASSET_STRIDE

    const active = data[base + ASSET_ACTIVE_OFFSET] ?? 0
    if (active !== 1) continue

    const assetMint = readPubkey(data, base + ASSET_MINT_OFFSET)
    const amountRaw = readU64(data, base + ASSET_AMOUNT_OFFSET)
    const weightBps = readU16(data, base + ASSET_WEIGHT_OFFSET)

    if (!assetMint || amountRaw === null || weightBps === null) continue
    if (assetMint === SYSTEM_PROGRAM_ADDRESS) continue
    if (amountRaw === 0n) continue

    assets.push({ mint: assetMint, amountRaw, weightBps })
  }

  return {
    version,
    mint,
    supplyOutstandingRaw,
    assets,
  }
}

function toUiAmountString(amountRaw: bigint, decimals: number): string {
  if (decimals <= 0) return amountRaw.toString()

  const scale = 10n ** BigInt(decimals)
  const whole = amountRaw / scale
  const fraction = amountRaw % scale
  if (fraction === 0n) return whole.toString()

  const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fractionString}`
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

  if (priceUsd !== undefined) {
    value.priceUsd = priceUsd.toString()
    const uiAmount = Number(toUiAmountString(amountRaw, decimals))
    if (Number.isFinite(uiAmount)) {
      value.usdValue = (uiAmount * priceUsd).toString()
    }
  }

  return value
}

function sumUsdValues(values: Array<string | undefined>): string | undefined {
  const present = values
    .filter((value): value is string => value !== undefined)
    .map(Number)

  if (present.length === 0) return undefined
  return present.reduce((sum, value) => sum + value, 0).toString()
}

export const symmetryIntegration: SolanaIntegration = {
  platformId: 'symmetry',

  getUserPositions: async function* (
    address: string,
    { tokens }: SolanaPlugins,
  ): UserPositionsPlan {
    const wallet = new PublicKey(address)

    const phase0Map = yield [
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: wallet.toBase58(),
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      {
        kind: 'getTokenAccountsByOwner' as const,
        owner: wallet.toBase58(),
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      },
    ]

    const userVaultBalancesByMint = new Map<string, bigint>()

    for (const account of Object.values(phase0Map)) {
      if (!account.exists) continue

      if (
        account.programAddress !== TOKEN_PROGRAM_ID.toBase58() &&
        account.programAddress !== TOKEN_2022_PROGRAM_ID.toBase58()
      ) {
        continue
      }

      const mint = readPubkey(account.data, TOKEN_ACCOUNT_MINT_OFFSET)
      const amountRaw = readU64(account.data, TOKEN_ACCOUNT_AMOUNT_OFFSET)
      if (!mint || amountRaw === null || amountRaw <= 0n) continue

      userVaultBalancesByMint.set(
        mint,
        (userVaultBalancesByMint.get(mint) ?? 0n) + amountRaw,
      )
    }

    if (userVaultBalancesByMint.size === 0) return []

    const derivedVaultByMint = new Map<string, string>()
    for (const mint of userVaultBalancesByMint.keys()) {
      const [vaultAddress] = PublicKey.findProgramAddressSync(
        [VAULT_PDA_SEED, new PublicKey(mint).toBuffer()],
        new PublicKey(SYMMETRY_VAULTS_V3_PROGRAM_ID),
      )
      derivedVaultByMint.set(mint, vaultAddress.toBase58())
    }

    const phase1Map = yield [...derivedVaultByMint.values()]

    const matchedVaultByMint = new Map<string, string>()
    for (const [mint, vaultAddress] of derivedVaultByMint.entries()) {
      const vaultAccount = phase1Map[vaultAddress]
      if (!vaultAccount?.exists) continue
      if (vaultAccount.programAddress !== SYMMETRY_VAULTS_V3_PROGRAM_ID) continue
      matchedVaultByMint.set(mint, vaultAddress)
    }

    if (matchedVaultByMint.size === 0) return []

    const phase2Map = yield [...matchedVaultByMint.keys()]

    const vaultSnapshots: Array<{
      vaultAddress: string
      vaultMint: string
      vaultVersion: number
      lpDecimals: number
      userLpAmountRaw: bigint
      supplyOutstandingRaw: bigint
      assets: DecodedVaultAsset[]
    }> = []

    const underlyingMintSet = new Set<string>()

    for (const [mint, vaultAddress] of matchedVaultByMint.entries()) {
      const mintAccount = phase2Map[mint]
      const lpDecimals = readMintDecimals(mintAccount)
      const mintAuthority = readMintAuthority(mintAccount)
      if (lpDecimals === null || mintAuthority !== vaultAddress) continue

      const vaultAccount = phase1Map[vaultAddress]
      if (!vaultAccount?.exists) continue
      if (vaultAccount.programAddress !== SYMMETRY_VAULTS_V3_PROGRAM_ID) continue

      const decodedVault = decodeVault(vaultAccount.data)
      if (!decodedVault) continue
      if (decodedVault.mint !== mint) continue
      if (decodedVault.supplyOutstandingRaw === 0n) continue

      for (const asset of decodedVault.assets) {
        underlyingMintSet.add(asset.mint)
      }

      vaultSnapshots.push({
        vaultAddress,
        vaultMint: mint,
        vaultVersion: decodedVault.version,
        lpDecimals,
        userLpAmountRaw: userVaultBalancesByMint.get(mint) ?? 0n,
        supplyOutstandingRaw: decodedVault.supplyOutstandingRaw,
        assets: decodedVault.assets,
      })
    }

    if (vaultSnapshots.length === 0) return []

    const underlyingMints = [...underlyingMintSet]
    const phase3Map =
      underlyingMints.length > 0
        ? yield underlyingMints
        : ({} as Record<string, MaybeSolanaAccount>)

    const positions: ConstantProductLiquidityDefiPosition[] = []

    for (const snapshot of vaultSnapshots) {
      if (snapshot.userLpAmountRaw <= 0n) continue

      const poolTokens: PositionValue[] = []

      for (const asset of snapshot.assets) {
        const userAmountRaw =
          (asset.amountRaw * snapshot.userLpAmountRaw) /
          snapshot.supplyOutstandingRaw

        if (userAmountRaw <= 0n) continue

        const decimals =
          readMintDecimals(phase3Map[asset.mint]) ??
          tokens.get(asset.mint)?.decimals ??
          0
        const tokenInfo = tokens.get(asset.mint)

        poolTokens.push(
          buildPositionValue(asset.mint, userAmountRaw, decimals, tokenInfo?.priceUsd),
        )
      }

      if (poolTokens.length === 0) {
        const vaultTokenInfo = tokens.get(snapshot.vaultMint)
        poolTokens.push(
          buildPositionValue(
            snapshot.vaultMint,
            snapshot.userLpAmountRaw,
            snapshot.lpDecimals,
            vaultTokenInfo?.priceUsd,
          ),
        )
      }

      const usdValue = sumUsdValues(poolTokens.map((token) => token.usdValue))

      positions.push({
        platformId: 'symmetry',
        positionKind: 'liquidity',
        liquidityModel: 'constant-product',
        poolAddress: snapshot.vaultAddress,
        lpTokenAmount: toUiAmountString(snapshot.userLpAmountRaw, snapshot.lpDecimals),
        poolTokens,
        ...(usdValue !== undefined && { usdValue }),
        meta: {
          symmetry: {
            vaultAddress: snapshot.vaultAddress,
            vaultMint: snapshot.vaultMint,
            vaultVersion: snapshot.vaultVersion,
            userVaultAmountRaw: snapshot.userLpAmountRaw.toString(),
            activeAssetCount: snapshot.assets.length,
          },
        },
      } satisfies ConstantProductLiquidityDefiPosition)
    }

    positions.sort((left, right) =>
      (left.poolAddress ?? '').localeCompare(right.poolAddress ?? ''),
    )

    return positions as UserDefiPosition[]
  },
}

export default symmetryIntegration
