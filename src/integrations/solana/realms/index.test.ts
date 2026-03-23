import { testIntegration } from '../../../test/solana-integration'
import { realmsIntegration, testAddress } from '.'

testIntegration(realmsIntegration, testAddress, {
  timeoutMs: 180_000,
})
