import type { Platform } from '../types/platform'

const dflowPlatform = {
  id: 'dflow' as const,
  networks: ['solana'],
  name: 'DFlow',
  image: 'https://dflow.net/favicon/favicon.svg',
  description: 'DFlow prediction market outcome token positions on Solana',
  tags: ['defi'],
  links: {
    website: 'https://dflow.net/prediction',
    documentation: 'https://pond.dflow.net/introduction',
    github: 'https://github.com/DFlowProtocol',
  },
} satisfies Platform

export default dflowPlatform
