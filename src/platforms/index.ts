import type { Platform } from '../types/platform'
import jupiterLendPlatform from './jupiter'
import meteoraPlatform from './meteora'

export const platforms = [meteoraPlatform, jupiterLendPlatform] as const satisfies readonly Platform[]

export type PlatformId = typeof platforms[number]['id']
