# Minimum Purchase Feature

## Overview
Added a minimum purchase requirement feature that allows you to set a threshold for token purchases. Only purchases meeting or exceeding this minimum will earn raffle tickets.

## Database Changes
- **New Field**: `minimumPurchase` (String?, optional) added to the `Raffle` model
- The field is nullable, so existing raffles are not affected
- Database migration will run automatically on Railway deployment

## Raffle Creation Workflow
The interactive raffle creation has been updated from 4 steps to 5 steps:

1. **Contract Address** - Token contract to monitor
2. **End Time** - When the raffle ends
3. **Prize Type** - USDC, AQUA, or SUI
4. **Prize Amount** - Amount of the prize
5. **Minimum Purchase** (NEW) - Optional minimum token amount to earn tickets
   - Can be skipped (no minimum)
   - Can be set to any positive number
   - Purchases below this amount will not earn tickets

## Manual Command
New admin command to set/update minimum purchase for active raffle:

### `/set_minimum_purchase <amount>`

**Examples:**
```
/set_minimum_purchase 10      # Set minimum to 10 tokens
/set_minimum_purchase 0       # Remove minimum (all purchases earn tickets)
```

**Features:**
- Updates the active raffle's minimum purchase requirement
- Can be changed at any time during an active raffle
- Setting to 0 removes the minimum
- Shows confirmation message with the new setting

## Buy Detection Logic
The buy detection system now enforces the minimum purchase:

- Before calculating tickets, checks if purchase meets minimum
- If `minimumPurchase` is set and purchase is below threshold:
  - Returns 0 tickets
  - Logs the rejection with purchase and minimum amounts
- If no minimum is set or purchase meets/exceeds minimum:
  - Calculates tickets normally (1 token = 100 tickets)

## User-Facing Changes

### Notification Messages
Buy notifications now show the minimum purchase requirement (if set):
```
🎉 NEW BUY DETECTED! 🎉

💰 Amount: 15.5 tokens
🎟️ Tickets Earned: 1550
👛 Wallet: 0x1234...5678
🔗 Source: On-chain

🏆 Prize Pool: 1000 USDC
⏰ Raffle Ends: Dec 31, 2024, 11:59:59 PM UTC
💎 Minimum Purchase: 10 tokens

Every 1 token purchased = 100 raffle tickets!
```

### Config Display
The `/config` command now displays minimum purchase:
```
⚙️ Raffle Configuration

ID: clx1234567890
Contract Address: 0x123...
DEX: CETUS
Start Time: Nov 1, 2024, 12:00:00 AM
End Time: Dec 31, 2024, 11:59:59 PM
Prize: 1000 USDC
Minimum Purchase: 10 tokens
Status: active
Total Buy Events: 42
Total Tickets: 12500
Unique Wallets: 15
```

## Testing Workflow

### 1. Create a raffle with minimum purchase:
```
/create_raffle
# Follow the interactive steps
# When prompted for minimum purchase, enter: 10
```

### 2. Or set minimum on existing raffle:
```
/set_minimum_purchase 10
```

### 3. Test with purchases:
- Purchase below minimum (e.g., 5 tokens) → 0 tickets
- Purchase at minimum (10 tokens) → 1000 tickets
- Purchase above minimum (15 tokens) → 1500 tickets

### 4. Remove minimum:
```
/set_minimum_purchase 0
```

### 5. Check configuration:
```
/config
```

## Implementation Details

### Files Modified
1. **prisma/schema.prisma** - Added `minimumPurchase` field
2. **src/bot/handlers/admin-ui.ts** - Added Step 5 for minimum purchase
3. **src/bot/handlers/admin.ts** - Added `handleSetMinimumPurchase` function
4. **src/bot/handlers/index.ts** - Registered `/set_minimum_purchase` command
5. **src/blockchain/buy-detector.ts** - Enforces minimum in `calculateTicketCount`
6. **README.md** - Updated admin commands documentation

### Key Functions
- `handleMinimumPurchaseStep()` - Processes user input in creation wizard
- `handleSetMinimumPurchase()` - Handles manual command to set minimum
- `calculateTicketCount()` - Checks minimum before calculating tickets
- `showReviewStep()` - Displays minimum in review
- `handleConfig()` - Shows minimum in config display
- `broadcastBuyNotification()` - Includes minimum in notifications

## Notes
- Minimum purchase is stored as a string to handle decimal precision
- Setting minimum to 0 or null removes the requirement
- The feature is backward compatible - existing raffles work without changes
- Railway will automatically run the Prisma migration on deployment
- All buy events are still recorded, even if they don't earn tickets

## Admin Commands Updated
```
/set_minimum_purchase <amount>  - Set minimum token purchase to earn tickets
```

## Future Enhancements (Optional)
- Add minimum purchase to manual `/create_raffle <args>` command mode
- Add analytics for purchases below minimum
- Add notification when someone buys below minimum
- Allow different minimums for different prize tiers
