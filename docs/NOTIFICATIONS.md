# Notification System

The bot implements a comprehensive notification system to keep users informed and engaged.

## Features

### 1. Ticket Allocation Notifications
When a user receives tickets, they get a rich notification:

```
🎟️ New Tickets Allocated!

You've received 1,000 tickets for purchasing 10 tokens!

💼 Wallet: 0x1234...5678
🏆 Prize: 100 USDC
⏰ Raffle ends: Dec 31, 2024, 11:59 PM

Check your total tickets with /mytickets
Good luck! 🍀
```

### 2. Daily Summaries
Users receive daily summaries at their preferred time showing:
- Total ticket count
- Yesterday's new tickets
- Current leaderboard position
- Time remaining
- Prize information

Example:
```
📊 Your Daily Raffle Summary

🎫 Total Tickets: 5,230
📈 Yesterday: +500 tickets
🏅 Leaderboard Position: #3

🏆 Prize: 100 USDC
⏰ Time Remaining: 2d 14h

Keep buying to increase your chances! 🚀
```

### 3. Raffle Reminders
Participants receive reminders:
- **24 hours before end**: "Last day to buy!"
- **1 hour before end**: "Final hour!"

Example:
```
⏰ Raffle Reminder

The raffle ends in 1 hour!

🏆 Prize: 100 USDC
⏱️ Ends: Dec 31, 2024, 11:59 PM

This is your last chance to buy more tokens and increase your tickets!

Check your position: /leaderboard
Check your tickets: /mytickets
```

### 4. Winner Announcements
When a winner is selected, all participants are notified:

**For the winner:**
```
🎉🎉🎉 YOU WON! 🎉🎉🎉

🏆 Prize: 100 USDC
👤 Winner: 0x1234...5678
🎫 Winning Tickets: 5,230
📊 Total Participants: 142
🎟️ Total Tickets: 50,000

The prize will be sent to your wallet shortly!
```

**For other participants:**
```
🎉 RAFFLE WINNER ANNOUNCED!

🏆 Prize: 100 USDC
👤 Winner: 0x1234...5678
🎫 Winning Tickets: 5,230
📊 Total Participants: 142
🎟️ Total Tickets: 50,000

Congratulations to the winner! 🎊
```

### 5. Admin Alerts
Admins receive real-time alerts for:
- New raffle created
- Raffle ended
- Winner selected
- System errors (critical only)

## User Commands

### `/notifications`
View current notification preferences:
```
🔔 Your Notification Preferences

✅ Ticket Allocations
✅ Raffle Reminders (24h & 1h)
✅ Daily Summary
✅ Winner Announcements

⏰ Daily Summary Time: 09:00 UTC

To change your preferences, use:
/notifications_toggle <type>
```

### `/notifications_toggle <type>`
Toggle specific notification types:
```bash
# Toggle ticket allocation notifications
/notifications_toggle tickets

# Toggle raffle reminders
/notifications_toggle reminders

# Toggle daily summary
/notifications_toggle summary

# Toggle winner announcements
/notifications_toggle winners
```

### `/notifications_time <HH:mm> [timezone]`
Set when you want to receive daily summaries:
```bash
# Set to 9 AM UTC
/notifications_time 09:00 UTC

# Set to 2:30 PM Eastern
/notifications_time 14:30 America/New_York

# Set to 8 AM London time
/notifications_time 08:00 Europe/London
```

## Database Models

