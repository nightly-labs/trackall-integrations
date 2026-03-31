import { testIntegration } from '../../../test/solana-integration'
import { divvyIntegration, testAddress } from '.'

testIntegration(divvyIntegration, testAddress, {
  timeoutMs: 180_000,
})
