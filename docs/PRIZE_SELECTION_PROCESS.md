# Prize Selection Process

This document explains how the prize type is selected during raffle creation and the complete sequence of events from raffle start to prize distribution.

---

## 🎯 Prize Type Selection (During Raffle Creation)

### Step-by-Step Process

#### Step 1: Contract Address Input
Admin enters the token contract address in the format:
```
0xab954d078dab0a6727ce58388931850be4bdb6f72703ea3cad3d6eb0c12a0283::aqua::AQUA
```

#### Step 2: Automatic Token Symbol Extraction
The bot automatically extracts the token symbol from the contract address:

```typescript
// Splits by "::" and takes the last part
CA: 0x...::aqua::AQUA  →  Extracted Symbol: "AQUA"
CA: 0x...::woof::WOOF  →  Extracted Symbol: "WOOF"
CA: 0x...::sui::SUI    →  Extracted Symbol: "SUI"
```

#### Step 3: Prize Type Selection
Admin is presented with three options:

| Button | Description |
|--------|-------------|
| **[Extracted Token]** | The token from the CA (e.g., AQUA, WOOF) |
| **USDC** | Stablecoin option |
| **SUI** | Native SUI token |

**Example Display:**
```
Step 4/7: Prize Type

Select the prize type:
[AQUA]  [USDC]  [SUI]
```

#### Step 4: Prize Amount Input
Admin enters the amount of the selected prize type:
- Example: "1000" for 1000 AQUA
- Example: "500" for 500 USDC
- Example: "250" for 250 SUI

**Result:** 
- Prize Type: `AQUA` (or selected type)
- Prize Amount: `1000`

---

## 📋 Complete Raffle Lifecycle

### Phase 1: Raffle Creation

**Admin Actions:**
1. `/create_raffle` command initiated
2. Contract Address entered (Step 1/7)
3. Start Time configured (Step 2/7)
4. End Time configured (Step 3/7)
5. **Prize Type selected** (Step 4/7) ← Prize Selection
6. **Prize Amount entered** (Step 5/7) ← Prize Selection
7. Ticket Ratio configured (Step 6/7)
8. Minimum Purchase set (Step 7/7) - Optional
9. Announcement Media uploaded (Step 8/11) - Optional
10. Notification Media uploaded (Step 9/11) - Optional
11. Leaderboard Media uploaded (Step 10/11) - Optional
12. Review and Confirm (Step 11/11)

**System Actions:**
- Creates raffle record in database
- Sets status to `ACTIVE`
- Starts buy detection monitoring
- Posts announcement to main chat group

**Database State:**
```javascript
{
  id: "ckXyz123...",
  ca: "0x...::aqua::AQUA",
  prizeType: "AQUA",
  prizeAmount: "1000",
  status: "ACTIVE",
  startTime: "2025-11-07T00:00:00Z",
  endTime: "2025-11-10T23:59:59Z",
  ticketsPerToken: "100"
}
```

---

### Phase 2: Active Raffle Period

**Automatic Processes:**

1. **Buy Detection**
   - Monitors blockchain for token purchases
   - Detects buys matching the contract address
   - Validates minimum purchase requirement (if set)
   - Calculates tickets earned

2. **Ticket Allocation**
   - Creates `BuyEvent` record for each purchase
   - Updates user's total ticket count
   - Broadcasts notification to main chat with countdown

3. **Leaderboard Updates**
   - Real-time tracking of participants
   - Cumulative ticket counts per wallet
   - Rankings by ticket count

**Example Timeline:**
```
Day 1 - 10:00 AM: Alice buys 10 tokens → 1,000 tickets
Day 1 - 02:30 PM: Bob buys 25 tokens → 2,500 tickets
Day 2 - 09:15 AM: Alice buys 5 more tokens → 500 more tickets (1,500 total)
Day 3 - 04:45 PM: Carol buys 15 tokens → 1,500 tickets
```

**Main Chat Notifications:**
```
🎉 NEW BUY DETECTED! 🎉

💰 Amount: 10 tokens
🎟️ Tickets Earned: 1,000
👛 Wallet: 0xabc...123
🔗 Source: On-chain

🏆 Prize Pool: 1000 AQUA
⏱️ Time Remaining: 2d 13h 45m 32s
📅 Ends: 2025-11-10 23:59:59 UTC

Every 1 token purchased = 100 raffle tickets!
```

---

### Phase 3: Raffle Completion (End Time Reached)

**Automatic System Actions:**

1. **Buy Detection Stops**
   - Query filter: `endTime > now()` returns false
   - No more ticket allocations accepted
   - Raffle remains in `ACTIVE` status

2. **Manual Ticket Commands Disabled**
   - `/add_tickets` command checks `endTime > now()`
   - `/remove_tickets` command checks `endTime > now()`
   - Both commands return error if raffle has ended

**Database State:**
```javascript
{
  status: "ACTIVE",  // Still active, but ended
  endTime: "2025-11-10T23:59:59Z",  // Time has passed
  // ... buy detection now ignores this raffle
}
```

