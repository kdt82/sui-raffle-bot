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

/**
 * Format date consistently across the application
 * Returns format: "1st November 2025, 12:00 PM"
 */
export function formatDate(date: Date): string {
  const day = date.getUTCDate();
  const suffix = getDaySuffix(day);
  const month = date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const year = date.getUTCFullYear();
  const time = date.toLocaleString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC'
  });

  return `${day}${suffix} ${month} ${year}, ${time}`;
}

/**
 * Format date as DD/MM/YYYY HH:MM
 */
export function formatDateShort(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function getDaySuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

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

// Main chat ID for raffle announcements
export const MAIN_CHAT_ID = process.env.MAIN_CHAT_ID || '';

// Staking constants for Moonbags integration
export const STAKE_BONUS_MULTIPLIER = 0.25; // 25% bonus tickets for staking
export const STAKE_POLL_INTERVAL_MS = 10000; // Poll every 10 seconds
export const MOONBAGS_STAKE_PACKAGE = '0x9bc9ddc5cd0220ef810489c73e770f8587a8aa09cad064a0d8e0d1ad903a9e0f';
export const MOONBAGS_STAKE_EVENT = '0x8f70ad5db84e1a99b542f86ccfb1a932ca7ba010a2fa12a1504d839ff4c111c6::moonbags_stake::StakeEvent';
export const MOONBAGS_UNSTAKE_EVENT = '0x8f70ad5db84e1a99b542f86ccfb1a932ca7ba010a2fa12a1504d839ff4c111c6::moonbags_stake::UnstakeEvent';

