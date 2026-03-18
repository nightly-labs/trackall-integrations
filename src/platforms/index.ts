import type { Platform } from '../types/platform'
import meteoraPlatform from './meteora'

export const platforms = [meteoraPlatform] as const satisfies readonly Platform[]

export type PlatformId = typeof platforms[number]['id']
