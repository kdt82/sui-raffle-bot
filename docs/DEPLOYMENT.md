# Deployment Requirements & Guide

## Technical Requirements

### Minimum System Requirements

#### Production Server
- **CPU**: 2 vCPUs (4+ recommended for high traffic)
- **RAM**: 2GB minimum (4GB recommended)
- **Storage**: 20GB SSD (grows with database)
- **Network**: Stable internet connection, low latency to SUI RPC

#### Software Requirements
- **Node.js**: v18.x or higher (v20.x recommended)
- **npm/pnpm**: Latest version
- **PostgreSQL**: v14+ (v15+ recommended)
- **Redis**: v6+ (v7+ recommended)

#### Optional But Recommended
- **Process Manager**: PM2 or systemd
- **Reverse Proxy**: Nginx (if adding web dashboard)
- **SSL Certificate**: Let's Encrypt (for webhooks if needed)
- **Monitoring**: Prometheus + Grafana or similar

---

## Deployment Platforms

### Option 1: VPS (DigitalOcean, Linode, Vultr, AWS EC2)

**Pros**: Full control, better for production
**Cons**: Requires more setup

#### Recommended Providers & Plans

**DigitalOcean Droplet**
- Basic: $12/month (2GB RAM, 50GB SSD, 2 vCPUs)
- Recommended: $24/month (4GB RAM, 80GB SSD, 2 vCPUs)
- Includes: PostgreSQL & Redis as managed services (+$15/month each)

**AWS EC2**
- Instance: t3.small or t3.medium
- RDS PostgreSQL: db.t3.micro
- ElastiCache Redis: cache.t3.micro
- Estimated: $50-100/month

**Linode**
- Nanode: $5/month (shared, testing only)
- Linode 4GB: $24/month (recommended)
- Database cluster: +$25/month

#### VPS Deployment Steps

1. **Provision Server**
```bash
# Ubuntu 22.04 LTS recommended
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PostgreSQL 15
apt install -y postgresql postgresql-contrib

# Install Redis
apt install -y redis-server
```

2. **Setup Database**
```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE raffle_db;
CREATE USER raffle_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE raffle_db TO raffle_user;
\q
```

3. **Setup Application**
```bash
# Create app directory
mkdir -p /opt/raffle-bot
cd /opt/raffle-bot

# Clone or copy your code
git clone <your-repo> .
# OR use SCP to copy files

# Install dependencies
npm install --production

# Setup environment
cp .env.example .env
nano .env  # Configure all variables
```

4. **Configure Environment**
```env
# .env Production Configuration
NODE_ENV=production
LOG_LEVEL=info

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ADMIN_USER_IDS=123456789,987654321

# Database
DATABASE_URL=postgresql://raffle_user:your_password@localhost:5432/raffle_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# SUI
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
SUI_NETWORK=mainnet

# Application
PORT=3000
```

5. **Run Migrations**
```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

6. **Setup Process Manager (PM2)**
```bash
# Install PM2 globally
npm install -g pm2

# Build application
npm run build

# Start with PM2
pm2 start dist/index.js --name raffle-bot

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd
# Run the command PM2 outputs
```

7. **Setup Firewall**
```bash
# Install UFW
apt install -y ufw

# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS if needed
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw --force enable
```

8. **Setup Monitoring**
```bash
# PM2 monitoring
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# View logs
pm2 logs raffle-bot

# View status
pm2 status
```

---

### Option 2: Heroku

**Pros**: Easy deployment, managed services
**Cons**: More expensive, less control

#### Requirements
- Heroku account
- Heroku CLI installed
- Git repository

#### Cost Estimate
- Dyno: $7-25/month (Eco or Basic)
- PostgreSQL: $9/month (Mini)
- Redis: $15/month (Mini)
- **Total: ~$30-50/month**

#### Deployment Steps

1. **Setup Heroku**
```bash
# Login to Heroku
heroku login

# Create app
heroku create your-raffle-bot

# Add buildpack
heroku buildpacks:set heroku/nodejs

# Add PostgreSQL
heroku addons:create heroku-postgresql:mini

# Add Redis
heroku addons:create heroku-redis:mini
```

2. **Configure Environment**
```bash
heroku config:set TELEGRAM_BOT_TOKEN=your_token
heroku config:set TELEGRAM_ADMIN_USER_IDS=123456789
heroku config:set NODE_ENV=production
heroku config:set SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
heroku config:set LOG_LEVEL=info
```

3. **Create Procfile**
```
web: npm run start
worker: npm run start
```

4. **Deploy**
```bash
git push heroku main

# Run migrations
heroku run npm run db:migrate:deploy
heroku run npm run db:seed

# Scale worker
heroku ps:scale worker=1

# View logs
heroku logs --tail
```

---

### Option 3: Railway.app

**Pros**: Modern, easy, good pricing
**Cons**: Newer platform

#### Cost Estimate
- Server: $5/month base + usage
- PostgreSQL: $5/month
- Redis: $5/month
- **Total: ~$15-25/month**

#### Deployment Steps

1. **Connect Repository**
   - Go to Railway.app
   - Connect GitHub repository
   - Select repository

2. **Add Services**
   - Add PostgreSQL database
   - Add Redis service
   - Link to app

3. **Configure Environment Variables**
   - Add all environment variables in Railway dashboard
   - DATABASE_URL and REDIS_URL are auto-configured

4. **Deploy**
   - Railway auto-deploys on push
   - Configure build command: `npm run build`
   - Configure start command: `npm start`
   - Add migration command as deploy hook: `npm run db:migrate:deploy`

---

### Option 4: Docker Deployment

**Pros**: Portable, reproducible, works anywhere
**Cons**: Requires Docker knowledge

#### Create Docker Files

**Dockerfile**
```dockerfile
FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache postgresql-client

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Generate Prisma client
RUN npx prisma generate

