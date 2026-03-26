import { testIntegration } from '../../../test/solana-integration'
import { metadaoIntegration, testAddress } from '.'

testIntegration(metadaoIntegration, testAddress, {
  timeoutMs: 180_000,
})
