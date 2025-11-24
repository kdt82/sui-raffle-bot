# Bot Group Events - Auto Admin Promotion

## Overview
The bot now automatically detects when it's added to a Telegram group and promotes the user who added it as a project admin. This happens **immediately** when the bot is added, without requiring any manual commands.

## How It Works

### Event Flow

```
1. User adds bot to Telegram group "TestKDT"
   ↓
2. Telegram sends 'new_chat_members' event to bot
   ↓
3. Bot detects it was added (checks if bot ID is in new_chat_members)
   ↓
4. Bot identifies who added it (msg.from)
   ↓
5. Bot creates Project record for the group (if doesn't exist)
   ↓
6. Bot creates ProjectAdmin record for the user
   ↓
7. Bot sends welcome message to the group
   ↓
8. User can now use admin commands in DM! ✅
```

### Code Implementation

#### 1. Event Handler Registration (`src/bot/handlers/index.ts`)
```typescript
// Handle bot being added to a group
bot.on('new_chat_members', async (msg) => {
  try {
    await handleBotAddedToGroup(msg);
  } catch (error) {
    logger.error('Error handling new_chat_members event:', error);
  }
});
```

#### 2. Bot Added Handler (`src/bot/handlers/group-events.ts`)
```typescript
export async function handleBotAddedToGroup(msg: TelegramBot.Message) {
    // Check if bot was added
    const botInfo = await bot.getMe();
    const botWasAdded = msg.new_chat_members.some(member => member.id === botInfo.id);
    
    if (!botWasAdded) return;

    // Get user who added the bot
    const userId = BigInt(msg.from!.id);
    const groupId = BigInt(msg.chat.id);
    
    // Create or get project
    let project = await prisma.project.findUnique({
        where: { telegramGroupId: groupId },
    });
    
    if (!project) {
        project = await prisma.project.create({
            data: {
                telegramGroupId: groupId,
                telegramGroupName: msg.chat.title,
                // ... other fields
            },
        });
    }
    
    // Auto-promote user as super_admin
    await prisma.projectAdmin.create({
        data: {
            projectId: project.id,
            telegramUserId: userId,
            permissions: 'super_admin',
        },
    });
    
    // Send welcome message
    await bot.sendMessage(msg.chat.id, welcomeMessage);
}
```

## User Experience

### Before (Manual Setup Required)
1. User adds bot to group
2. User runs `/start` in group
3. User runs `/start` in DM
4. User tries `/create_raffle` in DM
5. **ERROR**: "Could not determine project context"
6. Admin manually creates ProjectAdmin record in database
7. User tries `/create_raffle` again
8. **SUCCESS** (finally!)

### After (Automatic)
1. User adds bot to group
2. Bot automatically:
   - Creates Project
   - Promotes user as super_admin
   - Sends welcome message
3. User DMs bot and runs `/create_raffle`
4. **SUCCESS!** 🎉

## Welcome Message

When the bot is added to a group, it sends this message:

```
🎉 Welcome to SUI Raffle Bot!

✅ Project created for "TestKDT"
🔐 @username has been promoted to super admin

You can now use admin commands in your private chat with the bot:
• /create_raffle - Create a new raffle
• /adminhelp - See all admin commands

Users can:
• /start - Get started
• /leaderboard - View raffle standings
• /mytickets - Check ticket count
• /linkwallet - Link wallet address
```

## Telegram Events Used

### `new_chat_members`
- Triggered when new members join a group
- Includes the bot itself when it's added
- Contains `msg.from` (user who added the member)
- Contains `msg.new_chat_members` (array of new members)

### `my_chat_member` (Future Use)
- Triggered when bot's status changes in a group
- Used to detect when bot is promoted to admin
- Contains old and new status information

## Database Schema

### Project
```prisma
model Project {
  id                String   @id @default(cuid())
  telegramGroupId   BigInt   @unique
  telegramGroupName String
  // ... other fields
  
  admins ProjectAdmin[]
}
```

### ProjectAdmin
```prisma
model ProjectAdmin {
  id             String   @id @default(cuid())
  projectId      String
  telegramUserId BigInt
  permissions    String   @default("admin") // admin, super_admin
  
  project Project @relation(fields: [projectId], references: [id])
  
  @@unique([projectId, telegramUserId])
}
```

## Security Considerations

1. **Only first user is promoted**: Only the user who adds the bot gets auto-promoted
2. **Idempotent**: If Project already exists, it's not recreated
3. **Duplicate prevention**: `@@unique([projectId, telegramUserId])` prevents duplicate admins
4. **Project isolation**: Each group gets its own Project with isolated data

## Testing

### Test Scenario 1: New Group
1. Create a new Telegram group
2. Add the bot to the group
3. Check logs: Should see "Bot added to group..." and "Auto-promoted user..."
4. Check database: Project and ProjectAdmin records should exist
5. DM the bot and run `/create_raffle`
6. Expected: Interactive raffle creation starts

### Test Scenario 2: Existing Group
1. Bot is already in a group
2. Remove and re-add the bot
3. Check logs: Should see "User X is already an admin"
4. No duplicate ProjectAdmin records should be created

### Test Scenario 3: Multiple Admins
1. User A adds bot to group → Auto-promoted
2. User B joins the group → NOT auto-promoted
3. Only User A should have ProjectAdmin record

## Troubleshooting

### Bot doesn't send welcome message
- Check bot has permission to send messages in the group
- Check logs for errors
- Verify `new_chat_members` event is being received

### User still can't use admin commands in DM
- Check ProjectAdmin record exists in database
- Check `getAdminProjectContext()` is finding the user's project
- Verify user is admin of exactly one project

### Duplicate admin records
- Should not happen due to `@@unique` constraint
- If it does, check for race conditions in event handling

## Logs to Watch

```
Bot added to group "TestKDT" (123456789) by user 6505428730 (KAMI)
Creating new project for group TestKDT (123456789)
Auto-promoted user 6505428730 (KAMI) as super_admin of project abc123
```

## Future Enhancements

1. **Multi-admin support**: Allow group admins to promote other users
2. **Permission levels**: Different admin roles (owner, admin, moderator)
3. **Admin removal**: Detect when user leaves group and revoke admin
4. **Bot removal**: Clean up Project when bot is removed from group
