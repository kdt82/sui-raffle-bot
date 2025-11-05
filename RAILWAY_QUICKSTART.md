# 🚀 Quick Railway Deployment

Deploy your SUI Raffle Bot to Railway in 10 minutes!

---

## What You Need

✅ GitHub repo: https://github.com/kdt82/raffle  
✅ Railway account: https://railway.app  
✅ Telegram bot token (from @BotFather)  
✅ Your Telegram user ID (from @userinfobot)

---

## Step 1: Push to GitHub (if not done)

```bash
git add .
git commit -m "Ready for Railway"
git push origin main
```

---

## Step 2: Deploy on Railway

1. Go to https://railway.app/new
2. Click **"Deploy from GitHub repo"**
3. Select **kdt82/raffle**
4. Click **"Add variables"**

---

## Step 3: Add Services

### Add PostgreSQL
1. Click **"New"** → **"Database"** → **"PostgreSQL"**
2. Done! (DATABASE_URL is auto-set)

### Add Redis
1. Click **"New"** → **"Database"** → **"Redis"**
2. Copy the connection details

---

## Step 4: Set Environment Variables

In your bot service, click **"Variables"** and add:

```bash
# Required
TELEGRAM_BOT_TOKEN=your_token_from_botfather
ADMIN_USER_IDS=your_telegram_user_id

# Redis (from Railway Redis service)
REDIS_HOST=redis-production-xxxx.railway.app
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# SUI Network
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
SUI_NETWORK=mainnet

# Config
BACKUP_DIR=/app/backups
BACKUP_RETENTION_DAYS=30
HEALTH_CHECK_PORT=3000
LOG_LEVEL=info
NODE_ENV=production
```

---

## Step 5: Wait for Deployment

Railway will automatically:
- ✅ Install dependencies
- ✅ Generate Prisma client
- ✅ Create database tables
- ✅ Start the bot

Watch the logs for: `✅ SUI Raffle Telegram Bot started successfully!`

---

## Step 6: Test Your Bot

1. Open Telegram
2. Find your bot
3. Send `/start`
4. You should get a welcome message! 🎉

---

## Step 7: Add Admin Access

### Option A: Via Railway CLI

```bash
npm install -g @railway/cli
railway login
railway link
railway run npm run db:seed
```

### Option B: Via Database

In Railway PostgreSQL service → Data tab:

```sql
INSERT INTO "Admin" ("id", "telegramUserId", "permissions", "createdAt", "updatedAt")
VALUES ('admin_001', YOUR_TELEGRAM_ID, 'super_admin', NOW(), NOW());
```

Replace `YOUR_TELEGRAM_ID` with your actual ID.

---

## Step 8: Verify Everything Works

Test these commands in Telegram:

- `/start` ✅ Should show welcome
- `/create_raffle` ✅ Should show UI (admin only)
- `/analytics_live` ✅ Should show stats (admin only)

---

## 🎯 You're Done!

Your bot is now live on Railway!

### Health Check
`https://your-app.railway.app/health`

### View Logs
Railway Dashboard → Your Service → Deployments

### Download Backups
Use `/backup_list` and `/backup_download` in Telegram

---

## 🆘 Troubleshooting

### Bot Not Responding?
1. Check Railway logs for errors
2. Verify TELEGRAM_BOT_TOKEN is correct
3. Ensure DATABASE_URL and Redis are set

### Can't Use Admin Commands?
1. Verify your user ID in ADMIN_USER_IDS
2. Check Admin table in database
3. Run seed script again

### Database Errors?
```bash
railway run npx prisma db push
```

---

## 📚 Full Documentation

See `RAILWAY_DEPLOYMENT.md` for detailed guide.

---

**Need help?** Check the docs in `/docs` folder or Railway's support at https://railway.app/help

