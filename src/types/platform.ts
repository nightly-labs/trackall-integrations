import type { PlatformTag } from './platformTag'

export interface PlatformLinks {
  /** Expected format: absolute URL (https://...). */
  website?: string
  /** Expected format: absolute Discord invite or server URL. */
  discord?: string
  /** Expected format: Telegram username URL or channel link (https://t.me/...). */
  telegram?: string
  /** Expected format: absolute Twitter/X profile URL (https://x.com/...). */
  twitter?: string
  /** Expected format: absolute GitHub repository/profile URL. */
  github?: string
  /** Expected format: absolute Medium profile/publication URL. */
  medium?: string
  /** Expected format: absolute documentation URL (usually docs subdomain or docs site). */
  documentation?: string
}

export interface Platform {
  /** Unique platform identifier (string). */
  id: string
  /** Network of the platform. */
  network: string
  /** Display name of the platform. */
  name: string
  /** Expected format: URL of the platform logo/image (https://... with image extension). */
  image: string
  /** Short text description suitable for UI display. */
  description: string
  /** DefiLlama platform identifier used for cross-service lookup. */
  defiLlamaId?: string
  /** Platform tags, constrained by the shared PlatformTag enum. */
  tags: PlatformTag[]
  /** Related platform links. Each field expects a URL string. */
  links?: PlatformLinks
}
