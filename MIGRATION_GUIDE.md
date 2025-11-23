# Migration Instructions - Add Randomness Type

## What was changed
Added a `randomnessType` field to the Raffle model to allow choosing between client-side and on-chain SUI randomness.

## Prerequisites
- Ensure you have access to your database
- Ensure your `.env` file contains a valid `DATABASE_URL`
- Backup your database if running in production

## Steps to Apply Migration

### 1. Check your environment
Make sure you have a `.env` file with `DATABASE_URL` set:
```bash
DATABASE_URL=postgresql://...
```

### 2. Run the migration
```bash
npx prisma migrate dev --name add_randomness_type
```

This will:
- Add the `randomnessType` column to the `Raffle` table
- Set default value to `'client-side'` for all existing raffles  
- Regenerate the Prisma client with the new field
- Clear all TypeScript errors related to `randomnessType`

### 3. Verify the migration
Check that the migration was successful:
```bash
npx prisma migrate status
```

You should see the new migration listed as applied.

### 4. Regenerate Prisma Client (if needed)
If you still see TypeScript errors after migration:
```bash
npx prisma generate
```

## For Production Deployment

When deploying to production (e.g., Railway):

### Option 1: Using Railway's Prisma Deploy
```bash
npx prisma migrate deploy
```

### Option 2: Let Railway auto-migrate
If you have a build command in your `railway.toml` or `package.json`, Railway will run migrations automatically.

Check your `railway.toml`:
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npx prisma migrate deploy && npm run build"
```

## SQL Migration (if you prefer manual)

If you want to apply the migration manually via SQL:

```sql
ALTER TABLE "Raffle" 
ADD COLUMN "randomnessType" TEXT NOT NULL DEFAULT 'client-side';
```

Then update Prisma's migration history:
```bash
npx prisma migrate resolve --applied add_randomness_type
```

## Rollback (if needed)

If you need to rollback this migration:

### Option 1: Revert the schema and create a new migration
1. Remove the `randomnessType` line from `schema.prisma`
2. Run: `npx prisma migrate dev --name remove_randomness_type`

### Option 2: Manual SQL rollback
```sql
ALTER TABLE "Raffle" 
DROP COLUMN "randomnessType";
```

## Post-Migration Verification

1. **Check database structure:**
   ```bash
   npx prisma studio
   ```
   Open a Raffle record and verify the `randomnessType` field exists.

2. **Test raffle creation:**
   - Create a new raffle via `/create_raffle`
   - Verify you see the randomness type selection in Step 11/12
   - Confirm the randomness type appears in the review
   - Create the raffle and check it's saved correctly

3. **Check existing raffles:**
   All existing raffles should automatically have `randomnessType = 'client-side'`

## Troubleshooting

### Error: "Environment variable not found: DATABASE_URL"
- Check your `.env` file exists in the project root
- Verify `DATABASE_URL` is set correctly
- Try: `cp .env.example .env` and update with your credentials

### Error: "Migration failed"
- Check database connection
- Verify you have write permissions
- Check database logs for specific errors

### TypeScript errors persist after migration
- Run: `npx prisma generate`
- Restart your TypeScript server (in VS Code: Ctrl+Shift+P > "Restart TS Server")
- Close and reopen the project

### Migration already exists
If you see "Migration already applied":
- This is normal if you've already run the migration
- Run `npx prisma migrate status` to check current state
- If needed, run `npx prisma generate` to regenerate the client

## Contact

If you encounter issues with the migration, check:
1. The Prisma migration logs in `prisma/migrations/`
2. Your database logs
3. The generated migration SQL file in `prisma/migrations/<timestamp>_add_randomness_type/migration.sql`