**Important Notes:**
- ⚠️ Winner is **NOT** automatically selected
- ⚠️ Admin must manually trigger winner selection
- ✅ All ticket data is frozen at end time
- ✅ No more tickets can be added after end time

---

### Phase 4: Winner Selection (Manual Admin Trigger)

**Admin Command:** `/award_prize`

#### Step 1: Fetch All Tickets
```typescript
// System queries all buy events
const tickets = await prisma.buyEvent.findMany({
  where: { raffleId: raffle.id }
});

// Example Result:
// Alice: 1,500 tickets (2 purchases)
// Bob: 2,500 tickets (1 purchase)
// Carol: 1,500 tickets (1 purchase)
// Total: 5,500 tickets
```

#### Step 2: Request On-Chain Random Number
```typescript
// Request from SUI blockchain
const randomBigInt = await suiClient.getRandomNumber();

// Example: 
// randomBigInt = 98765432109876543210987654321098765432109876543210
```

#### Step 3: Calculate Winning Ticket
```typescript
const totalTickets = 5500;
const winningTicket = Number(randomBigInt % BigInt(totalTickets)) + 1;

// Example:
// 98765432109876543210987654321098765432109876543210 % 5500 = 3210
// Winning Ticket: #3210
```

#### Step 4: Determine Winner
```typescript
// Virtual ticket ranges:
// Alice:  #1 - #1500      (1,500 tickets)
// Bob:    #1501 - #4000   (2,500 tickets)
// Carol:  #4001 - #5500   (1,500 tickets)

// Winning Ticket #3210 falls in Bob's range
// Winner: Bob (0xdef456...)
```

#### Step 5: Create Winner Record
```javascript
{
  raffleId: "ckXyz123...",
  walletAddress: "0xdef456...",
  ticketCount: 2500,
  selectedAt: "2025-11-11T00:05:23Z",
  prizeAwarded: false
}
```

#### Step 6: Update Raffle Status
```javascript
{
  status: "WINNER_SELECTED"  // Changed from ACTIVE
}
```

---

### Phase 5: Winner Announcement (Automatic After Selection)

**System Automatically Sends:**

#### 1. Main Chat Announcement
```
🎉 RAFFLE WINNER ANNOUNCED!

🏆 Prize: 1000 AQUA

👤 Winner: `0xdef456...cd56ef`
🎫 Winning Tickets: 2,500
📊 Total Participants: 3
🎟️ Total Tickets: 5,500

Congratulations to the winner! 🎊
```

#### 2. Winner Direct Message
If wallet is linked to Telegram:
```
🎉🎉🎉 YOU WON! 🎉🎉🎉

🎉 RAFFLE WINNER ANNOUNCED!

🏆 Prize: 1000 AQUA

👤 Winner: `0xdef456...cd56ef`
🎫 Winning Tickets: 2,500
📊 Total Participants: 3
🎟️ Total Tickets: 5,500

Congratulations to the winner! 🎊

The prize will be sent to your wallet shortly!
```

#### 3. All Participants Notification
If they have winner notifications enabled:
- **Winner** sees special "YOU WON!" message
- **Non-winners** see standard announcement
- Only sent to users with linked wallets
- Respects notification preferences

#### 4. Admin Alert
```
🎉 Winner selected!

Winner: `0xdef456...cd56ef`
Tickets: 2,500
Method: on-chain

Award the prize using /award_prize
```

---

### Phase 6: Prize Distribution (Manual Admin Action)

**Admin Manually Sends Prize:**

1. Admin sends `1000 AQUA` to winner's wallet: `0xdef456...`
2. Admin runs: `/award_prize` (marks as awarded in database)

**System Actions:**
```typescript
// Updates winner record
{
  prizeAwarded: true,
  awardedAt: "2025-11-11T00:15:00Z"
}
```

**Admin Confirmation:**
```
✅ Prize marked as awarded!

Raffle ID: ckXyz123...
Winner: 0xdef456...
Tickets: 2,500
Prize: 1000 AQUA

Please send the prize to the winner's wallet address.
```

**Winner Notification:**
```
🎉 Congratulations! You won the raffle!

Prize: 1000 AQUA
Your tickets: 2,500

The prize will be sent to: 0xdef456...
```

---

## 🔄 Complete Event Sequence Summary

| # | Phase | Trigger | Action | Status |
|---|-------|---------|--------|--------|
| 1 | Creation | Admin `/create_raffle` | Prize type/amount configured | `ACTIVE` |
| 2 | Monitoring | Automatic | Buy detection runs | `ACTIVE` |
| 3 | Ticket Allocation | Automatic on purchase | Tickets added to buyers | `ACTIVE` |
| 4 | End Time Reached | Automatic | Buy detection stops | `ACTIVE` |
| 5 | Winner Selection | Admin `/award_prize` | Random winner selected | `WINNER_SELECTED` |
| 6 | Announcements | Automatic | All notifications sent | `WINNER_SELECTED` |
| 7 | Prize Transfer | Manual by Admin | Tokens sent to winner | `WINNER_SELECTED` |
| 8 | Mark as Awarded | Admin `/award_prize` again | Record updated | `WINNER_SELECTED` |

