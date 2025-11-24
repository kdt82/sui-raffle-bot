# Auto-Admin Promotion Flow

## Overview
When a user adds the bot to a new Telegram group, they are automatically promoted as the project admin. This allows them to use admin commands like `/create_raffle` in their private DM with the bot.

## How It Works

### 1. User Adds Bot to Group
When a user adds the SUI Raffle Bot to a new Telegram group:
- The bot is added to the group
- The user who added it becomes a group admin (Telegram's default behavior)

### 2. User Runs `/start` in the Group
When the user (or anyone) runs `/start` in the group for the first time:

```typescript
// In src/middleware/project-context.ts - ensureProjectExists()

1. Check if Project exists for this group
2. If NOT exists:
   a. Create new Project with group details
   b. Auto-create ProjectAdmin record for the user who ran /start
   c. Set their permissions to 'super_admin'
   d. Log the promotion
```

### 3. User Can Now Use Admin Commands in DM
After the above setup:
- User opens a DM with the bot
- User runs `/create_raffle` (or any admin command)
- `getAdminProjectContext()` checks:
  - Is this a private chat? ✅
  - Is user admin of exactly one project? ✅
  - Returns that project's context
- Command executes successfully! 🎉

## Code Flow

### Project Creation (src/middleware/project-context.ts)
```typescript
export async function ensureProjectExists(msg: TelegramBot.Message) {
    const groupId = BigInt(msg.chat.id);
    const userId = BigInt(msg.from!.id);
    const username = msg.from?.username;

    let project = await prisma.project.findUnique({
        where: { telegramGroupId: groupId },
    });

    let isNewProject = false;
    if (!project) {
        // Create project
        project = await prisma.project.create({ ... });
        isNewProject = true;
    }

    // Auto-promote first user as admin
    if (isNewProject) {
        await prisma.projectAdmin.create({
            data: {
                projectId: project.id,
                telegramUserId: userId,
                permissions: 'super_admin',
            },
        });
    }

    return projectContext;
}
```

### Admin Context Resolution (src/middleware/project-context.ts)
```typescript
export async function getAdminProjectContext(msg: TelegramBot.Message) {
    // Try to get from message (group chat)
    const projectContext = await getProjectContext(msg);
    if (projectContext) {
        return projectContext;
    }

    // In private chat - check user's projects
    if (msg.chat.type === 'private') {
        const userId = BigInt(msg.from!.id);
        
        const adminProjects = await prisma.projectAdmin.findMany({
            where: { telegramUserId: userId },
            include: { project: true },
        });

        // If admin of exactly one project, use it
        if (adminProjects.length === 1) {
            return convertToProjectContext(adminProjects[0].project);
        }
    }

    return null; // Multi-project or no projects
}
```

## User Experience

### Before (❌ Broken)
1. User adds bot to group "TestKDT"
2. User runs `/start` in group → Bot responds with welcome
3. User DMs bot and runs `/create_raffle`
4. **ERROR**: "❌ Could not determine project context"

### After (✅ Fixed)
1. User adds bot to group "TestKDT"
2. User runs `/start` in group → Bot responds with welcome
   - **Behind the scenes**: User is auto-promoted to super_admin
3. User DMs bot and runs `/create_raffle`
4. **SUCCESS**: Interactive raffle creation starts! 🎉

## Database Schema

### ProjectAdmin Model
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

## Multi-Project Support

### Single Project Admin (Current Implementation)
- User is admin of **one** project
- `getAdminProjectContext()` automatically returns that project
- Admin commands work seamlessly in DM ✅

### Multi-Project Admin (Future Enhancement)
- User is admin of **multiple** projects
- `getAdminProjectContext()` returns `null`
- Bot should show inline keyboard: "Which project?"
- User selects project
- Command proceeds with selected project

## Security Considerations

1. **Only first `/start` user is promoted**: Subsequent users running `/start` in the same group are NOT auto-promoted
2. **Project-scoped permissions**: Admins can only manage their own projects
3. **Telegram group validation**: Project is tied to Telegram group ID, preventing cross-project access
4. **Cascade deletion**: If project is deleted, all ProjectAdmin records are deleted too

## Testing Checklist

- [ ] Add bot to new group
- [ ] Run `/start` in group as the user who added the bot
- [ ] Check database: ProjectAdmin record created with super_admin permissions
- [ ] DM the bot
- [ ] Run `/create_raffle` in DM
- [ ] Verify: Interactive raffle creation starts successfully
- [ ] Add another user to the group
- [ ] Have them run `/start`
- [ ] Verify: They are NOT auto-promoted (only first user is)
