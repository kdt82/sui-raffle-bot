# Buy Detection System

## Overview

The SUI Raffle Bot uses an intelligent buy detection system that **only tracks actual DEX swaps**, automatically filtering out wallet-to-wallet transfers to prevent gaming the raffle system.

## How It Works

### Dual Monitoring System

The bot monitors token transactions through two complementary methods:

1. **Blockberry API** (Primary)
   - Third-party indexing service
   - Fast and efficient
   - Provides trade data with metadata
   - All results validated against on-chain data

2. **Native SUI Events** (Fallback)
   - Direct blockchain monitoring
   - `TransferEvent` listening
   - Used when Blockberry is unavailable
   - All transfers validated for DEX activity

### Transaction Validation

Every detected transfer undergoes rigorous validation:

```typescript
// For each detected transfer/trade:
1. Fetch full transaction details from SUI blockchain
2. Inspect transaction structure
3. Check for MoveCall operations (smart contract calls)
4. Verify transaction contains DEX-related function calls
5. Only process if legitimate DEX swap detected
```

### DEX Detection Criteria

A transaction is classified as a **valid DEX swap** if it contains:

#### ✅ Function Name Indicators
- `swap`
- `trade`
- `exchange`

#### ✅ Known DEX Packages
- **Cetus**: `0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb`
- **Turbos**: `0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1`
- **Kriya**: `0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66`
- **DeepBook**: `0xdee9...`

### What Gets Filtered Out

#### ❌ Wallet-to-Wallet Transfers
- Direct transfers between wallets
- Transactions with only `TransferObjects`
- No MoveCall to DEX contracts
- **Result**: 0 tickets awarded, no notification sent

#### ❌ Below Minimum Purchase
- Transactions that meet minimum token amount
- Valid DEX swaps but below threshold
- **Result**: 0 tickets awarded, no notification sent

## Implementation Details

### Code Location
`src/blockchain/buy-detector.ts`

### Key Functions

#### `isTransferFromDexSwap()`
Validates if a transaction is a genuine DEX swap:
```typescript
private async isTransferFromDexSwap(
  client: SuiClient, 
  txDigest: string
): Promise<boolean>
```

**Returns:**
- `true` - Transaction contains DEX swap operations
- `false` - Simple transfer or non-DEX transaction

### Validation Flow

```
Transfer Detected
    ↓
Fetch Transaction Details
    ↓
Has MoveCall? ──No──→ Reject (simple transfer)
    ↓ Yes
    ↓
Function name contains swap/trade/exchange? ──Yes──→ Accept (DEX swap)
    ↓ No
    ↓
Package ID matches known DEX? ──Yes──→ Accept (DEX swap)
    ↓ No
    ↓
Reject (not a DEX swap)
```

## Benefits

### 🛡️ Anti-Gaming Protection
- Users cannot game the system by transferring tokens between wallets
- Only legitimate purchases from DEXes earn tickets
- Prevents sybil attacks and ticket farming

### 🎯 Fair Distribution
- All participants compete on equal terms
- Only actual token buyers receive tickets
- Transparent and verifiable on-chain

### ⚡ Performance
- Efficient validation with minimal API calls
- Results cached per transaction
- Minimal impact on monitoring speed

## Monitoring & Debugging

### Logs to Watch

**Valid DEX Swap Detected:**
```
[DEBUG] Transfer is from DEX swap
  txDigest: HkN7x...
  function: swap_exact_input
```

**Wallet Transfer Rejected:**
```
[DEBUG] No MoveCall found - simple wallet transfer detected
  txDigest: Abc123...
```

**Blockberry Trade Filtered:**
```
[DEBUG] Blockberry trade is actually a wallet transfer, skipping
  txDigest: Xyz789...
  wallet: 0x1234...
```

### Common Scenarios

| Scenario | Detected? | Tickets Awarded? |
|----------|-----------|------------------|
| Buy on Cetus | ✅ Yes | ✅ Yes |
| Buy on Turbos | ✅ Yes | ✅ Yes |
| Send to friend | ❌ No | ❌ No |
| Buy below minimum | ✅ Yes | ❌ No (0 tickets) |
| Sell token | ✅ Yes (ignored) | ❌ No |

## Configuration

### Environment Variables

```bash
# Blockberry API (optional but recommended)
BLOCKBERRY_API_URL=https://api.blockberry.one
BLOCKBERRY_API_KEY=your_api_key
BLOCKBERRY_POLL_INTERVAL_MS=10000
BLOCKBERRY_POLL_LIMIT=100

# SUI RPC for validation
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
```

### Raffle Settings

Each raffle can configure:
- **Minimum Purchase**: Threshold for earning tickets
- **Tickets Per Token**: Ratio of tickets to tokens
- **Contract Address**: Token to monitor

## Troubleshooting

### Issue: Legitimate buys not detected

**Check:**
1. Is the DEX package ID in the known list?
2. Does the swap function have a recognizable name?
3. Check logs for transaction validation errors

**Solution:** Add DEX package to known list in `buy-detector.ts`

### Issue: Transfers still getting through

**Check:**
1. Is Blockberry API responding correctly?
2. Are transaction details being fetched?
3. Check for validation errors in logs

**Solution:** Review logs and ensure SUI RPC is accessible

## Future Enhancements

- [ ] Automatic DEX package discovery
- [ ] Machine learning-based swap detection
- [ ] Support for cross-chain bridges
- [ ] Multi-hop swap detection
- [ ] DEX whitelist/blacklist per raffle

## Related Documentation

- [Metrics](./METRICS.md) - Buy event tracking
- [Analytics](./ANALYTICS.md) - Buy statistics
- [Notifications](./NOTIFICATIONS.md) - Buy alerts

---

**Last Updated:** November 11, 2025
