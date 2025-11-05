import TelegramBot from 'node-telegram-bot-api';
import { bot } from './index';
import { rateLimiter, RATE_LIMITS, createRateLimitKey, RateLimitConfig } from '../utils/rate-limiter';
import { logger } from '../utils/logger';
import { recordError } from '../utils/metrics';

/**
 * Middleware to apply rate limiting to bot commands
 */
export async function withRateLimit(
  msg: TelegramBot.Message,
  action: string,
  config: RateLimitConfig,
  callback: () => Promise<void>
): Promise<void> {
  const userId = BigInt(msg.from!.id);
  const chatId = msg.chat.id;
  const key = createRateLimitKey(userId, action);

  try {
    const result = await rateLimiter.checkLimit(key, config);

    if (!result.allowed) {
      const resetIn = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);
      const minutes = Math.floor(resetIn / 60);
      const seconds = resetIn % 60;
      const timeString = minutes > 0 
        ? `${minutes} minute${minutes !== 1 ? 's' : ''} and ${seconds} second${seconds !== 1 ? 's' : ''}`
        : `${seconds} second${seconds !== 1 ? 's' : ''}`;

      await bot.sendMessage(
        chatId,
        `⏳ Rate limit exceeded. Please wait ${timeString} before trying again.\n\n` +
        `This limit helps prevent spam and keeps the bot responsive for everyone.`
      );

      logger.warn(`Rate limit exceeded: User ${userId}, Action: ${action}`);
      recordError('rate_limit', action);
      return;
    }

    // Execute the callback if rate limit allows
    await callback();
  } catch (error) {
    logger.error('Rate limit middleware error:', error);
    // On error, execute callback anyway (fail open)
    await callback();
  }
}

/**
 * Rate limit middleware for callback queries
 */
export async function withCallbackRateLimit(
  query: TelegramBot.CallbackQuery,
  action: string,
  callback: () => Promise<void>
): Promise<void> {
  const userId = BigInt(query.from.id);
  const key = createRateLimitKey(userId, action);

  try {
    const result = await rateLimiter.checkLimit(key, RATE_LIMITS.CALLBACK_QUERY);

    if (!result.allowed) {
      await bot.answerCallbackQuery(query.id, {
        text: '⏳ Too many requests. Please slow down.',
        show_alert: true,
      });

      logger.warn(`Callback rate limit exceeded: User ${userId}, Action: ${action}`);
      recordError('rate_limit_callback', action);
      return;
    }

    // Execute the callback if rate limit allows
    await callback();
  } catch (error) {
    logger.error('Callback rate limit middleware error:', error);
    // On error, execute callback anyway (fail open)
    await callback();
  }
}

/**
 * Check if user is flooding (global check across all commands)
 */
export async function checkGlobalFlood(userId: bigint): Promise<boolean> {
  const key = createRateLimitKey(userId, 'global');
  const config = {
    windowMs: 10 * 1000,  // 10 seconds
    maxRequests: 20,       // 20 requests across all commands
  };

  const result = await rateLimiter.checkLimit(key, config);
  return !result.allowed;
}

/**
 * Admin command to reset rate limit for a user (for support purposes)
 */
export async function resetUserRateLimit(userId: bigint, action?: string): Promise<void> {
  if (action) {
    const key = createRateLimitKey(userId, action);
    await rateLimiter.resetLimit(key);
  } else {
    // Reset all common actions
    const actions = ['user_command', 'link_wallet', 'leaderboard', 'global'];
    for (const act of actions) {
      const key = createRateLimitKey(userId, act);
      await rateLimiter.resetLimit(key);
    }
  }
  logger.info(`Rate limit reset for user ${userId}, action: ${action || 'all'}`);
}

