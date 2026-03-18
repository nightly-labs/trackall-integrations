import { testIntegration } from './integration'

const name = process.env.INTEGRATION_NAME
if (!name) throw new Error('INTEGRATION_NAME env var is required')

const mod = await import(`../solana/${name}/index.ts`)
testIntegration(mod.default, mod.testAddress)
