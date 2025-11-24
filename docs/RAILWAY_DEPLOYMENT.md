# Railway Deployment Guide

## Quick Deploy to Railway

This guide will help you deploy the SUI Raffle Bot to Railway from GitHub.

---

## Prerequisites

1. **GitHub Account** with access to https://github.com/kdt82/raffle
2. **Railway Account** - Sign up at https://railway.app
3. **Telegram Bot Token** - Get from @BotFather on Telegram
4. **Your Telegram User ID** - Get from @userinfobot on Telegram

---

## Step 1: Prepare GitHub Repository

### 1.1 Push Code to GitHub

```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - SUI Raffle Bot"

# Add remote (if not already added)
git remote add origin https://github.com/kdt82/raffle.git

# Push to GitHub
git push -u origin main
```

### 1.2 Verify GitHub

- Go to https://github.com/kdt82/raffle
- Ensure all files are uploaded
- Verify `railway.toml` and `Procfile` are present

---

## Step 2: Create Railway Project

### 2.1 Log into Railway

1. Go to https://railway.app
2. Sign in with GitHub
3. Click **"New Project"**

### 2.2 Deploy from GitHub

1. Select **"Deploy from GitHub repo"**
2. Choose **kdt82/raffle** repository
3. Railway will automatically detect the project

### 2.3 Add PostgreSQL Database

1. In your Railway project, click **"New"**
2. Select **"Database"** → **"PostgreSQL"**
3. Railway will provision a PostgreSQL database
4. The `DATABASE_URL` will be automatically added to your environment

### 2.4 Add Redis

1. In your Railway project, click **"New"**
2. Select **"Database"** → **"Redis"**
3. Railway will provision a Redis instance
4. Note the connection details for later

---

## Step 3: Configure Environment Variables

### 3.1 Get Required Information

Before proceeding, collect:

1. **Telegram Bot Token**
   - Open Telegram
   - Message @BotFather
   - Send `/newbot` and follow instructions
   - Copy the bot token

2. **Your Telegram User ID**
   - Message @userinfobot on Telegram
   - Copy your user ID (numbers only)

3. **Redis Connection String**
   - In Railway, click on your Redis service
   - Copy the `REDIS_URL` from the "Connect" tab

### 3.2 Add Variables in Railway

In your Railway project, go to your bot service and click **"Variables"** tab.

Add these environment variables:

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Admin User ID (your Telegram user ID)
ADMIN_USER_IDS=123456789

# SUI Blockchain
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
SUI_NETWORK=mainnet

# Redis (from Railway Redis service)
REDIS_HOST=redis-production-xxxx.railway.app
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
# OR use REDIS_URL if Railway provides it
# REDIS_URL=redis://default:password@host:port

# Backup Configuration
BACKUP_DIR=/app/backups
BACKUP_RETENTION_DAYS=30

# Health Check
HEALTH_CHECK_PORT=3000

# Logging
LOG_LEVEL=info

# Environment
NODE_ENV=production
```

**Note**: `DATABASE_URL` is automatically set by Railway when you add PostgreSQL.

### 3.3 Optional: On-Chain Randomness

If you want provably fair winner selection:

```bash
SUI_RANDOMNESS_PACKAGE_ID=0x...
SUI_RANDOMNESS_OBJECT_ID=0x...
```

Leave empty to use secure client-side fallback.

---

## Step 4: Deploy

### 4.1 Initial Deployment

1. After adding all environment variables, Railway will automatically deploy
2. Watch the deployment logs in Railway dashboard
3. Wait for "Deployment successful" message

### 4.2 Database Setup

Railway will automatically run:
- `npm install`
- `npx prisma generate`
- `npx prisma db push` (creates tables)

### 4.3 Verify Deployment

1. Check the logs for: `✅ SUI Raffle Telegram Bot started successfully!`
2. Go to your bot on Telegram
3. Send `/start` command
4. You should receive a welcome message!

---

## Step 5: Set Up Admin Access

### 5.1 Seed Admin User

You have two options:

**Option A: Via Railway CLI**

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run seed command
railway run npm run db:seed
```

**Option B: Manually via Database**

1. In Railway, open your PostgreSQL service
2. Click "Data" tab
3. Run this SQL:

```sql
INSERT INTO "Admin" ("id", "telegramUserId", "permissions", "createdAt", "updatedAt")
VALUES (
  'admin_001',
  123456789,  -- Replace with your Telegram user ID
  'super_admin',
  NOW(),
  NOW()
);
```

### 5.2 Test Admin Commands

1. Open your bot on Telegram
2. Send `/create_raffle`
3. You should see the interactive raffle creation UI

---

## Step 6: Configure Domains (Optional)

### 6.1 Get Railway Domain

1. In Railway project, go to your bot service
2. Click **"Settings"** tab
3. Under "Domains", click **"Generate Domain"**
4. Railway will provide a URL like: `your-app.railway.app`

### 6.2 Health Check

Visit: `https://your-app.railway.app/health`

You should see:
```json
{
  "status": "healthy",
  "timestamp": "2024-12-01T12:00:00.000Z"
}
```

---

## Step 7: Monitor Your Bot

### 7.1 View Logs

