# Setup Instructions

## Prerequisites

1. Node.js 18+ installed
2. PostgreSQL database running
3. Redis server running
4. Telegram Bot Token (from @BotFather)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Configure `.env` file:
   - `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
   - `TELEGRAM_ADMIN_USER_IDS`: Comma-separated list of admin Telegram user IDs
   - `DATABASE_URL`: PostgreSQL connection string
   - `REDIS_HOST`, `REDIS_PORT`: Redis connection details
   - `SUI_RPC_URL`: SUI RPC endpoint (defaults to mainnet)

## Database Setup

1. Generate Prisma client:
```bash
npm run db:generate
```

2. Run migrations:
```bash
npm run db:migrate:dev
```

3. (Optional) Seed admin users:
```bash
npm run db:seed
```

## Running the Bot

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

## Getting Your Telegram User ID

To get your Telegram user ID for admin configuration:
1. Start a chat with @userinfobot on Telegram
2. It will reply with your user ID
3. Add this ID to `TELEGRAM_ADMIN_USER_IDS` in `.env`

## Creating a Raffle

As an admin, use the bot command:
```
/create_raffle <contract_address> <dex> <end_time> <prize_type> <prize_amount>
```

Example:
```
/create_raffle 0x123... cetus 2024-12-31T23:59:59 SUI 1000
```

**Supported DEXes:**
- `cetus` - Cetus DEX
- `turbos` - Turbos Finance
- `7kag` - 7k.ag
- `dexscreener` - DexScreener API
- `suidex` - SuiDex

## Buy Detection

The bot supports multiple DEX integrations. When creating a raffle, you specify which DEX to monitor:

- **Cetus, Turbos, 7k.ag, SuiDex**: These use on-chain event subscriptions via SUI SDK
- **DexScreener**: Uses API polling (may require additional implementation)

Each DEX integration includes placeholder implementations that need to be completed based on:
1. Actual DEX package IDs and event structures
2. Transaction parsing logic for each DEX
3. Buy event filtering for the target token

See `src/blockchain/dex/` directory for integration modules.

## Notes

- The winner selection currently uses weighted random selection
- For production, implement SUI's on-chain randomness (see `src/services/winner-service.ts`)
- Buy detection needs to be implemented based on your DEX integration
- Media uploads store Telegram file IDs (consider cloud storage for large files)

