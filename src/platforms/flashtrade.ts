import type { Platform } from '../types/platform'

const flashtradePlatform = {
  id: 'flashtrade' as const,
  networks: ['solana'],
  name: 'Flash Trade',
  image: 'https://www.flash.trade/favicon.ico',
  description: 'Perpetual futures exchange on Solana',
  tags: ['dex', 'defi'],
  links: {
    website: 'https://www.flash.trade',
    documentation: 'https://docs.flash.trade/flash-trade',
  },
} satisfies Platform

export default flashtradePlatform
