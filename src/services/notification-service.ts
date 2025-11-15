import { prisma } from '../utils/database';
import { bot } from '../bot/index';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';

export interface NotificationOptions {
  userId?: bigint;
  includeMedia?: boolean;
  replyMarkup?: any;
}

export class NotificationService {
  /**
   * Send ticket allocation notification to a user
   */
  async notifyTicketAllocation(
    userId: bigint,
    walletAddress: string,
    ticketCount: number,
    tokenAmount: string,
    raffleId: string
  ): Promise<void> {
    try {
      // Check user preferences
      const prefs = await this.getUserPreferences(userId);
      if (!prefs.ticketAllocations) {
        logger.debug(`User ${userId} has disabled ticket allocation notifications`);
        return;
      }

      const raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
      });

      if (!raffle) return;

      const message = `
🎟️ *New Tickets Allocated!*

You've received *${ticketCount.toLocaleString()} tickets* for purchasing ${tokenAmount} tokens!

💼 Wallet: \`${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}\`
🏆 Prize: ${raffle.prizeAmount} ${raffle.prizeType}
⏰ Raffle ends: ${raffle.endTime.toLocaleString()}

Check your total tickets with /mytickets
Good luck! 🍀
      `.trim();

      await bot.sendMessage(Number(userId), message, { parse_mode: 'Markdown' });
      logger.info(`Sent ticket allocation notification to user ${userId}`);
    } catch (error) {
      logger.error(`Failed to send ticket allocation notification to user ${userId}:`, error);
    }
  }

  /**
   * Send daily ticket summary to a user
   */
  async sendDailySummary(userId: bigint): Promise<void> {
    try {
      const prefs = await this.getUserPreferences(userId);
      if (!prefs.dailySummary) {
        return;
      }

      // Get user's wallet
      const walletUser = await prisma.walletUser.findFirst({
        where: { telegramUserId: userId },
      });

      if (!walletUser) return;

      // Get active raffle
      const activeRaffle = await prisma.raffle.findFirst({
        where: {
          status: RAFFLE_STATUS.ACTIVE,
          endTime: { gt: new Date() },
        },
      });

      if (!activeRaffle) return;

      // Get user's tickets for active raffle
      const ticket = await prisma.ticket.findUnique({
        where: {
          raffleId_walletAddress: {
            raffleId: activeRaffle.id,
            walletAddress: walletUser.walletAddress,
          },
        },
      });

      if (!ticket || ticket.ticketCount === 0) return;

      // Get yesterday's buy events
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterdayBuys = await prisma.buyEvent.findMany({
        where: {
          raffleId: activeRaffle.id,
          walletAddress: walletUser.walletAddress,
          timestamp: {
            gte: yesterday,
            lt: today,
          },
        },
      });

      const yesterdayTickets = yesterdayBuys.reduce((sum, buy) => sum + buy.ticketCount, 0);

      // Get leaderboard position
      const allTickets = await prisma.ticket.findMany({
        where: { raffleId: activeRaffle.id },
        orderBy: { ticketCount: 'desc' },
      });

      const position = allTickets.findIndex(t => t.walletAddress === walletUser.walletAddress) + 1;

      const timeRemaining = this.formatTimeRemaining(activeRaffle.endTime);

      const message = `
📊 *Your Daily Raffle Summary*

🎫 Total Tickets: *${ticket.ticketCount.toLocaleString()}*
${yesterdayTickets > 0 ? `📈 Yesterday: +${yesterdayTickets.toLocaleString()} tickets` : ''}
🏅 Leaderboard Position: *#${position}*

🏆 Prize: ${activeRaffle.prizeAmount} ${activeRaffle.prizeType}
⏰ Time Remaining: ${timeRemaining}

Keep buying to increase your chances! 🚀
      `.trim();

      await bot.sendMessage(Number(userId), message, { parse_mode: 'Markdown' });
      logger.info(`Sent daily summary to user ${userId}`);
    } catch (error) {
      logger.error(`Failed to send daily summary to user ${userId}:`, error);
    }
  }

  /**
   * Send raffle reminder notification
   */
  async sendRaffleReminder(raffleId: string, hoursRemaining: number): Promise<void> {
    try {
      const raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
        include: {
          tickets: {
            where: { ticketCount: { gt: 0 } },
          },
        },
      });

      if (!raffle) return;

      // Get all users with tickets
      const walletAddresses = raffle.tickets.map(t => t.walletAddress);
      const walletUsers = await prisma.walletUser.findMany({
        where: { walletAddress: { in: walletAddresses } },
      });

      const message = `
⏰ *Raffle Reminder*

The raffle ends in *${hoursRemaining} ${hoursRemaining === 1 ? 'hour' : 'hours'}*!

🏆 Prize: ${raffle.prizeAmount} ${raffle.prizeType}
⏱️ Ends: ${raffle.endTime.toLocaleString()}

This is your last chance to buy more tokens and increase your tickets!

Check your position: /leaderboard
Check your tickets: /mytickets
      `.trim();

      // Send to all participating users
      for (const walletUser of walletUsers) {
        const prefs = await this.getUserPreferences(walletUser.telegramUserId);
        if (prefs.raffleReminders) {
          try {
            await bot.sendMessage(Number(walletUser.telegramUserId), message, {
              parse_mode: 'Markdown',
            });
          } catch (error) {
            logger.error(`Failed to send reminder to user ${walletUser.telegramUserId}:`, error);
          }
        }
      }

      logger.info(`Sent ${hoursRemaining}h raffle reminder for raffle ${raffleId}`);
    } catch (error) {
      logger.error(`Failed to send raffle reminder for raffle ${raffleId}:`, error);
    }
  }

  /**
   * Broadcast winner announcement
   */
  async broadcastWinnerAnnouncement(raffleId: string): Promise<void> {
    try {
      const raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
        include: {
          winners: true,
          tickets: true,
        },
      });

      if (!raffle || raffle.winners.length === 0) return;

      const winner = raffle.winners[0];
      const totalParticipants = raffle.tickets.filter(t => t.ticketCount > 0).length;
      const totalTickets = raffle.tickets.reduce((sum, t) => sum + t.ticketCount, 0);

      // Calculate winner's win percentage
      const winPercentage = ((winner.ticketCount / totalTickets) * 100).toFixed(2);

      // Build randomness proof section
      let randomnessSection = '';
      if (winner.selectionMethod === 'on-chain' && winner.randomnessEpoch) {
        randomnessSection = `\n🔐 *Selection Method:* SUI On-Chain Randomness\n📍 Blockchain Epoch: ${winner.randomnessEpoch}\n`;
      } else if (winner.selectionMethod === 'client-side') {
        randomnessSection = `\n🔐 *Selection Method:* Weighted Random\n`;
      }

      const message = `
🎉 *RAFFLE WINNER ANNOUNCED!*

🏆 Prize: ${raffle.prizeAmount} ${raffle.prizeType}

👤 Winner: \`${winner.walletAddress.slice(0, 8)}...${winner.walletAddress.slice(-6)}\`
🎫 Winning Tickets: ${winner.ticketCount.toLocaleString()} (${winPercentage}% chance)
📊 Total Participants: ${totalParticipants.toLocaleString()}
🎟️ Total Tickets: ${totalTickets.toLocaleString()}${randomnessSection}
Congratulations to the winner! 🎊
      `.trim();

      // Broadcast to all participants
      const walletAddresses = raffle.tickets.map(t => t.walletAddress);
      const walletUsers = await prisma.walletUser.findMany({
        where: { walletAddress: { in: walletAddresses } },
      });

      for (const walletUser of walletUsers) {
        const prefs = await this.getUserPreferences(walletUser.telegramUserId);
        if (prefs.winnerAnnouncements) {
          try {
            const isWinner = walletUser.walletAddress === winner.walletAddress;
            const userMessage = isWinner
              ? `🎉🎉🎉 *YOU WON!* 🎉🎉🎉\n\n${message}\n\nThe prize will be sent to your wallet shortly!`
              : message;

            await bot.sendMessage(Number(walletUser.telegramUserId), userMessage, {
              parse_mode: 'Markdown',
            });
          } catch (error) {
            logger.error(`Failed to send winner announcement to user ${walletUser.telegramUserId}:`, error);
          }
        }
      }

      logger.info(`Broadcasted winner announcement for raffle ${raffleId}`);
    } catch (error) {
      logger.error(`Failed to broadcast winner announcement for raffle ${raffleId}:`, error);
    }
  }

  /**
   * Send admin alert
   */
  async sendAdminAlert(message: string): Promise<void> {
    try {
      const admins = await prisma.admin.findMany();

      for (const admin of admins) {
        try {
          await bot.sendMessage(Number(admin.telegramUserId), `🔔 *Admin Alert*\n\n${message}`, {
            parse_mode: 'Markdown',
          });
        } catch (error) {
          logger.error(`Failed to send admin alert to admin ${admin.telegramUserId}:`, error);
        }
      }

      logger.info('Sent admin alerts');
    } catch (error) {
      logger.error('Failed to send admin alerts:', error);
    }
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: bigint): Promise<{
    dailySummary: boolean;
    raffleReminders: boolean;
    ticketAllocations: boolean;
    winnerAnnouncements: boolean;
    timezone: string;
    preferredTime: string;
  }> {
    try {
      let prefs = await prisma.notificationPreference.findUnique({
        where: { telegramUserId: userId },
      });

      if (!prefs) {
        // Create default preferences
        prefs = await prisma.notificationPreference.create({
          data: { telegramUserId: userId },
        });
      }

      return prefs;
    } catch (error) {
      logger.error(`Failed to get preferences for user ${userId}:`, error);
      // Return defaults on error
      return {
        dailySummary: true,
        raffleReminders: true,
        ticketAllocations: true,
        winnerAnnouncements: true,
        timezone: 'UTC',
        preferredTime: '09:00',
      };
    }
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    userId: bigint,
    preferences: Partial<{
      dailySummary: boolean;
      raffleReminders: boolean;
      ticketAllocations: boolean;
      winnerAnnouncements: boolean;
      timezone: string;
      preferredTime: string;
    }>
  ): Promise<void> {
    try {
      await prisma.notificationPreference.upsert({
        where: { telegramUserId: userId },
        create: {
          telegramUserId: userId,
          ...preferences,
        },
        update: preferences,
      });

      logger.info(`Updated notification preferences for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to update preferences for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule a notification
   */
  async scheduleNotification(
    type: string,
    scheduledFor: Date,
    metadata?: any,
    raffleId?: string,
    targetUserIds?: string[]
  ): Promise<void> {
    try {
      await prisma.scheduledNotification.create({
        data: {
          type,
          scheduledFor,
          raffleId,
          targetUserIds: targetUserIds || [],
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      logger.info(`Scheduled ${type} notification for ${scheduledFor.toISOString()}`);
    } catch (error) {
      logger.error(`Failed to schedule notification:`, error);
    }
  }

  /**
   * Process due notifications
   */
  async processDueNotifications(): Promise<void> {
    try {
      const dueNotifications = await prisma.scheduledNotification.findMany({
        where: {
          sent: false,
          scheduledFor: { lte: new Date() },
        },
        take: 100, // Process in batches
      });

      for (const notification of dueNotifications) {
        try {
          await this.processNotification(notification);
          
          await prisma.scheduledNotification.update({
            where: { id: notification.id },
            data: {
              sent: true,
              sentAt: new Date(),
            },
          });
        } catch (error) {
          logger.error(`Failed to process notification ${notification.id}:`, error);
        }
      }

      if (dueNotifications.length > 0) {
        logger.info(`Processed ${dueNotifications.length} due notifications`);
      }
    } catch (error) {
      logger.error('Failed to process due notifications:', error);
    }
  }

  /**
   * Process a single notification
   */
  private async processNotification(notification: any): Promise<void> {
    switch (notification.type) {
      case 'daily_summary':
        if (notification.targetUserIds.length > 0) {
          for (const userIdStr of notification.targetUserIds) {
            await this.sendDailySummary(BigInt(userIdStr));
          }
        }
        break;

      case 'raffle_reminder':
        if (notification.raffleId) {
          const metadata = notification.metadata ? JSON.parse(notification.metadata) : {};
          await this.sendRaffleReminder(notification.raffleId, metadata.hoursRemaining || 24);
        }
        break;

      case 'winner_announcement':
        if (notification.raffleId) {
          await this.broadcastWinnerAnnouncement(notification.raffleId);
        }
        break;

      case 'admin_alert':
        const metadata = notification.metadata ? JSON.parse(notification.metadata) : {};
        await this.sendAdminAlert(metadata.message || 'Alert');
        break;
    }
  }

  /**
   * Format time remaining
   */
  private formatTimeRemaining(endTime: Date): string {
    const now = new Date();
    const diff = endTime.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();

