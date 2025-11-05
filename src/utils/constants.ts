export const TICKETS_PER_TOKEN = 100;
export const PRIZE_TYPES = ['USDC', 'AQUA', 'SUI'] as const;
export type PrizeType = typeof PRIZE_TYPES[number];

export const DEX_OPTIONS = ['cetus', 'turbos', '7kag', 'dexscreener', 'suidex'] as const;
export type DexType = typeof DEX_OPTIONS[number];

export const DEX_NAMES = {
  CETUS: 'cetus',
  TURBOS: 'turbos',
  SEVEN_K_AG: '7kag',
  DEXSCREENER: 'dexscreener',
  SUIDEX: 'suidex',
} as const;

export const RAFFLE_STATUS = {
  ACTIVE: 'active',
  ENDED: 'ended',
  CANCELLED: 'cancelled',
  WINNER_SELECTED: 'winner_selected',
} as const;

export const ADMIN_PERMISSIONS = {
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export const MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  GIF: 'gif',
} as const;

export type MediaType = typeof MEDIA_TYPES[keyof typeof MEDIA_TYPES];

