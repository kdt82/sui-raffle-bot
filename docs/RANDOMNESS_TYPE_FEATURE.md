# SUI Randomness Type Selection Feature

## Overview
This feature adds the ability to choose between **client-side** and **on-chain SUI randomness** when creating a raffle. This gives administrators control over the winner selection method based on their needs for verifiability vs. simplicity.

## Changes Made

### 1. Database Schema (`prisma/schema.prisma`)
Added a new field to the `Raffle` model:
```prisma
randomnessType String @default("client-side") // on-chain, client-side - determines winner selection method
```

**Values:**
- `client-side` (default): Uses standard JavaScript randomness for quick winner selection
- `on-chain`: Uses SUI blockchain randomness for verifiable, provably fair winner selection

### 2. Raffle Creation UI (`src/bot/handlers/admin-ui.ts`)

#### New Step Added
Added **Step 11/12: Randomness Type** to the raffle creation wizard, which appears after the leaderboard media step and before the final review.

**UI Elements:**
- Two buttons for selection:
  - 🎲 **Client-Side (Default)**: Fast, uses standard randomness
  - ⛓️ **On-Chain SUI**: Uses SUI blockchain randomness for verifiable fairness

#### Updated Functions
- `handleLeaderboardMediaStep()`: Now advances to randomness type selection
- `handleRandomnessTypeStep()`: New function to handle randomness type step
- `handleCreateRaffleCallback()`: Added handlers for:
  - `select_randomness_client`: Sets randomness type to 'client-side'
  - `select_randomness_onchain`: Sets randomness type to 'on-chain'
  - `back_to_randomness_type`: Navigation back from review step
- `showReviewStep()`: Updated to display randomness type in the review
- `createRaffleFromData()`: Saves the randomness type to the database

### 3. Winner Selection (`src/services/winner-service.ts`)

Modified `selectWinnerWithRandomness()` to:
1. Fetch the raffle's `randomnessType` preference from the database
2. Only use on-chain randomness if:
   - The raffle's `randomnessType` is set to `'on-chain'`, AND
   - SUI randomness is configured (env variables set)
3. Log the randomness method being used
4. Fall back to client-side if on-chain is requested but not configured

**Behavior:**
- **Client-Side Selected**: Always uses `clientSideWeightedRandom()`
- **On-Chain Selected + Configured**: Uses `suiRandomnessService.generateWeightedRandom()`
- **On-Chain Selected + Not Configured**: Falls back to client-side with warning log

## Migration Required

After making these changes, you need to apply the database migration:

```bash
npx prisma migrate dev --name add_randomness_type
```

This will:
1. Add the `randomnessType` column to the `Raffle` table
2. Set default value to `'client-side'` for all existing raffles
3. Generate the Prisma client with the new field

## Configuration

### On-Chain Randomness Setup
To enable on-chain randomness, set these environment variables in your `.env` file:

```bash
SUI_RANDOMNESS_PACKAGE_ID=<your_package_id>
SUI_RANDOMNESS_OBJECT_ID=<your_randomness_object_id>
```

If these are not set, raffles that request on-chain randomness will automatically fall back to client-side.

## User Flow

### Creating a Raffle with Randomness Selection

1. Admin starts raffle creation: `/create_raffle`
2. Goes through standard steps (contract, times, prize, etc.)
3. After setting leaderboard media, sees:
   ```
   Step 11/12: Randomness Type
   
   🎲 Choose how the winner will be selected:
   
   • Client-Side: Fast, uses standard randomness (default)
   • On-Chain SUI: Uses SUI blockchain randomness for verifiable fairness
   
   Select randomness type:
   [🎲 Client-Side (Default)] [⛓️ On-Chain SUI]
   ```
4. Selects preferred randomness type
5. Reviews all raffle details including randomness type
6. Confirms and creates raffle

### Review Display
The review step now shows:
```
📋 Review Raffle Details

Contract Address: `0x...`
DEX: CETUS
Prize Type: SUI
Prize Amount: 1000
Ticket Ratio: 100 tickets per token
Minimum Purchase: None
Announcement Media: image attached
Notification Media: None
Leaderboard Media: None
Randomness: 🎲 Client-Side (Default)  // or ⛓️ On-Chain SUI (Verifiable)

Please review and confirm:
```

## Winner Selection Process

### With Client-Side (Default)
```typescript
// Fast, standard JavaScript random
const { index, winningTicket } = clientSideWeightedRandom(weights);
```

### With On-Chain SUI
```typescript
// Blockchain-based verifiable randomness
const { index, winningTicket } = await suiRandomnessService.generateWeightedRandom(
  weights,
  raffleId
);
// Also generates proof for verification
const proof = await suiRandomnessService.generateVerifiableRandom(
  totalTickets,
  raffleId
);
```

## Benefits

### Client-Side Randomness
- ✅ Fast execution
- ✅ No blockchain dependencies
- ✅ Works immediately without setup
- ✅ Default and reliable

### On-Chain SUI Randomness
- ✅ Verifiable fairness
- ✅ Blockchain-based proof
- ✅ Transparent and auditable
- ✅ Higher trust for high-value raffles
- ⚠️ Requires SUI configuration
- ⚠️ Depends on blockchain availability

## Backward Compatibility

All existing raffles will:
- Have `randomnessType` set to `'client-side'` (via database default)
- Continue to work exactly as before
- Use the same winner selection logic they always have

No changes are required for existing raffles or data.

## Testing

### Test Client-Side Selection
1. Create a raffle via `/create_raffle`
2. Select "Client-Side (Default)" in Step 11
3. Complete raffle creation
4. Verify in logs: `Using client-side randomness for raffle {id}`
5. Winner selected with `selectionMethod: 'client-side'`

### Test On-Chain Selection (Without Configuration)
1. Create a raffle via `/create_raffle`
2. Select "On-Chain SUI" in Step 11
3. Complete raffle creation
4. Verify in logs: `Raffle {id} requested on-chain randomness but it's not configured. Falling back to client-side.`
5. Winner selected with `selectionMethod: 'client-side'`

### Test On-Chain Selection (With Configuration)
1. Set `SUI_RANDOMNESS_PACKAGE_ID` and `SUI_RANDOMNESS_OBJECT_ID`
2. Create a raffle via `/create_raffle`
3. Select "On-Chain SUI" in Step 11
4. Complete raffle creation
5. Verify in logs: `Using SUI on-chain randomness for raffle {id}`
6. Winner selected with `selectionMethod: 'on-chain'` and randomness proof

## Files Modified

1. `prisma/schema.prisma` - Added `randomnessType` field
2. `src/bot/handlers/admin-ui.ts` - Added randomness type selection step
3. `src/services/winner-service.ts` - Updated to respect raffle's randomness preference

## Next Steps

1. ✅ Run the database migration: `npx prisma migrate dev --name add_randomness_type`
2. ⚠️ Test raffle creation with both randomness types
3. ⚠️ (Optional) Configure SUI on-chain randomness if you want to use it
4. ⚠️ Deploy to production when ready

---

*Feature completed on: 2025-11-15*