### NotificationPreference
Stores user preferences:
```prisma
model NotificationPreference {
  id                   String   @id @default(cuid())
  telegramUserId       BigInt   @unique
  dailySummary         Boolean  @default(true)
  raffleReminders      Boolean  @default(true)
  ticketAllocations    Boolean  @default(true)
  winnerAnnouncements  Boolean  @default(true)
  timezone             String   @default("UTC")
  preferredTime        String   @default("09:00")
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

### ScheduledNotification
Manages scheduled notifications:
```prisma
model ScheduledNotification {
  id              String   @id @default(cuid())
  raffleId        String?
  type            String
  scheduledFor    DateTime
  sent            Boolean  @default(false)
  sentAt          DateTime?
  targetUserIds   String[]
  metadata        String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

## Notification Types

| Type | Description | Scheduling |
|------|-------------|------------|
| `ticket_allocation` | Instant notification when tickets are allocated | Real-time |
| `daily_summary` | Daily ticket and raffle summary | User's preferred time |
| `raffle_reminder` | 24h and 1h before raffle ends | Automatic |
| `winner_announcement` | Broadcast when winner is selected | Real-time |
| `admin_alert` | Critical events for admins | Real-time |

## Scheduling

Notifications are processed by BullMQ jobs:

### Process Due Notifications
- **Frequency**: Every minute
- **Purpose**: Send scheduled notifications that are due

### Schedule Raffle Reminders
- **Frequency**: Every 10 minutes
- **Purpose**: Create 24h and 1h reminder notifications

### Send Daily Summaries
- **Frequency**: Every 15 minutes
- **Purpose**: Check and send daily summaries based on user preferences

### Check Raffle End
- **Frequency**: Every 5 minutes
- **Purpose**: Detect ended raffles and trigger admin alerts

## Architecture

```
┌─────────────────────┐
│ User Action/Event   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ NotificationService │
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌──────────┐  ┌────────────────────┐
│ Instant  │  │ Scheduled          │
│ Send     │  │ (ScheduledNotif DB)│
└──────────┘  └─────────┬──────────┘
                        │
                        ▼
                ┌───────────────┐
                │ BullMQ Worker │
                │ (processes    │
                │  due notifs)  │
                └───────┬───────┘
                        │
                        ▼
                ┌───────────────┐
                │ Telegram API  │
                └───────────────┘
```

## Best Practices

1. **Respect User Preferences**: Always check preferences before sending
2. **Graceful Failures**: Log errors but don't crash on notification failures
3. **Rate Limiting**: Notifications respect rate limits
4. **Batch Processing**: Process multiple notifications efficiently
5. **Time Zones**: Support user time zones for daily summaries

## Customization

### Adding New Notification Types

1. Add preference to `NotificationPreference` model
2. Update `NotificationService` with new method
3. Add scheduling logic if needed
4. Create user command for preferences
5. Update documentation

### Example: Add "Leaderboard Change" Notification

```typescript
// 1. Add to schema
model NotificationPreference {
  // ... existing fields
  leaderboardChanges Boolean @default(true)
}

// 2. Add to service
async notifyLeaderboardChange(userId: bigint, oldPosition: number, newPosition: number) {
  const prefs = await this.getUserPreferences(userId);
  if (!prefs.leaderboardChanges) return;
  
  const message = `📊 Leaderboard Update!\n\nYou moved from #${oldPosition} to #${newPosition}!`;
  await bot.sendMessage(Number(userId), message);
}

// 3. Call when position changes
if (oldPosition !== newPosition) {
  await notificationService.notifyLeaderboardChange(userId, oldPosition, newPosition);
}
```

## Monitoring

Track notification metrics:
```promql
# Notifications sent per minute
rate(notifications_sent_total[1m])

# Failed notifications
rate(notifications_failed_total[1m])

# Notification delivery time
histogram_quantile(0.95, notification_delivery_seconds)
```

## Troubleshooting

### Daily Summaries Not Sending

1. Check notification worker is running
2. Verify user preferences: `SELECT * FROM "NotificationPreference" WHERE "telegramUserId" = ?`
3. Check job queue: Redis key `bull:notifications:*`
4. Review logs for errors

### Reminders Not Working

1. Check raffle end times are in the future
2. Verify notification scheduling job is running
3. Check `ScheduledNotification` table for pending notifications
4. Ensure time calculations are correct

### Users Not Receiving Notifications

1. Verify Telegram bot permissions
2. Check user hasn't blocked the bot
3. Verify user preferences are enabled
4. Check rate limiting isn't blocking notifications

## Performance

- **Throughput**: 100+ notifications/second
- **Latency**: <1s for instant notifications, exact timing for scheduled
- **Reliability**: Failed notifications are logged for retry
- **Scalability**: BullMQ handles horizontal scaling

