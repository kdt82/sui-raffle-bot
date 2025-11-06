# SUI Raffle Telegram Bot

A whitelabeled Telegram bot for conducting raffles based on SUI token purchases.

## Features

- 🎰 Automatic ticket allocation based on token purchases (100 tickets per token)
- ⏰ Configurable raffle time periods
- 📸 Media upload support (images/videos/GIFs)
- 📊 Leaderboard display
- 🔗 Wallet linking (auto-detect + manual)
- 🎲 SUI randomizer-based winner selection
- 🔐 Admin controls for raffle management
- 🔄 Multi-DEX support (Cetus, Turbos, 7k.ag, DexScreener, SuiDex)
- 💬 Interactive admin UI with inline keyboards
- 🛡️ Redis-based rate limiting and anti-spam
- 📈 Built-in metrics and health monitoring
- 🐳 Docker support with multi-stage builds
- 🎲 Provably fair winner selection with SUI on-chain randomness
- 💾 Automated backup & recovery system

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment file:
```bash
cp .env.example .env
```

3. Configure your `.env` file with:
   - Telegram Bot Token (from @BotFather)
   - Database connection string
   - Redis connection details
   - SUI RPC endpoint
   - Admin Telegram user IDs

4. Setup database:
```bash
npm run db:generate
npm run db:migrate:dev
```

5. Start the bot:
```bash
npm run dev
```

## Bot Commands

### User Commands
- `/start` - Start the bot and see instructions
- `/leaderboard` - View current raffle leaderboard
- `/mytickets` - Check your ticket count
- `/linkwallet <address>` - Link your wallet address
- `/notifications` - View notification preferences
- `/notifications_toggle <type>` - Toggle notification types (tickets, reminders, summary, winners)
- `/notifications_time <HH:mm> [timezone]` - Set daily summary time

### Admin Commands
- `/create_raffle` - Create a new raffle (requires DEX selection)
- `/set_prize` - Set prize details for active raffle
- `/set_minimum_purchase <amount>` - Set minimum token purchase to earn tickets
- `/upload_media` - Upload media for raffle
- `/award_prize` - Award prize to winner
- `/config` - Configure raffle settings
- `/reset_tickets` - Reset all tickets and buy events for active raffle (testing only)
- `/analytics [days]` - View analytics summary (default: 7 days)
- `/analytics_raffles` - Compare raffle performance
- `/analytics_export [days]` - Export analytics to CSV (default: 30 days)
- `/analytics_live` - View real-time statistics
- `/backup` - Create full database backup
- `/backup_list` - List all available backups
- `/backup_download <id>` - Download a backup file
- `/backup_restore <id>` - Restore from backup
- `/backup_raffle <raffle_id>` - Backup specific raffle
- `/backup_cleanup [days]` - Clean up old backups

**Supported DEXes for buy detection:**
- `cetus` - Cetus DEX
- `turbos` - Turbos Finance
- `7kag` - 7k.ag
- `dexscreener` - DexScreener API
- `suidex` - SuiDex

## Architecture

- **Backend**: Node.js + TypeScript, Fastify API
- **Database**: PostgreSQL with Prisma ORM
- **Queue**: BullMQ with Redis
- **Telegram**: node-telegram-bot-api
- **Blockchain**: @mysten/sui.js SDK

## Documentation

- 📖 [Setup Guide](SETUP.md) - Complete setup instructions
- 🚀 [Deployment Guide](DEPLOYMENT.md) - Deploy to various platforms
- ⚡ [Quick Start](QUICKSTART.md) - Get running in 5 minutes
- 📊 [Metrics Documentation](docs/METRICS.md) - Monitoring and metrics
- 📈 [Analytics Guide](docs/ANALYTICS.md) - Analytics dashboard and data export
- 🛡️ [Rate Limiting Guide](docs/RATE_LIMITING.md) - Anti-spam configuration
- 🔔 [Notifications Guide](docs/NOTIFICATIONS.md) - Notification system
- 🎲 [Winner Selection Guide](docs/WINNER_SELECTION.md) - Provably fair randomness
- 💾 [Backup & Recovery Guide](docs/BACKUP_RECOVERY.md) - Data protection
- 🔧 [Enhancements](ENHANCEMENTS.md) - Suggested improvements
- 📋 [Summary](SUMMARY.md) - Project overview

## License

MIT

