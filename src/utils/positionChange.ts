export type TokenPriceSource = {
  get: (token: string) => { pctPriceChange24h?: number } | undefined
}

export interface PositionPctUsdValueChangeOptions {
  borrowedWeight?: number
  ignoredKeys?: Set<string> | readonly string[]
}

const DEFAULT_BORROWED_WEIGHT = -1
const BORROWED_KEYS = new Set(['borrowed', 'borrow', 'debt'])
const DEFAULT_IGNORED_KEYS = new Set(['meta'])

function isSignedAmountValue(candidate: unknown): candidate is {
  amount: {
    token: string
  }
  usdValue: string
} {
  if (candidate == null || typeof candidate !== 'object') return false
  const candidateObject = candidate as Record<string, unknown>
  const amount = candidateObject.amount
  const usdValue = candidateObject.usdValue
  const token = (amount as { token?: unknown } | undefined)?.token
  return (
    amount != null &&
    typeof amount === 'object' &&
    typeof token === 'string' &&
    token.length > 0 &&
    typeof usdValue === 'string'
  )
}

function getBorrowedWeight(
  key: string | undefined,
  inherited: number,
  borrowedWeight: number,
): number {
  if (key == null) return inherited
  return BORROWED_KEYS.has(key.toLowerCase())
    ? inherited * borrowedWeight
    : inherited
}

function collectPositionPctComponents(
  root: unknown,
  tokenSource: TokenPriceSource,
  borrowedWeight: number,
  ignoredKeys: Set<string>,
): { weightedPct: number; weightedUsd: number } {
  const stack: Array<{ value: unknown; weight: number; key?: string }> = [
    { value: root, weight: 1 },
  ]
  const seen = new Set<object>()

  let weightedPct = 0
  let weightedUsd = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    const { value, weight, key } = current
    if (value == null || typeof value !== 'object') continue

    if (isSignedAmountValue(value)) {
      const candidate = value as {
        amount: { token: string }
        usdValue: string
      }

      const usd = Number(candidate.usdValue)
      if (!Number.isFinite(usd) || usd <= 0) continue

      const token = candidate.amount.token
      const tokenData = tokenSource.get(token)
      const pctPriceChange24h = tokenData?.pctPriceChange24h

      if (!Number.isFinite(pctPriceChange24h)) continue

      weightedUsd += weight * usd
      weightedPct += weight * usd * Number(pctPriceChange24h)
      continue
    }

    const valueRecord = value as Record<string, unknown>
    if (seen.has(value as object)) continue
    seen.add(value as object)

    if (key != null && ignoredKeys.has(key)) continue

    if (Array.isArray(value)) {
      for (const item of value as unknown[]) {
        if (item == null || typeof item !== 'object') continue
        stack.push({ value: item, weight })
      }
      continue
    }

    for (const [entryKey, entryValue] of Object.entries(valueRecord)) {
      if (entryValue == null || typeof entryValue !== 'object') continue
      stack.push({
        value: entryValue,
        weight: getBorrowedWeight(entryKey, weight, borrowedWeight),
        key: entryKey,
      })
    }
  }

  return { weightedPct, weightedUsd }
}

export function computePositionPctUsdValueChange24(
  tokenSource: TokenPriceSource,
  position: unknown,
  options: PositionPctUsdValueChangeOptions = {},
): string | undefined {
  const borrowedWeight = options.borrowedWeight ?? DEFAULT_BORROWED_WEIGHT
  const ignoredKeys = new Set(options.ignoredKeys ?? DEFAULT_IGNORED_KEYS)
  const { weightedPct, weightedUsd } = collectPositionPctComponents(
    position,
    tokenSource,
    borrowedWeight,
    ignoredKeys,
  )

  if (!Number.isFinite(weightedUsd) || weightedUsd === 0) return undefined

  const pct = weightedPct / weightedUsd
  return Number.isFinite(pct) ? pct.toString() : undefined
}

export function applyPositionPctUsdValueChange24(
  tokenSource: TokenPriceSource,
  position: { pctUsdValueChange24?: string },
  options: PositionPctUsdValueChangeOptions = {},
): void {
  const pctUsdValueChange24 = computePositionPctUsdValueChange24(
    tokenSource,
    position,
    options,
  )

  if (pctUsdValueChange24 !== undefined) {
    position.pctUsdValueChange24 = pctUsdValueChange24
  }
}

export function applyPositionsPctUsdValueChange24(
  tokenSource: TokenPriceSource,
  positions: Array<{ pctUsdValueChange24?: string }>,
  options: PositionPctUsdValueChangeOptions = {},
): void {
  for (const position of positions) {
    applyPositionPctUsdValueChange24(tokenSource, position, options)
  }
}
