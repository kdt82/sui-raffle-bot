export const DEFAULT_TICKETS_PER_TOKEN = 100;
export const PRIZE_TYPES = ['USDC', 'AQUA', 'SUI'] as const;
export type PrizeType = (typeof PRIZE_TYPES)[number];

export const DEX_OPTIONS = ['blockberry', 'cetus', 'turbos', '7kag', 'dexscreener', 'suidex', 'onchain'] as const;
export type DexType = (typeof DEX_OPTIONS)[number];
export const DEFAULT_DEX: DexType = 'blockberry';

export const DEX_NAMES: Record<DexType, string> = {
  blockberry: 'Blockberry',
  cetus: 'Cetus',
  turbos: 'Turbos',
  '7kag': '7k.ag',
  dexscreener: 'DexScreener',
  suidex: 'SuiDex',
  onchain: 'On-chain',
};

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

export const DEX_LABELS: Record<DexType, string> = {
  blockberry: 'Blockberry',
  cetus: 'Cetus',
  turbos: 'Turbos',
  '7kag': '7k.ag',
  dexscreener: 'DexScreener',
  suidex: 'SuiDex',
  onchain: 'On-chain',
};

export function getDexDisplayName(dex: DexType): string {
  return DEX_LABELS[dex] ?? dex;
}

