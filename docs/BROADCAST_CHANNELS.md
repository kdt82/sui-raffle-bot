# Multi-Tenant Broadcast Channels

## Overview
In the multi-tenant raffle bot, each project has its own `broadcastChannelId` instead of using a global `MAIN_CHAT_ID` environment variable. This allows each group to receive announcements in their own chat.

## How It Works

### Automatic Setup
When the bot is added to a new group:
1. Bot detects `new_chat_members` event
2. Creates `Project` record with `telegramGroupId` = group's chat ID
3. Sets `broadcastChannelId` = same group's chat ID (by default)
4. Raffle announcements will be sent to this group

### Database Schema
```prisma
model Project {
  id                 String   @id @default(cuid())
  telegramGroupId    BigInt   @unique  // The group where bot is installed
  broadcastChannelId BigInt?           // Where to post announcements (defaults to same group)
  // ... other fields
}
```

### Code Flow

#### 1. Bot Added to Group (`group-events.ts`)
```typescript
project = await prisma.project.create({
  data: {
    telegramGroupId: groupId,
    telegramGroupName: groupName,
    broadcastChannelId: groupId, // Default to same group
    // ... other fields
  },
});
```

#### 2. Raffle Creation (`admin-ui.ts`)
```typescript
// Fetch the project to get broadcastChannelId
const project = await prisma.project.findUnique({
  where: { id: data.projectId },
});

const broadcastChannelId = project?.broadcastChannelId;

if (broadcastChannelId) {
  await bot.sendMessage(String(broadcastChannelId), announcementMessage);
}
```

## Migration from Global MAIN_CHAT_ID

### Before (Single Tenant)
```env
# .env file
MAIN_CHAT_ID=-1001234567890
BROADCAST_CHANNEL_ID=-1001234567890  # Duplicate!
```

All raffles announced to the same global chat ID.

### After (Multi-Tenant)
```typescript
// No environment variable needed!
// Each project has its own broadcastChannelId in the database
```

Each project's raffles are announced to that project's group.

## Configuration Options

### Option 1: Same Group (Default)
Announcements go to the same group where the bot is installed.
```
broadcastChannelId = telegramGroupId
```

### Option 2: Separate Channel
Announcements go to a different channel (e.g., public announcement channel).
```sql
UPDATE "Project" 
SET "broadcastChannelId" = -1001234567890 
WHERE "telegramGroupId" = -1009876543210;
```

### Option 3: No Announcements
Set to `null` to disable announcements for a project.
```sql
UPDATE "Project" 
SET "broadcastChannelId" = NULL 
WHERE id = 'project-id';
```

## Files Modified

### 1. `src/bot/handlers/admin-ui.ts`
- **Before**: Used global `MAIN_CHAT_ID` from environment
- **After**: Fetches `project.broadcastChannelId` from database
- **Lines**: 1778-1889

### 2. `src/bot/handlers/group-events.ts`
- Sets `broadcastChannelId` when creating project
- **Line**: 53

### 3. Other Files Still Using MAIN_CHAT_ID (To Be Updated)
- `src/services/raffle-service.ts` - Start announcements
- `src/workers/stake-worker.ts` - Staking bonus announcements  
- `src/blockchain/buy-detector.ts` - Buy notifications

## Testing

### Test Scenario 1: New Group
1. Add bot to group "TestKDT" (ID: -1001234567890)
2. Check database:
   ```sql
   SELECT "telegramGroupId", "broadcastChannelId" 
   FROM "Project" 
   WHERE "telegramGroupName" = 'TestKDT';
   ```
3. Expected: Both IDs are -1001234567890
4. Create a raffle
5. Expected: Announcement appears in "TestKDT" group

### Test Scenario 2: Multiple Groups
1. Add bot to "Group A" (ID: -100111)
2. Add bot to "Group B" (ID: -100222)
3. Create raffle in Group A
4. Expected: Announcement only in Group A
5. Create raffle in Group B
6. Expected: Announcement only in Group B

## Error Handling

### No Broadcast Channel Configured
```
⚠️ Warning: Broadcast channel not configured for this project.
Raffle created but not announced to group chat.
```

**Solution**: Update project's `broadcastChannelId`:
```sql
UPDATE "Project" 
SET "broadcastChannelId" = "telegramGroupId" 
WHERE id = 'project-id';
```

### Bot Not in Broadcast Channel
```
⚠️ Warning: Raffle created but announcement to broadcast channel failed.
Please check bot permissions in the group.
```

**Solution**: 
1. Add bot to the broadcast channel
2. Give bot permission to send messages

## Benefits of Multi-Tenant Approach

1. **No Manual Configuration**: No need to set `MAIN_CHAT_ID` for each deployment
2. **Automatic Setup**: Works immediately when bot is added to a group
3. **Isolation**: Each project's announcements stay in their own group
4. **Flexibility**: Can configure different broadcast channels per project
5. **Scalability**: Supports unlimited projects without environment variable changes

## Future Enhancements

1. **Admin Command**: `/setbroadcast <channel_id>` to change broadcast channel
2. **Multiple Channels**: Support announcing to multiple channels per project
3. **Channel Verification**: Auto-verify bot has permissions in broadcast channel
4. **Fallback**: If broadcast fails, try alternative channels
