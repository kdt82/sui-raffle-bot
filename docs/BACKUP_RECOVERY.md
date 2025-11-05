# Backup & Recovery System

The bot includes a comprehensive backup and recovery system to protect your data and ensure business continuity.

## Features

### 1. Automated Daily Backups
Full database backups created automatically every day at 2 AM UTC.

### 2. Raffle-Specific Backups
Individual raffle backups created before winner selection for audit trail.

### 3. Manual Backup Creation
Admins can create backups on-demand at any time.

### 4. Selective Restoration
Choose what data to restore (raffles, analytics, users).

### 5. CSV Export
Download backups as JSON files for external storage.

### 6. Automatic Cleanup
Old backups automatically deleted after retention period (default: 30 days).

## Admin Commands

### `/backup`
Create a full backup immediately

```
⏳ Creating full backup...

✅ Backup Created Successfully

📦 Backup ID: `full_1701234567890`
📅 Timestamp: Dec 1, 2024, 2:00 AM
📊 Type: full
💾 Size: 2.45 MB
```

### `/backup_list`
View all available backups

```
📦 Available Backups

🗂️ FULL
   ID: `full_1701234567890`
   Date: Dec 1, 2024, 2:00 AM
   Size: 2.45 MB

📄 RAFFLE
   ID: `raffle_clxy123_1701234567890`
   Date: Nov 30, 2024, 11:59 PM
   Size: 145.23 KB

... and 15 more
```

### `/backup_download <id>`
Download a backup file

```bash
/backup_download full_1701234567890
```

Sends the backup as a downloadable JSON file.

### `/backup_restore <id> [options]`
Restore from a backup

```bash
# Restore everything
/backup_restore full_1701234567890

# Skip analytics
/backup_restore full_1701234567890 --skip-analytics

# Skip users
/backup_restore full_1701234567890 --skip-users

# Skip raffles
/backup_restore full_1701234567890 --skip-raffles
```

**Warning**: Requires confirmation before proceeding.

### `/backup_raffle <raffle_id>`
Create backup for a specific raffle

```bash
/backup_raffle clxy123abc
```

### `/backup_cleanup [days]`
Manually clean up old backups

```bash
# Delete backups older than 30 days (default)
/backup_cleanup

# Custom retention period
/backup_cleanup 60
```

## Backup Contents

### Full Backup Includes

- ✅ All raffles
- ✅ All tickets
- ✅ All buy events
- ✅ All wallet users
- ✅ All admins
- ✅ All winners
- ✅ Notification preferences
- ✅ Scheduled notifications
- ✅ Daily analytics (all time)
- ✅ DEX statistics
- ✅ Raffle analytics
- ✅ User activities (last 90 days)
- ✅ Redis conversation states

### Raffle Backup Includes

- ✅ Raffle details
- ✅ All tickets for the raffle
- ✅ All buy events for the raffle
- ✅ Winner information (if selected)
- ✅ Raffle analytics

## Automation Schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| Full Backup | 2 AM UTC daily | Complete database backup |
| Raffle Backup | On raffle end | Backup before winner selection |
| Cleanup | 3 AM UTC Sundays | Delete backups older than retention period |

## Storage

### Default Location

```
./backups/
├── full_1701234567890.json
├── raffle_clxy123_1701234567890.json
├── full_1701148167890.json
└── ...
```

### Custom Location

Set via environment variable:

```bash
# .env
BACKUP_DIR=/path/to/backups
```

### Retention Period

```bash
# .env
BACKUP_RETENTION_DAYS=30  # Default: 30 days
```

## Backup Format

### Full Backup Structure

```json
{
  "metadata": {
    "id": "full_1701234567890",
    "timestamp": "2024-12-01T02:00:00.000Z",
    "type": "full",
    "version": "1.0"
  },
  "data": {
    "raffles": [...],
    "tickets": [...],
    "buyEvents": [...],
    "walletUsers": [...],
    "admins": [...],
    "winners": [...],
    "notificationPreferences": [...],
    "scheduledNotifications": [...],
    "dailyAnalytics": [...],
    "dexDailyStats": [...],
    "raffleAnalytics": [...],
    "userActivities": [...]
  },
  "redis": {
    "conversations": {
      "conversation:12345:67890": "{...}",
      ...
    }
  }
}
```

### Raffle Backup Structure

```json
{
  "metadata": {
    "id": "raffle_clxy123_1701234567890",
    "timestamp": "2024-11-30T23:59:59.000Z",
    "type": "raffle",
    "raffleId": "clxy123abc",
    "version": "1.0"
  },
  "data": {
    "raffle": {
      "id": "clxy123abc",
      "ca": "0x...",
      "dex": "cetus",
      "tickets": [...],
      "buyEvents": [...],
      "winners": [...]
    },
    "analytics": {
      "raffleId": "clxy123abc",
      "totalParticipants": 85,
      ...
    }
  }
}
```

## Recovery Procedures

### Full System Recovery

1. **Install fresh bot instance**
   ```bash
   git clone <repository>
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with database credentials
   ```

3. **Initialize database**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Restore backup**
   ```bash
   # Via Telegram
   /backup_restore full_1701234567890
   
   # Or manually
   node scripts/restore-backup.js full_1701234567890.json
   ```

### Partial Recovery

Restore specific data only:

