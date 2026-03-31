import type { Platform } from '../types/platform'

const hawkfiPlatform = {
  id: 'hawkfi' as const,
  networks: ['solana'],
  name: 'HawkFi',
  image: 'https://hawkfi.gitbook.io/whitepaper/~gitbook/ogimage/YtVMgsMuA3umxCx5KmXW',
  description:
    'High Frequency Liquidity platform for automated LP fee generation on Solana',
  tags: ['dex', 'defi'],
  links: {
    website: 'https://www.hawkfi.ag/',
    documentation: 'https://hawkfi.gitbook.io/whitepaper',
  },
} satisfies Platform

export default hawkfiPlatform
