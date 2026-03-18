import { describe, expect, it } from 'bun:test'
import { address, createSolanaRpc } from '@solana/kit'

import { TokenPlugin } from './tokens'

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const rpc = createSolanaRpc(RPC_URL)
const TARGET_TOKEN_COUNT = 100
const RAYDIUM_CACHE_FILE = new URL('./raydium-token-addresses.json', import.meta.url)
let cachedRaydiumAddresses: string[] | null = null

async function loadRaydiumTokenAddresses(): Promise<string[]> {
  if (cachedRaydiumAddresses != null) return cachedRaydiumAddresses

  const cached = (await Bun.file(RAYDIUM_CACHE_FILE).json()) as string[]
  cachedRaydiumAddresses = [
    ...new Set(
      cached
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .filter((tokenAddress): tokenAddress is string => {
          try {
            address(tokenAddress)
            return true
          } catch {
            return false
          }
        }),
    ),
  ]
  return cachedRaydiumAddresses
}

describe('TokenPlugin', () => {
  describe('fetchMany()', () => {
    it('fetches 100 tokens in one call', async () => {
      const tokenAddresses = await loadRaydiumTokenAddresses()

      if (tokenAddresses.length < TARGET_TOKEN_COUNT) {
        throw new Error(`Expected at least ${TARGET_TOKEN_COUNT} token addresses, got ${tokenAddresses.length}`)
      }

      const plugin = new TokenPlugin(rpc)
      const addresses = tokenAddresses.slice(0, TARGET_TOKEN_COUNT)
      const firstAddress = addresses[0]
      if (firstAddress == null) {
        throw new Error('Expected at least one address')
      }

      const result = await plugin.fetchMany(addresses)

      expect(result.size).toBe(TARGET_TOKEN_COUNT)
      expect(result.has(firstAddress)).toBe(true)
      for (const address of addresses) {
        const tokenData = result.get(address)
        if (tokenData != null) {
          expect(tokenData.mintAddress).toBe(address)
          expect(tokenData.decimals).toBeGreaterThanOrEqual(0)
          expect(tokenData.decimals).toBeLessThanOrEqual(255)
        }
      }
    }, 30_000)

    it('accepts exactly 100 addresses and rejects 101', async () => {
      const tokenAddresses = await loadRaydiumTokenAddresses()
      if (tokenAddresses.length < TARGET_TOKEN_COUNT + 1) {
        throw new Error(`Expected at least ${TARGET_TOKEN_COUNT + 1} token addresses, got ${tokenAddresses.length}`)
      }

      const plugin = new TokenPlugin(rpc)
      const exactlyLimit = tokenAddresses.slice(0, TARGET_TOKEN_COUNT)
      await expect(plugin.fetchMany(exactlyLimit)).resolves.toBeInstanceOf(Map)

      const tooMany = tokenAddresses.slice(0, TARGET_TOKEN_COUNT + 1)
      const uncachedCheckPlugin = new TokenPlugin(rpc)
      await expect(uncachedCheckPlugin.fetchMany(tooMany)).rejects.toThrow(
        `fetchMany supports at most ${TARGET_TOKEN_COUNT} uncached mints per call`,
      )
    }, 30_000)
  })
})
