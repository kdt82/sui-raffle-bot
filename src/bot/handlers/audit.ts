import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { auditService } from '../../services/audit-service';
import { logger } from '../../utils/logger';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';
import { formatDateShort } from '../../utils/constants';

/**
 * View recent audit logs
 * Admin only command
 */
export async function handleAuditLogsCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'audit_logs', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('auditlogs', true);

    try {
      // Get last 20 logs
      const logs = await auditService.queryLogs({ limit: 20 });

      if (logs.length === 0) {
        await bot.sendMessage(chatId, '📋 No audit logs found.');
        return;
      }

      let message = '📋 *Recent Audit Logs* (Last 20)\n\n';

      for (const log of logs) {
        const timestamp = formatDateShort(new Date(log.timestamp));

        const performer = log.performedBy
          ? `@${log.performedByUsername || log.performedBy.toString()}`
          : 'System';

        const statusIcon = log.success ? '✅' : '❌';

        message += `${statusIcon} ${timestamp} UTC\n`;
        message += `   Action: \`${log.action}\`\n`;
        message += `   By: ${performer}\n`;

        if (log.targetEntity) {
          const shortEntity = log.targetEntity.length > 12
            ? `${log.targetEntity.slice(0, 8)}...`
            : log.targetEntity;
          message += `   Target: \`${shortEntity}\`\n`;
        }

        if (!log.success && log.errorMessage) {
          message += `   Error: ${log.errorMessage.substring(0, 50)}\n`;
        }

        message += '\n';
      }

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching audit logs:', error);
      await bot.sendMessage(chatId, '❌ Error fetching audit logs.');
    }
  });
}

/**
 * View audit logs for a specific raffle
 * Usage: /auditlogs_raffle <raffleId>
 */
export async function handleAuditLogsRaffleCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'audit_logs_raffle', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('auditlogs_raffle', true);

    const args = msg.text?.split(' ').slice(1) || [];

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        '📝 Usage: /auditlogs\\_raffle <raffleId>\n\nExample: /auditlogs\\_raffle cm2abc123',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const raffleId = args[0].trim();

    try {
      const logs = await auditService.getRaffleLogs(raffleId, 30);

      if (logs.length === 0) {
        await bot.sendMessage(chatId, `📋 No audit logs found for raffle \`${raffleId}\`.`, {
          parse_mode: 'Markdown',
        });
        return;
      }

      let message = `📋 *Audit Logs for Raffle*\n\`${raffleId}\`\n\n`;

      for (const log of logs) {
        const timestamp = formatDateShort(new Date(log.timestamp));

        const performer = log.performedBy
          ? `@${log.performedByUsername || log.performedBy.toString()}`
          : 'System';

        const statusIcon = log.success ? '✅' : '❌';

        message += `${statusIcon} ${timestamp} - \`${log.action}\`\n`;
        message += `   By: ${performer}\n`;

        if (log.metadata) {
          try {
            const meta = JSON.parse(log.metadata);
            if (meta.addedAmount) message += `   Added: ${meta.addedAmount} tickets\n`;
            if (meta.removedAmount) message += `   Removed: ${meta.removedAmount} tickets\n`;
            if (meta.walletAddress) {
              const shortWallet = `${meta.walletAddress.slice(0, 6)}...${meta.walletAddress.slice(-4)}`;
              message += `   Wallet: \`${shortWallet}\`\n`;
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }

        message += '\n';
      }

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching raffle audit logs:', error);
      await bot.sendMessage(chatId, '❌ Error fetching audit logs.');
    }
  });
}

/**
 * View failed actions in the last 24 hours
 */
export async function handleAuditFailuresCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'audit_failures', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('auditfailures', true);

    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

      const logs = await auditService.getFailedActions(startDate, endDate);

      if (logs.length === 0) {
        await bot.sendMessage(chatId, '✅ No failures in the last 24 hours!');
        return;
      }

      let message = `⚠️ *Failed Actions (Last 24h)*\nTotal: ${logs.length}\n\n`;

      for (const log of logs.slice(0, 15)) {
        // Show max 15
        const timestamp = formatDateShort(new Date(log.timestamp));

        message += `❌ ${timestamp} - \`${log.action}\`\n`;

        if (log.errorMessage) {
          const shortError = log.errorMessage.substring(0, 60);
          message += `   ${shortError}${log.errorMessage.length > 60 ? '...' : ''}\n`;
        }

        message += '\n';
      }

      if (logs.length > 15) {
        message += `\n_Showing 15 of ${logs.length} failures_`;
      }

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching audit failures:', error);
      await bot.sendMessage(chatId, '❌ Error fetching failures.');
    }
  });
}
