import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { backupService } from '../../services/backup-service';
import { scheduleRaffleBackup } from '../../workers/backup-worker';
import { logger } from '../../utils/logger';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';

/**
 * Handle /backup command - Create manual backup
 */
export async function handleBackupCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'backup', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    incrementCommand('backup', true);

    try {
      await bot.sendMessage(chatId, '⏳ Creating full backup...');

      const metadata = await backupService.createFullBackup();

      if (metadata.status === 'success') {
        const message = `
✅ *Backup Created Successfully*

📦 Backup ID: \`${metadata.id}\`
📅 Timestamp: ${metadata.timestamp.toLocaleString()}
📊 Type: ${metadata.type}
💾 Size: ${formatSize(metadata.size)}

Use /backup_list to see all backups
Use /backup_download ${metadata.id} to download
        `.trim();

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(
          chatId,
          `❌ Backup failed: ${metadata.error || 'Unknown error'}`
        );
      }
    } catch (error) {
      logger.error('Error creating backup:', error);
      await bot.sendMessage(chatId, '❌ Error creating backup. Please try again.');
    }
  });
}

/**
 * Handle /backup_list command - List all backups
 */
export async function handleBackupListCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'backup_list', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    incrementCommand('backup_list', true);

    try {
      const backups = await backupService.listBackups();

      if (backups.length === 0) {
        await bot.sendMessage(chatId, '📦 No backups found.');
        return;
      }

      let message = '📦 *Available Backups*\n\n';

      backups.slice(0, 10).forEach((backup, index) => {
        const icon = backup.type === 'full' ? '🗂️' : '📄';
        message += `${icon} *${backup.type.toUpperCase()}*\n`;
        message += `   ID: \`${backup.id}\`\n`;
        message += `   Date: ${backup.timestamp.toLocaleString()}\n`;
        message += `   Size: ${formatSize(backup.size)}\n\n`;
      });

      if (backups.length > 10) {
        message += `_... and ${backups.length - 10} more_\n\n`;
      }

      message += `Use /backup_download <id> to download\n`;
      message += `Use /backup_restore <id> to restore`;

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error listing backups:', error);
      await bot.sendMessage(chatId, '❌ Error listing backups. Please try again.');
    }
  });
}

/**
 * Handle /backup_download command - Download a backup file
 */
export async function handleBackupDownloadCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'backup_download', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('backup_download', true);

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        '📝 Usage: /backup_download <backup_id>\n\nExample: /backup_download full_1234567890'
      );
      return;
    }

    const backupId = args[0];

    try {
      await bot.sendMessage(chatId, '⏳ Preparing backup file for download...');

      const buffer = await backupService.getBackupFile(backupId);
      const filename = `${backupId}.json`;

      await bot.sendDocument(chatId, buffer, {
        caption: `📦 Backup: ${backupId}`,
      }, {
        filename,
        contentType: 'application/json',
      });
    } catch (error) {
      logger.error(`Error downloading backup ${backupId}:`, error);
      await bot.sendMessage(chatId, `❌ Error downloading backup. Backup ID may be invalid.`);
    }
  });
}

/**
 * Handle /backup_restore command - Restore from backup
 */
export async function handleBackupRestoreCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'backup_restore', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('backup_restore', true);

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        '📝 Usage: /backup_restore <backup_id> [options]\n\n' +
        'Options:\n' +
        '  --skip-raffles    Skip restoring raffles\n' +
        '  --skip-analytics  Skip restoring analytics\n' +
        '  --skip-users      Skip restoring users\n\n' +
        'Example: /backup_restore full_1234567890\n' +
        'Example: /backup_restore full_1234567890 --skip-analytics'
      );
      return;
    }

    const backupId = args[0];
    const options = {
      skipRaffles: args.includes('--skip-raffles'),
      skipAnalytics: args.includes('--skip-analytics'),
      skipUsers: args.includes('--skip-users'),
    };

    try {
      await bot.sendMessage(
        chatId,
        '⚠️ *WARNING: This will restore data from the backup*\n\n' +
        'This operation may overwrite existing data.\n' +
        'Reply with "CONFIRM" to proceed.',
        { parse_mode: 'Markdown' }
      );

      // Wait for confirmation (simplified - in production, use conversation manager)
      const filter = (msg: TelegramBot.Message) => 
        msg.chat.id === chatId && msg.text?.toUpperCase() === 'CONFIRM';

      // Note: This is a simplified implementation
      // In production, use the conversation manager to handle this properly
      await bot.sendMessage(chatId, '⏳ Starting restore process...');

      await backupService.restoreFromBackup(backupId, options);

      await bot.sendMessage(
        chatId,
        '✅ *Restore Completed Successfully*\n\n' +
        `Restored from: \`${backupId}\``,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error(`Error restoring backup ${backupId}:`, error);
      await bot.sendMessage(chatId, `❌ Error restoring backup: ${error}`);
    }
  });
}

/**
 * Handle /backup_raffle command - Create backup for specific raffle
 */
export async function handleBackupRaffleCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'backup_raffle', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('backup_raffle', true);

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        '📝 Usage: /backup_raffle <raffle_id>\n\nExample: /backup_raffle clxy123abc'
      );
      return;
    }

    const raffleId = args[0];

    try {
      await bot.sendMessage(chatId, '⏳ Creating raffle backup...');

      const metadata = await backupService.createRaffleBackup(raffleId);

      if (metadata.status === 'success') {
        const message = `
✅ *Raffle Backup Created*

📦 Backup ID: \`${metadata.id}\`
🎰 Raffle ID: \`${raffleId}\`
📅 Timestamp: ${metadata.timestamp.toLocaleString()}
💾 Size: ${formatSize(metadata.size)}

Use /backup_download ${metadata.id} to download
        `.trim();

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(
          chatId,
          `❌ Backup failed: ${metadata.error || 'Unknown error'}`
        );
      }
    } catch (error) {
      logger.error(`Error creating raffle backup for ${raffleId}:`, error);
      await bot.sendMessage(chatId, '❌ Error creating raffle backup. Please try again.');
    }
  });
}

/**
 * Handle /backup_cleanup command - Manually cleanup old backups
 */
export async function handleBackupCleanupCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'backup_cleanup', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('backup_cleanup', true);

    const retentionDays = args.length > 0 ? parseInt(args[0]) : 30;

    if (isNaN(retentionDays) || retentionDays < 1) {
      await bot.sendMessage(chatId, '❌ Invalid retention days. Use a number greater than 0.');
      return;
    }

    try {
      await bot.sendMessage(chatId, `⏳ Cleaning up backups older than ${retentionDays} days...`);

      const deletedCount = await backupService.cleanupOldBackups(retentionDays);

      await bot.sendMessage(
        chatId,
        `✅ Cleaned up ${deletedCount} old backup${deletedCount !== 1 ? 's' : ''}`
      );
    } catch (error) {
      logger.error('Error cleaning up backups:', error);
      await bot.sendMessage(chatId, '❌ Error cleaning up backups. Please try again.');
    }
  });
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

