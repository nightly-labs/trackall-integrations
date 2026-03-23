import type { Platform } from '../types/platform'

const carrotPlatform = {
  id: 'carrot' as const,
  networks: ['solana'],
  name: 'Carrot',
  image: 'https://boost.deficarrot.com/android-chrome-512x512.png',
  description:
    'Carrot is a leveraged yield farming protocol for JLP, FLP.1, and ONyc on Solana.',
  tags: [],
} satisfies Platform

export default carrotPlatform
