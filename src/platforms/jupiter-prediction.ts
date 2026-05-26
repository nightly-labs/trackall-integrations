import type { Platform } from '../types/platform'

const jupiterPredictionPlatform = {
  id: 'jupiter-prediction' as const,
  networks: ['solana'],
  name: 'Jupiter Prediction',
  image: 'https://jup.ag/favicon.ico',
  description: 'On-chain prediction market positions and payouts on Jupiter',
  tags: ['defi'],
  links: {
    website: 'https://jup.ag/prediction',
    documentation: 'https://docs.jup.ag/user-docs/trade/predict',
  },
} satisfies Platform

export default jupiterPredictionPlatform
