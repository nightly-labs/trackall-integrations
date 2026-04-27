import { describe, expect, it } from 'bun:test'
import {
  getKaminoVaultMetricsUrl,
  normalizeKaminoApyToPercentage,
  parseKaminoStrategyApyMap,
  parseKaminoVaultApyMap,
} from './apy'

describe('kamino apy normalization', () => {
  it('converts fractional APY strings to percentages exactly', () => {
    expect(
      normalizeKaminoApyToPercentage(
        '0.066527842899023711405366628964490454572',
      ),
    ).toBe('6.6527842899023711405366628964490454572')
    expect(normalizeKaminoApyToPercentage('0.123')).toBe('12.3')
    expect(normalizeKaminoApyToPercentage('1')).toBe('100')
    expect(normalizeKaminoApyToPercentage('0')).toBe('0')
    expect(normalizeKaminoApyToPercentage('-0.5')).toBe('-50')
  })

  it('accepts finite numeric inputs and rejects invalid values', () => {
    expect(normalizeKaminoApyToPercentage(0.25)).toBe('25')
    expect(normalizeKaminoApyToPercentage('1e-2')).toBe('1')
    expect(normalizeKaminoApyToPercentage('')).toBeUndefined()
    expect(normalizeKaminoApyToPercentage('abc')).toBeUndefined()
    expect(normalizeKaminoApyToPercentage(Number.NaN)).toBeUndefined()
    expect(
      normalizeKaminoApyToPercentage(Number.POSITIVE_INFINITY),
    ).toBeUndefined()
    expect(normalizeKaminoApyToPercentage(undefined)).toBeUndefined()
  })

  it('keeps vault metric fallback order while scaling APY to percentages', () => {
    const primaryVault = 'vault-primary'
    const fallbackVault = 'vault-fallback'
    const rowsByUrl = new Map<string, unknown[]>([
      [
        getKaminoVaultMetricsUrl(primaryVault),
        [{ apy: '0.123', apyActual: '0.456' }],
      ],
      [getKaminoVaultMetricsUrl(fallbackVault), [{ apyActual: '0.0665' }]],
    ])

    const apyByVault = parseKaminoVaultApyMap(rowsByUrl, [
      primaryVault,
      fallbackVault,
      'vault-missing',
    ])

    expect(apyByVault.get(primaryVault)).toBe('12.3')
    expect(apyByVault.get(fallbackVault)).toBe('6.65')
    expect(apyByVault.has('vault-missing')).toBe(false)
  })

  it('keeps strategy metric fallback order while scaling APY to percentages', () => {
    const apyByStrategy = parseKaminoStrategyApyMap([
      {
        strategy: 'strategy-vault-priority',
        kaminoApy: {
          vault: { apy7d: '0.03125' },
          totalApy: '0.05',
        },
        apy: { totalApy: '0.07' },
      },
      {
        strategy: 'strategy-kamino-total-fallback',
        kaminoApy: { totalApy: '0.045' },
        apy: { totalApy: '0.09' },
      },
      {
        strategy: 'strategy-apy-total-fallback',
        kaminoApy: {},
        apy: { totalApy: '0.11' },
      },
      {
        strategy: 'strategy-invalid',
        kaminoApy: { vault: { apy7d: 'bad' } },
      },
    ])

    expect(apyByStrategy.get('strategy-vault-priority')).toBe('3.125')
    expect(apyByStrategy.get('strategy-kamino-total-fallback')).toBe('4.5')
    expect(apyByStrategy.get('strategy-apy-total-fallback')).toBe('11')
    expect(apyByStrategy.has('strategy-invalid')).toBe(false)
  })
})