---

## 📊 Timeline Example (3-Day Raffle)

```
Nov 7, 2025 00:00:00 UTC
├─ 🎬 RAFFLE STARTS
│  ├─ Prize: 1000 AQUA selected
│  ├─ Amount: 1000 configured
│  └─ Announcement posted to main chat
│
├─ Nov 7-10: ACTIVE PERIOD
│  ├─ 10:00 AM - Alice buys → 1,000 tickets
│  ├─ 02:30 PM - Bob buys → 2,500 tickets
│  ├─ 09:15 AM - Alice buys more → 500 tickets
│  ├─ 04:45 PM - Carol buys → 1,500 tickets
│  └─ Each buy gets countdown notification
│
Nov 10, 2025 23:59:59 UTC
├─ ⏰ RAFFLE ENDS
│  ├─ Buy detection stops
│  └─ Manual ticket commands disabled
│
Nov 11, 2025 00:05:23 UTC
├─ 🎲 WINNER SELECTED (Admin runs /award_prize)
│  ├─ SUI randomness requested
│  ├─ Winning ticket #3210 calculated
│  ├─ Bob identified as winner
│  ├─ Winner record created
│  └─ Status → WINNER_SELECTED
│
├─ 00:05:24 UTC - ANNOUNCEMENTS (Automatic)
│  ├─ Main chat announcement
│  ├─ Winner DM sent
│  ├─ All participants notified
│  └─ Admin alert sent
│
├─ 00:15:00 UTC - PRIZE TRANSFER (Manual)
│  ├─ Admin sends 1000 AQUA to Bob's wallet
│  └─ Admin runs /award_prize to mark awarded
│
└─ 🏁 RAFFLE COMPLETE
```

---

## 🎯 Key Points Summary

### Prize Selection
- ✅ Prize type extracted from contract address automatically
- ✅ Admin can choose between extracted token, USDC, or SUI
- ✅ Prize amount is flexible (any positive number)
- ✅ Prize configured during raffle creation (Step 4-5 of 11)

### Prize Distribution
- ✅ Winner selected using provably fair SUI randomness
- ✅ Selection is manual trigger by admin (`/award_prize`)
- ✅ Announcements are automatic after selection
- ✅ Prize transfer is manual by admin
- ✅ Marking as awarded is separate admin confirmation

### Important Notes
- ⚠️ Prize type cannot be changed after raffle creation
- ⚠️ Prize amount can be changed with `/set_prize` command during active period
- ⚠️ No automatic winner selection - admin must trigger
- ⚠️ No automatic prize distribution - admin must send manually
- ✅ Complete transparency and verifiable randomness
- ✅ Full audit trail maintained

---

## 📝 Related Documentation

- **[Winner Selection & Verification](WINNER_SELECTION_VERIFICATION.md)** - Detailed winner selection process and on-chain verification
- **[Winner Selection Guide](WINNER_SELECTION.md)** - Technical implementation of randomness
- **[Notifications Guide](NOTIFICATIONS.md)** - User notification system
- **[README.md](../README.md)** - Bot commands and setup

---

## ❓ Frequently Asked Questions

### Can the prize type be changed after raffle creation?
**No.** The prize type is locked when the raffle is created. Use `/set_prize` to change the amount only.

### When is the prize automatically sent?
**Never.** The admin must manually send the prize tokens to the winner's wallet address. The bot only announces the winner.

### What happens if the admin doesn't run `/award_prize`?
The raffle remains in `ACTIVE` status indefinitely. No winner is selected, no announcements are made.

### Can users see what the prize is before the raffle ends?
**Yes!** The prize is displayed in:
- Initial raffle announcement
- Every buy notification (countdown messages)
- `/leaderboard` command
- `/config` command (for admins)

### Is the prize selection fair?
**Yes!** The prize type/amount is configured upfront by the admin and is visible to all participants from the start. There's no lottery for the prize itself - the lottery is for WHO wins the fixed prize.

### What if the winner's wallet is not linked?
- Winner announcement still posted to main chat
- Winner cannot receive direct notification
- Admin can see winner's wallet address
- Prize still sent to the wallet address (no Telegram required)

---

## 🛠️ Admin Tips

### Best Practices
1. **Prize Type**: Choose the same token as the CA for consistency
2. **Prize Amount**: Set attractive amounts to encourage participation
3. **Timing**: Allow enough time after end for winner selection
4. **Communication**: Announce prize details clearly in main chat
5. **Verification**: Double-check wallet address before sending prize

### Common Workflow
```bash
# 1. Create raffle with prize configuration
/create_raffle

# 2. Monitor during active period
/config            # Check stats
/leaderboard       # View participants

# 3. After end time
/award_prize       # Select winner

# 4. Send prize manually
# (Transfer tokens via wallet)

# 5. Mark as complete
/award_prize       # Confirm distribution
```

---

**Last Updated:** November 7, 2025  
**Bot Version:** 1.0.0
