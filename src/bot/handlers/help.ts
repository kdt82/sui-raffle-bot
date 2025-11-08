import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { logger } from '../../utils/logger';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';
import { prisma } from '../../utils/database';
import { formatDateShort } from '../../utils/constants';

/**
 * Admin command reference - Lists all available commands with usage
 */
export async function handleAdminHelpCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'admin_help', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    incrementCommand('adminhelp', true);

    const helpMessage = `
📚 *Admin Command Reference*

*RAFFLE MANAGEMENT*
/create\\_raffle - Interactive raffle creation wizard
  • 11-step process with media uploads
  • Set prize, dates, ticket ratios, minimum purchase

/cancel\\_raffle <raffleId> - Cancel active raffle
  • Example: /cancel\\_raffle cm2abc123

/award\\_prize <raffleId> - Mark prize as awarded
  • Example: /award\\_prize cm2abc123

*TICKET MANAGEMENT*
/add\\_tickets <raffleId> <wallet> <amount>
  • Manually add tickets to a wallet
  • Example: /add\\_tickets cm2abc123 0x123... 1000

/remove\\_tickets <wallet> <amount>
  • Remove tickets from a wallet (uses active raffle)
  • Example: /remove\\_tickets 0x123... 500

/reset\\_tickets <raffleId>
  • Reset all tickets for a raffle to zero
  • ⚠️ Use with caution!

*ANALYTICS & REPORTING*
/analytics - View overall system analytics
/analytics\\_raffles - Analytics for all raffles
/analytics\\_live - Real-time stats for active raffle
/analytics\\_export - Export analytics as JSON

*AUDIT LOGS*
/auditlogs - View last 20 audit entries
/auditlogs\\_raffle <raffleId> - Logs for specific raffle
/auditfailures - Failed actions in last 24h

*WALLETS & USERS*
/walletlist - List all linked wallets (NEW!)
  • Shows wallet addresses and linked Telegram users
  • Useful for manual crediting

*BACKUP & RECOVERY*
/backup - Create system backup
/backup\\_list - List available backups
/backup\\_download <filename> - Download backup file
/backup\\_restore <filename> - Restore from backup
/backup\\_raffle <raffleId> - Backup specific raffle
/backup\\_cleanup - Remove old backups

*NOTIFICATIONS*
/notifications - View notification preferences
/notifications\\_toggle <type> - Toggle notification type
/notifications\\_time <HH:MM> - Set daily summary time

*SYSTEM*
/config - View current configuration
/chatinfo - Get chat ID information

*USER COMMANDS* (for reference)
/start - Welcome message
/leaderboard - Current raffle standings
/mytickets - User's ticket count
/linkwallet <address> - Link wallet
/walletstatus - View linked wallet
/unlinkwallet - Remove wallet link

💡 Tip: All admin commands require admin privileges
📝 Commands can be used in private chat or admin group
    `.trim();

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

/**
 * List all linked wallets and users - Useful for manual crediting
 */
export async function handleWalletListCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'wallet_list', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    incrementCommand('walletlist', true);

    try {
      // Get all linked wallets
      const walletUsers = await prisma.walletUser.findMany({
        orderBy: { linkedAt: 'desc' },
      });

      if (walletUsers.length === 0) {
        await bot.sendMessage(chatId, '📝 No wallets linked yet.');
        return;
      }

      // Build detailed message
      let message = `📋 Linked Wallets Summary\n`;
      message += `Total: ${walletUsers.length}\n\n`;

      // Send in chunks to avoid message length limits
      const chunkSize = 20;
      for (let i = 0; i < walletUsers.length; i += chunkSize) {
        const chunk = walletUsers.slice(i, i + chunkSize);
        let chunkMessage = i === 0 ? message : '';

        if (i > 0) {
          chunkMessage += `\nPage ${Math.floor(i / chunkSize) + 1}\n\n`;
        }

        for (const wu of chunk) {
          const num = i + chunk.indexOf(wu) + 1;
          const shortWallet = `${wu.walletAddress.slice(0, 8)}...${wu.walletAddress.slice(-6)}`;
          const username = wu.telegramUsername ? `@${wu.telegramUsername}` : `ID: ${wu.telegramUserId}`;
          const linkedDate = formatDateShort(wu.linkedAt);

          chunkMessage += `${num}. ${username}\n`;
          chunkMessage += `   Wallet: ${wu.walletAddress}\n`;
          chunkMessage += `   Short: ${shortWallet}\n`;
          chunkMessage += `   Linked: ${linkedDate} UTC\n`;
          chunkMessage += `   Verified: ${wu.verified ? '✅' : '❌'}\n\n`;
        }

        await bot.sendMessage(chatId, chunkMessage);

        // Small delay between chunks to avoid rate limits
        if (i + chunkSize < walletUsers.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Send summary with CSV option
      const summaryMessage =
        `\n📊 Summary Statistics\n` +
        `Total Wallets: ${walletUsers.length}\n` +
        `Verified: ${walletUsers.filter(w => w.verified).length}\n` +
        `Unverified: ${walletUsers.filter(w => !w.verified).length}\n\n` +
        `💡 Tip: Use this list for manual crediting or verification`;

      await bot.sendMessage(chatId, summaryMessage);

      // Optionally create a CSV export for easy import
      const csv = generateWalletCSV(walletUsers);
      const csvBuffer = Buffer.from(csv, 'utf-8');

      await bot.sendDocument(
        chatId,
        csvBuffer,
        {},
        {
          filename: `wallet-list-${new Date().toISOString().split('T')[0]}.csv`,
          contentType: 'text/csv',
        }
      );

    } catch (error) {
      logger.error('Error fetching wallet list:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await bot.sendMessage(
        chatId, 
        `❌ Error fetching wallet list: ${errorMessage}\n\nPlease check the logs and try again.`
      );
    }
  });
}

/**
 * Generate CSV export of wallet list
 */
function generateWalletCSV(walletUsers: any[]): string {
  let csv = 'Wallet Address,Telegram User ID,Telegram Username,Linked Date,Verified\n';

  for (const wu of walletUsers) {
    const username = wu.telegramUsername || '';
    const linkedDate = wu.linkedAt.toISOString();
    const verified = wu.verified ? 'Yes' : 'No';

    csv += `${wu.walletAddress},${wu.telegramUserId},${username},${linkedDate},${verified}\n`;
  }

  return csv;
}
