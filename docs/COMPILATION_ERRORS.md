# Compilation Errors to Fix

## Summary
The multi-tenancy refactoring introduced breaking changes to the `WalletUser` model's unique constraint. It now requires `projectId_walletAddress` compound key instead of just `walletAddress`.

## Files with Errors:

### 1. ✅ src/bot/handlers/index.ts
- **Fixed**: Removed `handleChatInfo` import and commented out handler

### 2. ✅ src/bot/handlers/admin.ts  
- **Fixed**: Added `include: { tickets: true, buyEvents: true }` to `handleResetTickets`

### 3. ❌ src/blockchain/buy-detector.ts (Line 1165)
```typescript
// Error: Type '{ walletAddress: string; }' is not assignable
// Need to change from:
where: { walletAddress: string }
// To:
where: { projectId_walletAddress: { projectId: string, walletAddress: string } }
```

### 4. ❌ src/services/backup-service.ts (Line 328)
```typescript
// Same error as above
where: { walletAddress: any }
```

### 5. ❌ src/workers/sell-worker.ts (Line 79)
```typescript
// Same error
where: { walletAddress: string }
```

### 6. ❌ src/workers/stake-worker.ts (Line 160)
```typescript
// Same error
where: { walletAddress: string }
```

### 7. ❌ src/workers/ticket-worker.ts (Line 70)
```typescript
// Same error
where: { walletAddress: string }
```

### 8. ❌ src/bot/handlers/user.ts (Line 11)
```typescript
// Error: Cannot find module '../middleware/project-context'
// Should be: '../../middleware/project-context'
```

## Solution Strategy:

For WalletUser queries, we need to either:
1. Use the compound key: `{ projectId_walletAddress: { projectId, walletAddress } }`
2. Or use `id` if we have it
3. Or use `findFirst` with `where: { projectId, walletAddress }` instead of `findUnique`

The safest approach for now is to change `findUnique` to `findFirst` with separate `projectId` and `walletAddress` filters.