# Copy app files
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (if needed)
EXPOSE 3000

# Start app
CMD ["npm", "start"]
```

**docker-compose.yml**
```yaml
version: '3.8'

services:
  app:
    build: .
    restart: unless-stopped
    environment:
      - DATABASE_URL=postgresql://raffle:password@postgres:5432/raffle
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_ADMIN_USER_IDS=${TELEGRAM_ADMIN_USER_IDS}
      - SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
    volumes:
      - ./logs:/app/logs

  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=raffle
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=raffle
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass your_redis_password
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"

volumes:
  postgres_data:
  redis_data:
```

#### Deploy with Docker

```bash
# Build and start
docker-compose up -d

# Run migrations
docker-compose exec app npm run db:migrate:deploy

# View logs
docker-compose logs -f app

# Stop
docker-compose down
```

---

## Pre-Deployment Checklist

### 1. Security
- [ ] Change all default passwords
- [ ] Use strong, unique passwords
- [ ] Enable 2FA on hosting account
- [ ] Secure environment variables
- [ ] Setup firewall rules
- [ ] Enable Redis password
- [ ] Use SSL/TLS for database connections

### 2. Configuration
- [ ] Set NODE_ENV=production
- [ ] Configure proper LOG_LEVEL
- [ ] Add all admin Telegram user IDs
- [ ] Test Telegram bot token
- [ ] Verify database connection string
- [ ] Test Redis connection
- [ ] Configure SUI RPC endpoint
- [ ] Set up monitoring alerts

### 3. Database
- [ ] Run migrations
- [ ] Seed admin users
- [ ] Setup automated backups
- [ ] Configure connection pooling
- [ ] Test database connectivity
- [ ] Plan backup retention policy

### 4. DEX Integration
- [ ] Get actual DEX package IDs
- [ ] Implement event parsing logic
- [ ] Test buy detection
- [ ] Verify transaction processing
- [ ] Add error handling for DEX failures

### 5. Testing
- [ ] Test all bot commands
- [ ] Test raffle creation flow
- [ ] Test ticket allocation
- [ ] Test leaderboard display
- [ ] Test winner selection
- [ ] Test notifications
- [ ] Load test with multiple users

### 6. Monitoring
- [ ] Setup health checks
- [ ] Configure log aggregation
- [ ] Setup uptime monitoring
- [ ] Add performance monitoring
- [ ] Configure alerts for errors
- [ ] Monitor database size
- [ ] Monitor Redis memory usage

### 7. Backup & Recovery
- [ ] Setup automated database backups
- [ ] Test backup restoration
- [ ] Document recovery procedures
- [ ] Store backups securely offsite
- [ ] Setup backup notifications

---

## Post-Deployment

### Monitoring & Maintenance

1. **Daily Tasks**
   - Check logs for errors
   - Monitor server resources
   - Verify bot is responding

2. **Weekly Tasks**
   - Review analytics
   - Check database size
   - Verify backups are working
   - Update dependencies (security patches)

3. **Monthly Tasks**
   - Full backup test
   - Performance review
   - Update documentation
   - Security audit

### Scaling Considerations

**When to scale up:**
- CPU consistently >70%
- Memory consistently >80%
- Redis memory >70%
- Database connections maxed out
- Response time >2 seconds

**Scaling options:**
- Vertical: Increase server resources
- Horizontal: Add multiple bot instances (requires load balancing)
- Database: Move to managed database service
- Redis: Move to managed Redis (ElastiCache, Redis Cloud)

---

## Estimated Monthly Costs

| Setup | Cost Range | Notes |
|-------|------------|-------|
| **Minimal (Testing)** | $15-30/month | Railway or small VPS |
| **Standard (Production)** | $50-75/month | VPS + managed databases |
| **Professional** | $100-150/month | High-availability setup |
| **Enterprise** | $200+/month | Multi-region, auto-scaling |

---

## Support & Troubleshooting

### Common Issues

1. **Bot not responding**
   - Check if process is running: `pm2 status` or `docker ps`
   - Check logs: `pm2 logs` or `docker logs`
   - Verify bot token is valid
   - Check network connectivity

2. **Database connection errors**
   - Verify DATABASE_URL is correct
   - Check PostgreSQL is running
   - Verify firewall allows connection
   - Check connection pool limits

3. **Redis connection errors**
   - Verify Redis is running
   - Check REDIS_HOST and REDIS_PORT
   - Verify password if set
   - Check Redis memory usage

4. **Buy detection not working**
   - Verify SUI RPC endpoint is accessible
   - Check DEX integration implementation
   - Review blockchain event logs
   - Verify contract address is correct

5. **High memory usage**
   - Check for memory leaks
   - Review BullMQ queue size
   - Monitor conversation states
   - Consider increasing server resources

### Getting Help

- Review logs first
- Check GitHub issues
- Consult SUI documentation
- Telegram Bot API documentation
- Stack Overflow for specific errors

