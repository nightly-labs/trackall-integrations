import { testIntegration } from '../../../test/solana-integration'
import { testAddress, thevaultIntegration } from '.'

testIntegration(thevaultIntegration, testAddress)
