# Quick Start Deployment Checklist

Use this checklist for rapid deployment. See DEPLOYMENT.md for detailed instructions.

## Prerequisites Setup (5-10 minutes)

- [ ] Node.js 18+ installed
- [ ] PostgreSQL 14+ running
- [ ] Redis 6+ running
- [ ] Telegram bot created via @BotFather (get token)
- [ ] Admin Telegram user IDs obtained (use @userinfobot)
- [ ] SUI RPC endpoint chosen (default: https://fullnode.mainnet.sui.io:443)

## Code Setup (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Configure .env with your values
nano .env

# 4. Generate Prisma client
npm run db:generate

# 5. Run database migrations
npm run db:migrate:deploy

# 6. Seed admin users
npm run db:seed
```

## Environment Variables Required

```env
# Required - Get from @BotFather
TELEGRAM_BOT_TOKEN=your_bot_token

# Required - Your Telegram user ID (from @userinfobot)
TELEGRAM_ADMIN_USER_IDS=123456789

# Required - PostgreSQL connection
DATABASE_URL=postgresql://user:password@localhost:5432/raffle_db

# Required - Redis connection
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=  # Leave empty if no password

# Optional - Defaults to mainnet
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

## Development Start (1 minute)

```bash
npm run dev
```

## Production Start (2 minutes)

```bash
# Build
npm run build

# Option 1: Direct
npm start

# Option 2: PM2 (recommended)
npm install -g pm2
pm2 start dist/index.js --name raffle-bot
pm2 save
pm2 startup  # Follow the command it outputs
```

## Verification (2 minutes)

- [ ] Bot responds to `/start` command
- [ ] Admin can run `/create_raffle`
- [ ] Database connection successful (check logs)
- [ ] Redis connection successful (check logs)
- [ ] No errors in logs

## DEX Integration (Complete before production use)

⚠️ **IMPORTANT**: The bot includes placeholder DEX integrations. Before production use:

1. **Get actual DEX package IDs**
   - Cetus: Update `CETUS_PACKAGE_ID` in `src/blockchain/dex/cetus.ts`
   - Turbos: Update `TURBOS_PACKAGE_ID` in `src/blockchain/dex/turbos.ts`
   - 7k.ag: Update `SEVEN_K_AG_PACKAGE_ID` in `src/blockchain/dex/7kag.ts`
   - SuiDex: Update `SUIDEX_PACKAGE_ID` in `src/blockchain/dex/suidex.ts`

2. **Implement event parsing**
   - Update `parseSwapEvent()` in each DEX integration file
   - Extract: wallet address, token amount, transaction hash
   - Test with actual transactions

3. **Test buy detection**
   - Create test raffle
   - Make test purchase
   - Verify tickets are allocated
   - Check logs for events

## Quick Deployment Options

### Railway.app (Fastest - 5 minutes)
1. Push code to GitHub
2. Go to Railway.app
3. New Project → Deploy from GitHub
4. Add PostgreSQL database
5. Add Redis service
6. Add environment variables
7. Deploy

### DigitalOcean App Platform (10 minutes)
1. Push code to GitHub
2. Go to DigitalOcean
3. Create App → GitHub repository
4. Add managed PostgreSQL
5. Add managed Redis
6. Add environment variables
7. Deploy

### VPS with Docker (15 minutes)
```bash
# On your server
git clone <your-repo>
cd raffle

# Create .env file
nano .env

# Start with docker-compose
docker-compose up -d

# Run migrations
docker-compose exec app npm run db:migrate:deploy
docker-compose exec app npm run db:seed
```

## Common First-Time Issues

### Issue: "Database connection failed"
**Solution**: Check DATABASE_URL format
```env
DATABASE_URL=postgresql://username:password@host:port/database
```

### Issue: "Telegram bot not responding"
**Solution**: Verify bot token
```bash
# Test with curl
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

### Issue: "Redis connection timeout"
**Solution**: Ensure Redis is running
```bash
# Linux/Mac
redis-cli ping
# Should respond: PONG

# Windows
redis-cli.exe ping
```

### Issue: "Migration failed"
**Solution**: Check PostgreSQL permissions
```sql
GRANT ALL PRIVILEGES ON DATABASE raffle_db TO your_user;
```

## Monitoring

```bash
# PM2 status
pm2 status

# View logs
pm2 logs raffle-bot

# Monitor resources
pm2 monit

# Docker logs
docker-compose logs -f app
```

## Next Steps After Deployment

1. **Test all commands** as regular user and admin
2. **Create first raffle** using interactive UI (`/create_raffle`)
3. **Configure DEX integration** for your target token
4. **Setup monitoring** (optional but recommended)
5. **Enable backups** (see DEPLOYMENT.md)
6. **Review ENHANCEMENTS.md** for improvements

## Emergency Shutdown

```bash
# PM2
pm2 stop raffle-bot

# Direct
pkill -f "node dist/index.js"

# Docker
docker-compose down
```

## Quick Rollback

```bash
# PM2
pm2 restart raffle-bot

# Docker
docker-compose down
docker-compose up -d
```

## Support

- Check logs first: `pm2 logs` or `docker-compose logs`
- Review DEPLOYMENT.md for detailed troubleshooting
- Check ENHANCEMENTS.md for known issues and improvements

---

**Estimated Total Time**: 30-45 minutes (including testing)

