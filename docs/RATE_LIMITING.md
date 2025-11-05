# Rate Limiting & Anti-Spam

The bot implements Redis-based rate limiting to prevent spam and abuse.

## Configuration

Rate limits are defined in `src/utils/rate-limiter.ts`:

```typescript
export const RATE_LIMITS = {
  USER_COMMAND: {
    windowMs: 60 * 1000,    // 1 minute
    maxRequests: 10,         // 10 requests per minute
  },
  
  LINK_WALLET: {
    windowMs: 60 * 1000,    // 1 minute  
    maxRequests: 3,          // 3 attempts per minute
  },
  
  ADMIN_COMMAND: {
    windowMs: 60 * 1000,    // 1 minute
    maxRequests: 30,         // 30 requests per minute
  },
  
  CREATE_RAFFLE: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 3,           // 3 attempts per 5 minutes
  },
  
  LEADERBOARD: {
    windowMs: 30 * 1000,     // 30 seconds
    maxRequests: 5,           // 5 requests per 30 seconds
  },
  
  UPLOAD_MEDIA: {
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 5,           // 5 uploads per minute
  },
  
  CALLBACK_QUERY: {
    windowMs: 10 * 1000,     // 10 seconds
    maxRequests: 20,          // 20 clicks per 10 seconds
  },
};
```

## How It Works

1. **Sliding Window**: Uses Redis sorted sets for accurate sliding window rate limiting
2. **Per-User**: Each user has their own rate limit counter
3. **Per-Action**: Different actions have different limits
4. **Automatic Cleanup**: Old entries are automatically removed
5. **Fail Open**: If Redis is unavailable, requests are allowed (graceful degradation)

## User Experience

When a user hits a rate limit, they see:

```
⏳ Rate limit exceeded. Please wait 1 minute and 23 seconds before trying again.

This limit helps prevent spam and keeps the bot responsive for everyone.
```

For callback queries (button clicks):
```
⏳ Too many requests. Please slow down.
```

## Protected Commands

### User Commands
- `/start` - 10 per minute
- `/leaderboard` - 5 per 30 seconds (more strict to prevent spam)
- `/mytickets` - 10 per minute
- `/linkwallet` - 3 per minute (strict to prevent abuse)

### Admin Commands
- `/create_raffle` - 3 per 5 minutes
- `/set_prize` - 30 per minute
- `/upload_media` - 5 per minute
- `/award_prize` - 30 per minute
- `/config` - 30 per minute

### UI Interactions
- Button clicks - 20 per 10 seconds
- Conversation messages - 20 per 10 seconds (global flood check)

## Usage in Code

### For Commands

```typescript
import { withRateLimit, RATE_LIMITS } from './rate-limit-middleware';

export async function handleMyCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'my_command', RATE_LIMITS.USER_COMMAND, async () => {
    // Your command logic here
  });
}
```

### For Callback Queries

```typescript
import { withCallbackRateLimit } from './rate-limit-middleware';

bot.on('callback_query', async (query) => {
  await withCallbackRateLimit(query, 'my_callback', async () => {
    // Your callback logic here
  });
});
```

### Custom Rate Limit

```typescript
const customLimit = {
  windowMs: 2 * 60 * 1000,  // 2 minutes
  maxRequests: 5,            // 5 requests per 2 minutes
};

return withRateLimit(msg, 'custom_action', customLimit, async () => {
  // Your logic here
});
```

## Admin Features

### Reset User Rate Limit

```typescript
import { resetUserRateLimit } from './rate-limit-middleware';

// Reset specific action
await resetUserRateLimit(userId, 'link_wallet');

// Reset all actions
await resetUserRateLimit(userId);
```

### Check Current Usage

```typescript
import { rateLimiter } from './utils/rate-limiter';

const usage = await rateLimiter.getUsage('userId:action', 60000);
console.log(`User has made ${usage} requests in the last minute`);
```

## Monitoring

Rate limit violations are tracked in metrics:

```promql
# Rate limit violations per minute
rate(errors_total{type="rate_limit"}[1m])

# Rate limit violations by action
sum by (component) (errors_total{type="rate_limit"})
```

## Customization

To adjust limits, edit `RATE_LIMITS` in `src/utils/rate-limiter.ts`:

```typescript
export const RATE_LIMITS = {
  // Add your custom limits here
  MY_CUSTOM_ACTION: {
    windowMs: 30 * 1000,   // 30 seconds
    maxRequests: 3,         // 3 requests
  },
};
```

## Testing

```bash
# Test rate limiting
curl -X POST http://localhost:3000/test-rate-limit

# Check Redis keys
redis-cli keys "ratelimit:*"

# View specific rate limit
redis-cli zrange "ratelimit:12345:link_wallet" 0 -1 WITHSCORES
```

## Best Practices

1. **Be Generous**: Don't make limits too strict
2. **Different Limits**: Use stricter limits for sensitive actions
3. **Clear Messages**: Tell users when they'll be able to try again
4. **Monitor**: Track rate limit violations to adjust limits
5. **Admin Override**: Provide way for admins to reset limits for legitimate users
6. **Fail Open**: Allow requests if rate limiter fails

## Security Benefits

- **Prevents spam**: Users can't flood the bot
- **Reduces abuse**: Limits wallet linking attempts
- **Protects resources**: Database and API calls are limited
- **Fair usage**: Ensures all users get responsive service
- **DoS protection**: Makes it harder to overload the bot

