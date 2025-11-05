import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { resetUserRateLimit } from '../rate-limit-middleware';
import { requireAdmin } from '../middleware';
import { logger } from '../utils/logger';

// Add this to your admin handlers registration

export async function handleResetRateLimit(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length === 0) {
    await bot.sendMessage(
      chatId,
      `📝 Usage: /reset_ratelimit <user_id> [action]\n\n` +
      `Examples:\n` +
      `/reset_ratelimit 123456789 - Reset all limits for user\n` +
      `/reset_ratelimit 123456789 link_wallet - Reset specific action\n\n` +
      `Common actions: link_wallet, leaderboard, start, user_command`
    );
    return;
  }

  const userId = BigInt(args[0]);
  const action = args[1] || undefined;

  try {
    await resetUserRateLimit(userId, action);
    await bot.sendMessage(
      chatId,
      `✅ Rate limit reset for user ${userId}${action ? ` (action: ${action})` : ' (all actions)'}`
    );
    logger.info(`Admin ${msg.from!.id} reset rate limit for user ${userId}, action: ${action || 'all'}`);
  } catch (error) {
    logger.error('Error resetting rate limit:', error);
    await bot.sendMessage(chatId, '❌ Error resetting rate limit. Please try again.');
  }
}

// Register this in your handlers/index.ts:
// bot.onText(/\/reset_ratelimit/, async (msg) => {
//   await requireAdmin(msg, async () => {
//     await handleResetRateLimit(msg);
//   });
// });

