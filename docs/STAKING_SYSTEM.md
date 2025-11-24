# Staking System Documentation

## Overview

The raffle bot includes a sophisticated staking bonus system that rewards users who stake their tokens on Moonbags.io during an active raffle. This document explains how the system works, the logic behind ticket calculations, and important edge cases.

## How It Works

### Basic Concept

Users who stake their raffle tokens on Moonbags.io receive **bonus raffle tickets** on top of their regular tickets from token purchases. The bonus percentage is configurable per raffle (default: 25%).

### Key Principles

1. **Bonus applies only to eligible tokens**: Only tokens purchased during the active raffle period earn bonus tickets when staked
2. **Proportional unstaking**: When unstaking, bonus tickets are removed proportionally based on the amount unstaked
3. **Fair calculation**: The system prevents users from gaming the system by staking tokens owned before the raffle started

## Ticket Calculation Logic

### When Staking

**Formula:**
```
bonusTickets = currentTickets × (bonusPercent / 100)
```

**Why this works:**
- `currentTickets` represents tokens bought during the raffle (eligible tokens)
- Tokens owned before the raffle don't generate tickets, so they don't contribute to the bonus
- The bonus is calculated on the user's actual raffle participation

**Example:**
```
User has 1,000,000 tickets (from buying 1M tokens during raffle)
Bonus percent: 25%
Bonus tickets = 1,000,000 × 0.25 = 250,000 tickets
Total tickets = 1,000,000 + 250,000 = 1,250,000 tickets
```

### When Unstaking

**Formula:**
```
proportionUnstaked = unstakeAmount / currentStakedBalance
bonusToRemove = totalBonusAwarded × proportionUnstaked
```

**Why this works:**
- Calculates what percentage of the total staked amount is being unstaked
- Removes the same percentage of bonus tickets that were awarded
- Prevents removing more bonus than was actually earned

**Example:**
```
Total staked: 3,000,000 tokens
Total bonus awarded: 250,000 tickets
Unstaking: 2,000,000 tokens

Proportion = 2,000,000 / 3,000,000 = 66.67%
Bonus to remove = 250,000 × 0.6667 = 166,667 tickets
Remaining tickets = 1,250,000 - 166,667 = 1,083,333 tickets
```

## Complete Scenario Walkthrough

### Scenario: User with Pre-Existing Tokens

**Initial State:**
- User owns 2,000,000 tokens **before** raffle starts
- Raffle starts with 1:1 ticket ratio and 25% staking bonus

**Step 1: Buy Tokens During Raffle**
```
Buy: 1,000,000 tokens
Tickets awarded: 1,000,000 (ratio 1:1)
Total tickets: 1,000,000
```

**Step 2: Stake All Tokens (3,000,000 total)**
```
Current tickets: 1,000,000 (eligible tokens only)
Bonus calculation: 1,000,000 × 25% = 250,000 bonus tickets
New total: 1,000,000 + 250,000 = 1,250,000 tickets ✅
```

**Step 3: Unstake 2,000,000 Tokens**
```
Total staked: 3,000,000
Unstaking: 2,000,000
Proportion: 2,000,000 / 3,000,000 = 66.67%

Total bonus awarded: 250,000
Bonus to remove: 250,000 × 66.67% = 166,667 tickets

Remaining tickets: 1,250,000 - 166,667 = 1,083,333 tickets ✅
```

**Final State:**
```
Staked tokens: 1,000,000
Original tickets: 1,000,000
Remaining bonus: 83,333
Total tickets: 1,083,333 ✅
```

## Edge Cases

### Case 1: Unstake Everything
```
Unstake: 3,000,000 / 3,000,000 = 100%
Bonus removed: 250,000 × 100% = 250,000 (all bonus)
Remaining: 1,000,000 tickets (original buy tickets only) ✅
```

### Case 2: Unstake Only Eligible Tokens
```
Unstake: 1,000,000 / 3,000,000 = 33.33%
Bonus removed: 250,000 × 33.33% = 83,333
Remaining: 1,166,667 tickets ✅
```

### Case 3: Multiple Stake/Unstake Cycles
The system tracks all historical stake events and calculates:
- Cumulative total staked amount
- Cumulative total unstaked amount
- Total bonus tickets awarded across all stakes
- Proportional removal based on the entire staking history

### Case 4: Nothing Currently Staked
If a user tries to unstake when they have no staked balance:
- All remaining bonus tickets are removed
- Original tickets from purchases remain intact

## Technical Implementation

### Components

1. **StakeDetector** (`src/blockchain/stake-detector.ts`)
   - Monitors Moonbags.io stake/unstake events
   - Filters events by raffle token address
   - Queues stake events for processing

2. **StakeWorker** (`src/workers/stake-worker.ts`)
   - Processes stake/unstake events from the queue
   - Calculates bonus tickets for stakes
   - Calculates proportional removal for unstakes
   - Updates ticket counts in the database
   - Sends notifications to users and admins

3. **Database Models**
   - `StakeEvent`: Records all stake/unstake transactions
   - `Ticket`: Stores current ticket count per user per raffle

