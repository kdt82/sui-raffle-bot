import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { requireAdmin } from '../middleware';
import { analyticsService } from '../../services/analytics-service';
import { logger } from '../../utils/logger';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';

/**
 * Handle /analytics command - Show analytics summary
 */
export async function handleAnalyticsCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'analytics', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('analytics', true);

    try {
      // Default to last 7 days
      let days = 7;
      if (args.length > 0) {
        days = parseInt(args[0]);
        if (isNaN(days) || days < 1 || days > 365) {
          await bot.sendMessage(chatId, '❌ Invalid number of days. Use 1-365.');
          return;
        }
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const summary = await analyticsService.getAnalyticsSummary(startDate, endDate);

      const message = `
📊 *Analytics Summary (Last ${days} Days)*

*Totals:*
👥 Active Users: ${summary.totals.activeUsers.toLocaleString()}
🆕 New Users: ${summary.totals.newUsers.toLocaleString()}
🎫 Tickets Allocated: ${summary.totals.ticketsAllocated.toLocaleString()}
💰 Buy Events: ${summary.totals.buyEvents.toLocaleString()}
📈 Token Volume: ${parseFloat(summary.totals.tokenVolume).toFixed(2)}

*Daily Averages:*
👥 Active Users: ${summary.averages.activeUsersPerDay.toFixed(1)}
🆕 New Users: ${summary.averages.newUsersPerDay.toFixed(1)}
🎫 Tickets: ${summary.averages.ticketsPerDay.toFixed(0)}
💰 Buy Events: ${summary.averages.buyEventsPerDay.toFixed(1)}

*DEX Breakdown:*
${summary.dexBreakdown.map((d: any) => 
  `${d.dex}: ${d.buyEvents} buys, ${parseFloat(d.tokenVolume).toFixed(2)} tokens`
).join('\n') || 'No data'}

Use /analytics_export to download CSV data
Use /analytics_raffles to compare raffle performance
      `.trim();

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching analytics:', error);
      await bot.sendMessage(chatId, '❌ Error fetching analytics. Please try again.');
    }
  });
}

/**
 * Handle /analytics_raffles command - Show raffle comparison
 */
export async function handleAnalyticsRafflesCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'analytics_raffles', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    incrementCommand('analytics_raffles', true);

    try {
      const raffles = await analyticsService.getRaffleComparison();

      if (raffles.length === 0) {
        await bot.sendMessage(chatId, '📊 No raffle analytics available yet.');
        return;
      }

      let message = '📊 *Raffle Performance Comparison*\n\n';

      raffles.forEach((raffle: any, index: number) => {
        message += `*Raffle ${index + 1}* (ID: \`${raffle.raffleId.slice(0, 8)}...\`)\n`;
        message += `👥 Participants: ${raffle.participants}\n`;
        message += `🎫 Total Tickets: ${raffle.tickets.toLocaleString()}\n`;
        message += `💰 Buy Events: ${raffle.buyEvents}\n`;
        message += `📊 Avg Tickets/User: ${raffle.averageTickets.toFixed(1)}\n`;
        message += `📈 Participation Rate: ${raffle.participationRate.toFixed(1)}%\n`;
        message += `⏱️ Duration: ${raffle.durationHours.toFixed(1)}h\n\n`;
      });

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching raffle analytics:', error);
      await bot.sendMessage(chatId, '❌ Error fetching raffle analytics. Please try again.');
    }
  });
}

/**
 * Handle /analytics_export command - Export analytics to CSV
 */
export async function handleAnalyticsExportCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'analytics_export', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    const args = msg.text?.split(' ').slice(1) || [];
    incrementCommand('analytics_export', true);

    try {
      // Default to last 30 days
      let days = 30;
      if (args.length > 0) {
        days = parseInt(args[0]);
        if (isNaN(days) || days < 1 || days > 365) {
          await bot.sendMessage(chatId, '❌ Invalid number of days. Use 1-365.');
          return;
        }
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      await bot.sendMessage(chatId, '⏳ Generating CSV export...');

      const csv = await analyticsService.exportToCsv(startDate, endDate);
      
      // Send as document
      const buffer = Buffer.from(csv, 'utf-8');
      const filename = `analytics_${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}.csv`;

      await bot.sendDocument(chatId, buffer, {
        caption: `📊 Analytics export for last ${days} days`,
      }, {
        filename,
        contentType: 'text/csv',
      });
    } catch (error) {
      logger.error('Error exporting analytics:', error);
      await bot.sendMessage(chatId, '❌ Error exporting analytics. Please try again.');
    }
  });
}

/**
 * Handle /analytics_live command - Show real-time stats
 */
export async function handleAnalyticsLiveCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'analytics_live', RATE_LIMITS.ADMIN_COMMAND, async () => {
    const chatId = msg.chat.id;
    incrementCommand('analytics_live', true);

    try {
      const { prisma } = await import('../../utils/database');

      // Today's stats (since midnight)
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const [
        totalUsers,
        totalWallets,
        activeRaffles,
        todayBuyEvents,
        todayTickets,
        todayNewUsers,
      ] = await Promise.all([
        prisma.admin.count(),
        prisma.walletUser.count(),
        prisma.raffle.count({
          where: { status: 'active' },
        }),
        prisma.buyEvent.count({
          where: {
            timestamp: { gte: today },
          },
        }),
        prisma.buyEvent.aggregate({
          where: {
            timestamp: { gte: today },
          },
          _sum: {
            ticketCount: true,
          },
        }),
        prisma.walletUser.count({
          where: {
            linkedAt: { gte: today },
          },
        }),
      ]);

      const message = `
📊 *Live Statistics*

*Current Status:*
👥 Total Registered Wallets: ${totalWallets.toLocaleString()}
🎰 Active Raffles: ${activeRaffles}
👨‍💼 Admins: ${totalUsers}

*Today (UTC):*
💰 Buy Events: ${todayBuyEvents.toLocaleString()}
🎫 Tickets Allocated: ${(todayTickets._sum.ticketCount || 0).toLocaleString()}
🆕 New Users: ${todayNewUsers.toLocaleString()}

Use /analytics for historical data
Use /analytics_raffles for raffle comparison
      `.trim();

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Error fetching live analytics:', error);
      await bot.sendMessage(chatId, '❌ Error fetching live statistics. Please try again.');
    }
  });
}