```bash
# Restore users but skip raffles and analytics
/backup_restore full_1701234567890 --skip-raffles --skip-analytics
```

### Single Raffle Recovery

```bash
# Create backup of current raffle first
/backup_raffle clxy123abc

# If needed, restore specific raffle
/backup_restore raffle_clxy123_1701234567890
```

## Best Practices

### 1. Regular Verification

Test restores periodically:
```bash
# Download backup
/backup_download full_latest

# Verify file integrity
cat full_latest.json | jq .
```

### 2. External Storage

Store backups off-server:
```bash
# Download daily
/backup_download full_1701234567890

# Upload to S3/cloud storage
aws s3 cp backup.json s3://my-backups/
```

### 3. Pre-Critical Operations

Always backup before major operations:
```bash
# Before database migration
/backup

# Before bulk operations
/backup

# Before system updates
/backup
```

### 4. Monitor Backup Jobs

Check logs regularly:
```bash
grep "Backup" logs/*.log
grep "backup job completed" logs/*.log
```

### 5. Test Restores

Periodically test restore process in development:
```bash
# Test environment
/backup_restore full_test --skip-analytics
```

## Disaster Recovery Plan

### Scenario 1: Database Corruption

1. Stop bot services
2. Restore latest full backup
3. Verify data integrity
4. Restart services
5. Monitor for issues

### Scenario 2: Raffle Data Loss

1. Identify affected raffle
2. Restore specific raffle backup
3. Verify ticket counts
4. Resume operations

### Scenario 3: Complete System Failure

1. Provision new infrastructure
2. Install bot from repository
3. Restore latest full backup
4. Restore Redis states
5. Resume all services
6. Verify functionality

## Monitoring

### Backup Success Rate

```bash
# Check recent backups
/backup_list

# Review logs
grep "Backup job.*completed" logs/*.log
```

### Storage Usage

```bash
# Check backup directory size
du -sh ./backups

# Count backups
ls -1 ./backups/*.json | wc -l
```

### Automated Alerts

Set up monitoring:
```bash
# Check if today's backup exists
if [ ! -f "./backups/full_$(date +%Y%m%d)*.json" ]; then
  echo "ALERT: No backup created today!"
fi
```

## Troubleshooting

### Backup Fails

1. **Check disk space**
   ```bash
   df -h
   ```

2. **Verify permissions**
   ```bash
   ls -la ./backups
   ```

3. **Check database connection**
   ```bash
   psql $DATABASE_URL -c "SELECT 1;"
   ```

4. **Review error logs**
   ```bash
   tail -f logs/error.log
   ```

### Restore Fails

1. **Verify backup file integrity**
   ```bash
   jq . backup.json > /dev/null
   ```

2. **Check database is empty**
   ```sql
   SELECT COUNT(*) FROM "Raffle";
   ```

3. **Ensure schema is up-to-date**
   ```bash
   npx prisma db push
   ```

4. **Try selective restore**
   ```bash
   /backup_restore <id> --skip-analytics
   ```

### Cleanup Issues

1. **Manual cleanup**
   ```bash
   find ./backups -name "*.json" -mtime +30 -delete
   ```

2. **Check permissions**
   ```bash
   ls -la ./backups
   ```

3. **Verify retention setting**
   ```bash
   echo $BACKUP_RETENTION_DAYS
   ```

## Security

### Backup Encryption

For production, encrypt backups:

```bash
# Encrypt backup
gpg --symmetric --cipher-algo AES256 backup.json

# Decrypt for restore
gpg --decrypt backup.json.gpg > backup.json
```

### Access Control

- Only admins can create/restore backups
- Backup commands require admin permissions
- Rate limited to prevent abuse

### Sensitive Data

Backups include:
- ⚠️ Wallet addresses (public data)
- ⚠️ Telegram user IDs
- ✅ NO private keys
- ✅ NO passwords
- ✅ NO payment information

## Performance

- **Full Backup**: ~30 seconds for 10,000 tickets
- **Raffle Backup**: ~2 seconds
- **Restore**: ~1 minute for full backup
- **Cleanup**: <5 seconds

## Integration

### With Raffle System

- Automatic backup before winner selection
- Ensures raffle data preserved
- Allows audit of winner selection

### With Analytics

- Full backups include all analytics
- Can restore historical data
- Preserves daily aggregates

### With Notifications

- Backs up notification preferences
- Restores scheduled notifications
- Preserves conversation states

## API Reference

### Create Backup

```typescript
import { backupService } from './services/backup-service';

const metadata = await backupService.createFullBackup();
console.log('Backup ID:', metadata.id);
```

### List Backups

```typescript
const backups = await backupService.listBackups();
backups.forEach(b => {
  console.log(`${b.id}: ${b.size} bytes`);
});
```

### Download Backup

```typescript
const buffer = await backupService.getBackupFile('full_123');
// Send to user or save to file
```

### Restore Backup

```typescript
await backupService.restoreFromBackup('full_123', {
  skipRaffles: false,
  skipAnalytics: false,
  skipUsers: false,
});
```

## Compliance

- **Data Protection**: Regular automated backups
- **Audit Trail**: Raffle backups before winner selection
- **Recovery Time**: < 5 minutes for full restore
- **Data Retention**: Configurable (default 30 days)
- **Accessibility**: Admin-only access with rate limiting

