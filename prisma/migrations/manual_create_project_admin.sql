-- Manual Migration: Create ProjectAdmin for existing project owners
-- Run this if you need to manually promote a user to admin for an existing project

-- Example: Promote user KAMI (Telegram User ID: 6505428730) for TestKDT project
-- Replace the values below with actual user ID and project ID

-- Step 1: Find the project ID for your group
SELECT id, "telegramGroupName", "telegramGroupId" 
FROM "Project" 
WHERE "telegramGroupName" = 'TestKDT';

-- Step 2: Insert ProjectAdmin record (replace PROJECT_ID and USER_ID)
-- Example for KAMI in TestKDT:
INSERT INTO "ProjectAdmin" (id, "projectId", "telegramUserId", permissions, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,  -- Generate a random UUID for id
  'YOUR_PROJECT_ID_HERE',    -- Replace with actual project ID from Step 1
  6505428730,                -- Replace with actual Telegram User ID
  'super_admin',
  NOW(),
  NOW()
)
ON CONFLICT ("projectId", "telegramUserId") DO NOTHING;

-- Step 3: Verify the admin was created
SELECT pa.*, p."telegramGroupName" 
FROM "ProjectAdmin" pa
JOIN "Project" p ON pa."projectId" = p.id
WHERE pa."telegramUserId" = 6505428730;  -- Replace with actual user ID