### Key Functions

#### Staking Logic
```typescript
if (stakeType === 'stake') {
    const bonusPercent = raffle.stakingBonusPercent || 25;
    const bonusTickets = Math.floor(currentCount * (bonusPercent / 100));
    
    newCount = currentCount + bonusTickets;
    actualAdjustment = bonusTickets;
}
```

#### Unstaking Logic
```typescript
// Get all stake events for this wallet
const allStakeEvents = await prisma.stakeEvent.findMany({
    where: { raffleId, walletAddress, processed: true },
    orderBy: { timestamp: 'asc' },
});

// Calculate totals
let totalStaked = 0n;
let totalUnstaked = 0n;
let totalBonusAwarded = 0;

for (const evt of allStakeEvents) {
    if (evt.stakeType === 'stake') {
        totalStaked += BigInt(evt.tokenAmount);
        totalBonusAwarded += evt.ticketsAdjusted;
    } else {
        totalUnstaked += BigInt(evt.tokenAmount);
    }
}

// Calculate proportional removal
const currentStaked = totalStaked - totalUnstaked;
const unstakeAmount = BigInt(tokenAmount);
const proportionUnstaked = Number(unstakeAmount * 10000n / currentStaked) / 10000;
const bonusToRemove = Math.floor(totalBonusAwarded * proportionUnstaked);
```

## Configuration

### Per-Raffle Settings

- **`stakingBonusPercent`**: Percentage bonus for staking (default: 25)
  - Set to `null` to disable staking bonuses for a raffle
  - Can be any positive number (e.g., 10, 25, 50, 100)

### Environment Variables

- **`MOONBAGS_STAKE_EVENT`**: Event type for stake events
- **`MOONBAGS_UNSTAKE_EVENT`**: Event type for unstake events
- **`STAKE_POLL_INTERVAL_MS`**: How often to check for new stake events

## Admin Commands

### `/verify_stake <tx_hash>`
Manually verify and process a staking transaction. Useful for:
- Missed stake events
- Manual backfilling
- Debugging

**Example:**
```
/verify_stake 2CVc8uh25sCUQwadCvwViaKE7sUHRdwuj4oiuqBgxCPo
```

## Notifications

### User Notifications

When a user stakes:
```
🎁 Staking Bonus!

You've staked your tokens and earned bonus tickets!
📈 Bonus Tickets: +250,000
🎫 Total Tickets: 1,250,000

Keep your tokens staked until the winner is selected to maintain your bonus!
```

When a user unstakes:
```
⚠️ Unstaking Penalty

You've unstaked your tokens and lost bonus tickets.
📉 Bonus Tickets Removed: -166,667
🎫 Remaining Tickets: 1,083,333

Stake again to earn bonus tickets!
```

### Public Announcements

When someone stakes (sent to main chat):
```
📢 Staking Bonus Awarded!

Wallet `0xdf35...f6c2` has staked tokens on Moonbags.io!
🎟️ They have been awarded an additional 250,000 tickets in the raffle!
```

### Admin Alerts

Admins receive detailed notifications:
```
📈 Staked Tokens Detected

👤 Wallet: `0xdf358ad3258ea732f705b6e6d0f652f21b5878a388c427affff622f0d137f6c2`
📈 Tickets Added: 250,000
🎫 Total Tickets: 1,250,000
🔗 Event ID: `stake_event_123`
```

## Security Considerations

1. **Event Deduplication**: All stake events are tracked by transaction hash to prevent double-processing
2. **Timestamp Validation**: Only events during the raffle period are counted
3. **Token Validation**: Events are filtered by the raffle's token address
4. **Proportional Math**: Uses BigInt for precise calculations to prevent rounding errors
5. **Minimum Bounds**: Ticket counts never go below 0

## Troubleshooting

### Stake Event Not Detected

1. Check if the transaction is on Moonbags.io
2. Verify the token address matches the raffle CA
3. Use `/verify_stake <tx_hash>` to manually process
4. Check admin alerts for any errors

### Incorrect Bonus Calculation

1. Verify the raffle's `stakingBonusPercent` setting
2. Check the user's ticket count before staking
3. Review stake event records in the database
4. Check for multiple stake/unstake cycles

### Bonus Not Removed on Unstake

1. Verify unstake event was detected
2. Check if user had any staked balance
3. Review all stake events for the wallet
4. Use admin panel to check ticket history

## Future Enhancements

Potential improvements to consider:

1. **Tiered Bonuses**: Different bonus percentages based on stake duration
2. **Lock Periods**: Require minimum stake duration for bonus
3. **Compound Bonuses**: Additional bonuses for re-staking
4. **Stake Leaderboard**: Show top stakers in the raffle
5. **Stake Analytics**: Dashboard showing staking statistics

## Related Documentation

- [Sell Detection System](./SELL_DETECTION.md)
- [Prize System](./PRIZE_SYSTEM.md)
- [Admin Commands](./ADMIN_COMMANDS.md)
