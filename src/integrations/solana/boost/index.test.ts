import { testIntegration } from '../../../test/solana-integration'
import { boostIntegration, testAddress } from './index'

testIntegration(boostIntegration, testAddress)
