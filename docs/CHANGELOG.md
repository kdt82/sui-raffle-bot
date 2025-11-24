# Changelog - November 24, 2025

## Major Updates

### 🎯 Custom Prize Descriptions
Added support for flexible prize configurations including exact numeric amounts and custom multi-line descriptions for milestone-based prizes.

**Features:**
- Exact amount entry (e.g., "500" → displays as "500 SUI")
- Custom multi-line descriptions for milestone prizes
- Example:
  ```
  Reach 10K Market Cap - 100 SUI
  Reach 15K Market Cap - 150 SUI
  Reach 20K Market Cap - 250 SUI
  ```

**Files Changed:**
- `prisma/schema.prisma` - Added `prizeDescription` field
- `src/bot/handlers/admin-ui.ts` - Enhanced prize input flow
- `src/services/raffle-service.ts` - Updated announcement formatting

### 🔄 Fixed Blockberry Sell Detection
Rewrote sell detection to properly handle DEX swaps and transfers using the actual Blockberry API response format.

**Problem Solved:**
- DEX swaps (Cetus, Turbos, etc.) were not being detected
- Old code expected fields that don't exist in current Blockberry API

**Solution:**
- Parse `balanceChanges` array from transactions
- Detect negative balance changes as sells/transfers
- Exclude stake/unstake transactions (handled separately)

**Files Changed:**
- `src/blockchain/sell-detector.ts` - Rewrote `normalizeBlockberryTrades`

### 📢 Restored Staking Announcements
Re-added public announcements to main chat when users stake tokens.

**Features:**
- Public notification when someone stakes
- Shows wallet address and bonus tickets awarded
- Matches format of `/verify_stake` command

**Files Changed:**
- `src/workers/stake-worker.ts` - Added main chat announcement

### 🚨 CRITICAL FIX: Staking No Longer Removes Tickets
Fixed critical bug where staking transactions were incorrectly detected as sells and removing all tickets.

**Problem:**
- Staking shows negative balance change (tokens leave wallet)
- Sell detector was catching this and removing tickets
- User would lose buy tickets instead of gaining bonus tickets

**Solution:**
- Added check to skip transactions with "stake" or "unstake" functions
- These are now only handled by `StakeDetector`

**Files Changed:**
- `src/blockchain/sell-detector.ts` - Added stake/unstake exclusion

### ✨ Proportional Unstaking Logic
Completely rewrote staking bonus calculation to handle edge cases fairly.

**Problem:**
- Old logic: Bonus calculated on total tokens staked (including pre-raffle tokens)
- Old logic: Unstaking removed bonus based on raw amount unstaked
- Result: Users could lose more bonus than they earned

**New Logic:**

**Staking:**
```
bonusTickets = currentTickets × (bonusPercent / 100)
```
- Only calculates bonus on current tickets (eligible tokens)
- Tokens owned before raffle don't contribute to bonus

**Unstaking:**
```
proportionUnstaked = unstakeAmount / currentStakedBalance
bonusToRemove = totalBonusAwarded × proportionUnstaked
```
- Removes bonus proportionally based on percentage unstaked
- Tracks all historical stake events
- Prevents removing more bonus than was awarded

**Example Scenario:**
```
Before raffle: 2,000,000 tokens (0 tickets)
During raffle: Buy 1,000,000 tokens (1,000,000 tickets)
Stake all 3M: +250,000 bonus = 1,250,000 total ✅
Unstake 2M: -166,667 bonus = 1,083,333 remaining ✅
```

**Files Changed:**
- `src/workers/stake-worker.ts` - Rewrote staking/unstaking logic

## Bug Fixes

### Fixed Prize Display
- Prize announcements now show custom descriptions instead of "Custom USDC"
- Both admin confirmation and public announcement updated

### Fixed Sell Detection for Swaps
- Swaps via DEX (Cetus, Turbos) now correctly remove tickets
- Uses `balanceChanges` instead of non-existent trade fields

### Fixed Staking Bonus Calculation
- Bonus only applies to tokens bought during raffle
- Proportional removal prevents over-penalization

## Documentation

### New Documentation Files
- `docs/STAKING_SYSTEM.md` - Comprehensive staking system documentation
  - Logic explanations
  - Complete scenario walkthroughs
  - Edge case handling
  - Technical implementation details
  - Configuration options
  - Troubleshooting guide

## Database Changes

### Schema Updates
```prisma
model Raffle {
  // ... existing fields
  prizeDescription String?  // Optional custom prize description
  stakingBonusPercent Int?  // Staking bonus percentage (already existed)
}
```

## Commands Added

### `/verify_sell <tx_hash>`
Manually verify and process sell transactions.

**Use cases:**
- Missed DEX swaps
- Manual verification
- Debugging

**Example:**
```
/verify_sell QWca5tDWPd697TYKyPM1nm6U4SUxsEjwKjRNYCTVygJ
```

## Breaking Changes

None - all changes are backward compatible.

## Migration Notes

### For Existing Raffles
- Existing raffles continue to work normally
- New prize description feature is optional
- Staking logic improvements apply immediately

### For Administrators
- No action required
- New features available in raffle creation flow
- `/verify_sell` command now available for manual processing

## Performance Improvements

- Optimized Blockberry trade parsing
- Reduced database queries in unstaking logic
- Better event deduplication

## Security Enhancements

- Improved stake/unstake event validation
- Better handling of edge cases in ticket calculations
- Prevented ticket count from going negative

## Known Issues

None at this time.

## Next Steps

Potential future enhancements:
1. Tiered staking bonuses based on duration
2. Lock periods for bonus eligibility
3. Stake leaderboard
4. Analytics dashboard for staking statistics

## Contributors

- Development: AI Assistant
- Testing & Requirements: User

## Deployment

To deploy these changes:

1. Pull latest code from GitHub
2. Run `npm install` (if dependencies changed)
3. Run `npx prisma generate` to update Prisma client
4. Restart the bot

No database migration required - schema was updated via `prisma db push`.