In Railway dashboard:
1. Click on your bot service
2. Go to **"Deployments"** tab
3. Click on the latest deployment
4. View real-time logs

### 7.2 Check Health

- Health endpoint: `https://your-app.railway.app/health`
- Detailed health: `https://your-app.railway.app/health/detailed`

### 7.3 Telegram Commands

Test these commands:
- `/start` - Should work for everyone
- `/create_raffle` - Should work for admins only
- `/analytics_live` - Should show system stats

---

## Troubleshooting

### Bot Not Responding

1. **Check Railway Logs**
   - Look for errors in deployment logs
   - Verify bot started successfully

2. **Verify Environment Variables**
   ```bash
   TELEGRAM_BOT_TOKEN=set?
   DATABASE_URL=set?
   REDIS_HOST=set?
   ADMIN_USER_IDS=set?
   ```

3. **Test Database Connection**
   - Check PostgreSQL is running in Railway
   - Verify DATABASE_URL is correct

4. **Check Redis Connection**
   - Verify Redis service is running
   - Check REDIS_HOST and REDIS_PORT

### Database Errors

**Problem**: "Table does not exist"

**Solution**:
```bash
# Via Railway CLI
railway run npx prisma db push

# Or redeploy the project
```

### Redis Connection Failed

**Problem**: "Redis connection refused"

**Solution**:
1. Verify Redis service is running in Railway
2. Check REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
3. Try using REDIS_URL instead (Railway might provide this)

### Telegram Bot Token Invalid

**Problem**: "401 Unauthorized"

**Solution**:
1. Verify token from @BotFather
2. Ensure no extra spaces in Railway variable
3. Regenerate token if needed (talk to @BotFather)

### Permission Denied Errors

**Problem**: Can't use admin commands

**Solution**:
1. Verify your Telegram user ID is in ADMIN_USER_IDS
2. Check Admin table in database
3. Re-run seed script or add manually

---

## Updating Your Bot

### Deploy New Changes

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Update bot features"
   git push
   ```

2. **Railway Auto-Deploys**
   - Railway detects GitHub changes
   - Automatically builds and deploys
   - Watch logs for deployment status

3. **Manual Redeploy**
   - Go to Railway dashboard
   - Click your bot service
   - Click **"Deploy"** → **"Redeploy"**

---

## Backup Your Data

### Automated Backups

The bot automatically creates backups:
- Daily at 2 AM UTC
- Before winner selection
- Location: `/app/backups` in Railway

### Download Backups

Use Telegram commands:
```
/backup_list
/backup_download full_1234567890
```

### External Backup Storage (Recommended)

Since Railway ephemeral storage is temporary, set up external storage:

1. **Option A: AWS S3**
   - Create S3 bucket
   - Add AWS credentials to Railway
   - Modify backup service to upload to S3

2. **Option B: Download via Telegram**
   - Use `/backup_download` regularly
   - Save files locally

---

## Scaling

### Vertical Scaling

In Railway:
1. Go to bot service
2. Click **"Settings"**
3. Adjust resources as needed

### Horizontal Scaling

For multiple instances:
1. Ensure Redis is properly configured
2. Use Railway's scaling features
3. Load balance with Railway's built-in features

---

## Cost Estimate

Railway Pricing (as of 2024):

- **Hobby Plan**: $5/month
  - Includes $5 credit
  - PostgreSQL: ~$5/month
  - Redis: ~$5/month
  - Bot service: ~$5/month
  - **Total**: ~$15/month (first month free with trial)

- **Pro Plan**: $20/month
  - Better for production
  - More resources
  - Priority support

---

## Support

### Railway Support

- Documentation: https://docs.railway.app
- Discord: https://discord.gg/railway
- Twitter: @Railway

### Bot Issues

- Check logs in Railway dashboard
- Review documentation in `/docs` folder
- Test locally first with `npm run dev`

---

## Quick Reference

### Essential Railway Commands

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link project
railway link

# View logs
railway logs

# Run commands
railway run <command>

# Open dashboard
railway open
```

### Essential Bot Commands

```bash
# Development
npm run dev

# Build
npm run build

# Production
npm start

# Database
npm run db:push
npm run db:seed

# Generate Prisma Client
npm run db:generate
```

---

## Checklist

Before going live, verify:

- [ ] Bot responds to `/start`
- [ ] Admin commands work (`/create_raffle`)
- [ ] Database is accessible
- [ ] Redis is connected
- [ ] Health check returns 200
- [ ] Backups are created (check logs)
- [ ] Analytics are tracking
- [ ] Notifications are sent
- [ ] Winner selection works
- [ ] Backups are downloadable

---

## Next Steps

1. **Test Thoroughly**
   - Create a test raffle
   - Link a test wallet
   - Verify all features work

2. **Configure DEX Integration**
   - Set up DEX-specific monitoring
   - Test buy event detection

3. **Customize**
   - Update bot messages
   - Add custom media
   - Configure notification times

4. **Monitor**
   - Check Railway logs daily
   - Monitor health endpoints
   - Review analytics dashboard

---

**🎉 Your SUI Raffle Bot is now live on Railway!**

For detailed feature documentation, see the `/docs` folder in your repository.

