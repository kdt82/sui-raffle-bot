# Multi-Tenant Implementation Plan

## Overview
Transform the raffle bot from single-tenant to multi-tenant, allowing it to be installed in multiple Telegram groups simultaneously, with each group having its own:
- Admin users
- Broadcast channel
- Raffles and tickets
- Configuration

## Database Schema Changes

### 1. New `Project` Model
```prisma
model Project {
  id                String   @id @default(cuid())
  telegramGroupId   BigInt   @unique  // The Telegram group/channel ID
  telegramGroupName String?             // Group name for reference
  broadcastChannelId BigInt?           // Where to post announcements (can be same as group)
  contractAddress   String              // Token contract address to monitor
  dex               String              // Default DEX for this project
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  // Relations
  raffles           Raffle[]
  admins            ProjectAdmin[]
  walletUsers       WalletUser[]
  
  @@index([telegramGroupId])
}
```

### 2. New `ProjectAdmin` Model (replaces global Admin)
```prisma
model ProjectAdmin {
  id             String   @id @default(cuid())
  projectId      String
  telegramUserId BigInt
  permissions    String   @default("admin") // admin, super_admin
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@unique([projectId, telegramUserId])
  @@index([projectId])
  @@index([telegramUserId])
}
```

### 3. Update Existing Models

**Raffle** - Add projectId:
```prisma
model Raffle {
  // ... existing fields
  projectId   String  // NEW: Link to project
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@index([projectId])
  @@index([projectId, status])
}
```

**WalletUser** - Add projectId:
```prisma
model WalletUser {
  id              String   @id @default(cuid())  // NEW: Add ID
  projectId       String                          // NEW: Link to project
  walletAddress   String
  telegramUserId  BigInt
  // ... other fields
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@unique([projectId, walletAddress])
  @@index([projectId, telegramUserId])
}
```

## Implementation Steps

### Phase 1: Database Migration
1. Create migration to add `Project` and `ProjectAdmin` models
2. Create migration to add `projectId` to existing models
3. Create data migration script to:
   - Create a default project from current ENV variables
   - Link all existing data to this default project
   - Migrate existing admins to ProjectAdmin

### Phase 2: Core Logic Updates
1. **Context Detection Middleware**
   - Detect which group/project the message is from
   - Attach project context to all handlers
   
2. **Auto-Setup on /start**
   - Detect if project exists for this group
   - If not, create new project
   - Auto-add the user who ran /start as super_admin
   - Auto-detect broadcast channel (same as group initially)

3. **Update Admin Middleware**
   - Check admin status per-project, not globally
   - `isAdmin(userId, projectId)` instead of `isAdmin(userId)`

### Phase 3: Handler Updates
1. Update all raffle queries to filter by `projectId`
2. Update all admin checks to be project-scoped
3. Update broadcast messages to use project's `broadcastChannelId`

### Phase 4: Configuration
1. Add `/setup` command for project configuration
2. Allow changing broadcast channel
3. Allow adding/removing admins per project
4. Set contract address and DEX per project

## Auto-Detection Logic

### On /start Command in Group:
```typescript
async function handleStartInGroup(msg: TelegramBot.Message) {
  const groupId = BigInt(msg.chat.id);
  const userId = BigInt(msg.from!.id);
  
  // Check if project exists
  let project = await prisma.project.findUnique({
    where: { telegramGroupId: groupId }
  });
  
  if (!project) {
    // First time setup
    project = await prisma.project.create({
      data: {
        telegramGroupId: groupId,
        telegramGroupName: msg.chat.title,
        broadcastChannelId: groupId, // Default to same group
        contractAddress: '', // To be configured
        dex: 'cetus', // Default
      }
    });
    
    // Auto-add first user as super_admin
    await prisma.projectAdmin.create({
      data: {
        projectId: project.id,
        telegramUserId: userId,
        permissions: 'super_admin'
      }
    });
    
    await bot.sendMessage(groupId, 
      `🎉 Raffle Bot Installed!\n\n` +
      `You have been added as the admin.\n` +
      `Use /setup to configure the bot.`
    );
  }
}
```

## Migration Strategy

### Option A: Backward Compatible (Recommended)
- Keep existing ENV-based setup working
- If no project exists, create one from ENV on first message
- Gradually migrate to multi-tenant

### Option B: Breaking Change
- Require fresh setup for all groups
- Remove ENV-based configuration entirely
- Cleaner but requires re-setup

## Environment Variables Changes

**Before:**
```env
ADMIN_USER_IDS=123456789,987654321
MAIN_CHAT_ID=-1001234567890
```

**After (Optional - for default project):**
```env
# Optional: Create a default project on startup
DEFAULT_PROJECT_GROUP_ID=-1001234567890
DEFAULT_PROJECT_ADMIN_IDS=123456789,987654321
```

## Benefits
1. ✅ One bot instance serves multiple projects
2. ✅ No manual configuration needed per install
3. ✅ Each project isolated (data, admins, raffles)
4. ✅ Easier to scale and monetize
5. ✅ Better for SaaS model

## Considerations
1. ⚠️ Database queries need project filtering everywhere
2. ⚠️ Need to handle project context in all handlers
3. ⚠️ Migration of existing data required
4. ⚠️ Testing needed for multi-project scenarios
