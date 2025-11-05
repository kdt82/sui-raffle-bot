import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { notificationService } from '../../services/notification-service';
import { logger } from '../../utils/logger';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';

/**
 * Handle /notifications command - Show notification preferences
 */
export async function handleNotificationsCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'notifications', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('notifications', false);

    try {
      const prefs = await notificationService.getUserPreferences(userId);

      const message = `
🔔 *Your Notification Preferences*

${prefs.ticketAllocations ? '✅' : '❌'} Ticket Allocations
${prefs.raffleReminders ? '✅' : '❌'} Raffle Reminders (24h & 1h)
${prefs.dailySummary ? '✅' : '❌'} Daily Summary
${prefs.winnerAnnouncements ? '✅' : '❌'} Winner Announcements

⏰ Daily Summary Time: ${prefs.preferredTime} ${prefs.timezone}

To change your preferences, use:
/notifications_toggle <type>

Types: tickets, reminders, summary, winners

Example: /notifications_toggle tickets
      `.trim();

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching notification preferences:', error);
      await bot.sendMessage(chatId, '❌ Error fetching your preferences. Please try again.');
    }
  });
}

/**
 * Handle /notifications_toggle command - Toggle notification types
 */
export async function handleNotificationsToggle(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'notifications_toggle', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('notifications_toggle', false);

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        `📝 Usage: /notifications_toggle <type>\n\n` +
        `Types:\n` +
        `• tickets - Ticket allocation notifications\n` +
        `• reminders - Raffle reminder notifications\n` +
        `• summary - Daily summary notifications\n` +
        `• winners - Winner announcement notifications\n\n` +
        `Example: /notifications_toggle tickets`
      );
      return;
    }

    const type = args[0].toLowerCase();
    
    try {
      const prefs = await notificationService.getUserPreferences(userId);
      let updates: any = {};
      let typeName = '';

      switch (type) {
        case 'tickets':
          updates.ticketAllocations = !prefs.ticketAllocations;
          typeName = 'Ticket Allocations';
          break;
        case 'reminders':
          updates.raffleReminders = !prefs.raffleReminders;
          typeName = 'Raffle Reminders';
          break;
        case 'summary':
          updates.dailySummary = !prefs.dailySummary;
          typeName = 'Daily Summary';
          break;
        case 'winners':
          updates.winnerAnnouncements = !prefs.winnerAnnouncements;
          typeName = 'Winner Announcements';
          break;
        default:
          await bot.sendMessage(
            chatId,
            '❌ Invalid type. Use: tickets, reminders, summary, or winners'
          );
          return;
      }

      await notificationService.updateUserPreferences(userId, updates);

      const newValue = Object.values(updates)[0];
      await bot.sendMessage(
        chatId,
        `✅ ${typeName} notifications ${newValue ? 'enabled' : 'disabled'}!`
      );
    } catch (error) {
      logger.error('Error toggling notification preference:', error);
      await bot.sendMessage(chatId, '❌ Error updating your preferences. Please try again.');
    }
  });
}

/**
 * Handle /notifications_time command - Set daily summary time
 */
export async function handleNotificationsTime(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'notifications_time', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('notifications_time', false);

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        `📝 Usage: /notifications_time <HH:mm> [timezone]\n\n` +
        `Examples:\n` +
        `/notifications_time 09:00 UTC\n` +
        `/notifications_time 14:30 America/New_York\n` +
        `/notifications_time 08:00 Europe/London`
      );
      return;
    }

    const time = args[0];
    const timezone = args[1] || 'UTC';

    // Validate time format
    if (!/^\d{2}:\d{2}$/.test(time)) {
      await bot.sendMessage(chatId, '❌ Invalid time format. Use HH:mm (e.g., 09:00)');
      return;
    }

    try {
      await notificationService.updateUserPreferences(userId, {
        preferredTime: time,
        timezone: timezone,
      });

      await bot.sendMessage(
        chatId,
        `✅ Daily summary time set to ${time} ${timezone}!`
      );
    } catch (error) {
      logger.error('Error setting notification time:', error);
      await bot.sendMessage(chatId, '❌ Error updating your time preference. Please try again.');
    }
  });
}

