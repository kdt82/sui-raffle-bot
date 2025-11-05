import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';

export class AnalyticsService {
  /**
   * Track user activity
   */
  async trackActivity(
    telegramUserId: bigint,
    activityType: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await prisma.userActivity.create({
        data: {
          telegramUserId,
          activityType,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });
    } catch (error) {
      logger.error('Failed to track user activity:', error);
    }
  }

  /**
   * Aggregate daily analytics
   */
  async aggregateDailyAnalytics(date: Date): Promise<void> {
    try {
      // Set to midnight UTC
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(startOfDay);
      endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

      logger.info(`Aggregating analytics for ${startOfDay.toISOString()}`);

      // Get active users (unique users who ran commands or had buy events)
      const activities = await prisma.userActivity.findMany({
        where: {
          timestamp: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
        distinct: ['telegramUserId'],
      });
      const activeUsers = activities.length;

      // Get new users (new wallet links)
      const newUsers = await prisma.walletUser.count({
        where: {
          linkedAt: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
      });

      // Get buy events
      const buyEvents = await prisma.buyEvent.findMany({
        where: {
          timestamp: {
            gte: startOfDay,
            lt: endOfDay,
          },
        },
      });

      const totalBuyEvents = buyEvents.length;
      const totalTicketsAllocated = buyEvents.reduce((sum, event) => sum + event.ticketCount, 0);
      const totalTokenVolume = buyEvents.reduce((sum, event) => {
        return sum + parseFloat(event.tokenAmount);
      }, 0).toString();
      const uniqueWallets = new Set(buyEvents.map(e => e.walletAddress)).size;

      // Get commands executed
      const commandsExecuted = await prisma.userActivity.count({
        where: {
          timestamp: {
            gte: startOfDay,
            lt: endOfDay,
          },
          activityType: 'command',
        },
      });

      // Create or update daily analytics
      const analytics = await prisma.dailyAnalytics.upsert({
        where: { date: startOfDay },
        create: {
          date: startOfDay,
          activeUsers,
          newUsers,
          totalTicketsAllocated,
          totalBuyEvents,
          totalTokenVolume,
          commandsExecuted,
          uniqueWallets,
        },
        update: {
          activeUsers,
          newUsers,
          totalTicketsAllocated,
          totalBuyEvents,
          totalTokenVolume,
          commandsExecuted,
          uniqueWallets,
        },
      });

      // Aggregate by DEX
      await this.aggregateDexStats(analytics.id, buyEvents);

      logger.info(`Daily analytics aggregated for ${startOfDay.toISOString()}`);
    } catch (error) {
      logger.error('Failed to aggregate daily analytics:', error);
    }
  }

  /**
   * Aggregate DEX statistics
   */
  private async aggregateDexStats(analyticsId: string, buyEvents: any[]): Promise<void> {
    try {
      // Group by DEX
      const dexGroups = new Map<string, any[]>();
      
      for (const event of buyEvents) {
        const raffle = await prisma.raffle.findUnique({
          where: { id: event.raffleId },
          select: { dex: true },
        });

        if (!raffle) continue;

        if (!dexGroups.has(raffle.dex)) {
          dexGroups.set(raffle.dex, []);
        }
        dexGroups.get(raffle.dex)!.push(event);
      }

      // Create stats for each DEX
      for (const [dex, events] of dexGroups.entries()) {
        const buyEventsCount = events.length;
        const tokenVolume = events.reduce((sum, e) => sum + parseFloat(e.tokenAmount), 0).toString();
        const uniqueWalletsCount = new Set(events.map(e => e.walletAddress)).size;
        const ticketsAllocated = events.reduce((sum, e) => sum + e.ticketCount, 0);

        await prisma.dexDailyStats.upsert({
          where: {
            analyticsId_dex: {
              analyticsId,
              dex,
            },
          },
          create: {
            analyticsId,
            dex,
            buyEvents: buyEventsCount,
            tokenVolume,
            uniqueWallets: uniqueWalletsCount,
            ticketsAllocated,
          },
          update: {
            buyEvents: buyEventsCount,
            tokenVolume,
            uniqueWallets: uniqueWalletsCount,
            ticketsAllocated,
          },
        });
      }
    } catch (error) {
      logger.error('Failed to aggregate DEX stats:', error);
    }
  }

  /**
   * Aggregate raffle analytics
   */
  async aggregateRaffleAnalytics(raffleId: string): Promise<void> {
    try {
      const raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
        include: {
          tickets: true,
          buyEvents: true,
        },
      });

      if (!raffle) return;

      const participants = raffle.tickets.filter(t => t.ticketCount > 0);
      const totalParticipants = participants.length;
      const totalTickets = participants.reduce((sum, t) => sum + t.ticketCount, 0);
      const totalBuyEvents = raffle.buyEvents.length;
      const totalTokenVolume = raffle.buyEvents.reduce((sum, e) => {
        return sum + parseFloat(e.tokenAmount);
      }, 0).toString();
      const uniqueWallets = new Set(raffle.buyEvents.map(e => e.walletAddress)).size;

      // Calculate average and median
      const ticketCounts = participants.map(t => t.ticketCount).sort((a, b) => a - b);
      const averageTicketsPerUser = totalParticipants > 0 ? totalTickets / totalParticipants : 0;
      const medianTicketsPerUser = totalParticipants > 0
        ? ticketCounts[Math.floor(ticketCounts.length / 2)]
        : 0;
      const topWalletTickets = ticketCounts.length > 0 ? ticketCounts[ticketCounts.length - 1] : 0;

      // Calculate duration
      const durationMs = raffle.endTime.getTime() - raffle.startTime.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      // Calculate participation rate (participants / total users with wallets)
      const totalUsers = await prisma.walletUser.count();
      const participationRate = totalUsers > 0 ? (totalParticipants / totalUsers) * 100 : 0;

      // Create or update raffle analytics
      await prisma.raffleAnalytics.upsert({
        where: { raffleId },
        create: {
          raffleId,
          totalParticipants,
          totalTickets,
          totalBuyEvents,
          totalTokenVolume,
          uniqueWallets,
          averageTicketsPerUser,
          medianTicketsPerUser,
          topWalletTickets,
          participationRate,
          durationHours,
        },
        update: {
          totalParticipants,
          totalTickets,
          totalBuyEvents,
          totalTokenVolume,
          uniqueWallets,
          averageTicketsPerUser,
          medianTicketsPerUser,
          topWalletTickets,
          participationRate,
          durationHours,
        },
      });

      logger.info(`Raffle analytics aggregated for raffle ${raffleId}`);
    } catch (error) {
      logger.error(`Failed to aggregate raffle analytics for ${raffleId}:`, error);
    }
  }

  /**
   * Get analytics summary for a date range
   */
  async getAnalyticsSummary(startDate: Date, endDate: Date): Promise<any> {
    try {
      const analytics = await prisma.dailyAnalytics.findMany({
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
        include: {
          dexStats: true,
        },
        orderBy: {
          date: 'asc',
        },
      });

      const totalActiveUsers = analytics.reduce((sum, a) => sum + a.activeUsers, 0);
      const totalNewUsers = analytics.reduce((sum, a) => sum + a.newUsers, 0);
      const totalTickets = analytics.reduce((sum, a) => sum + a.totalTicketsAllocated, 0);
      const totalBuyEvents = analytics.reduce((sum, a) => sum + a.totalBuyEvents, 0);
      const totalTokenVolume = analytics.reduce((sum, a) => {
        return sum + parseFloat(a.totalTokenVolume);
      }, 0);

      // Aggregate DEX stats
      const dexTotals = new Map<string, any>();
      for (const day of analytics) {
        for (const dexStat of day.dexStats) {
          if (!dexTotals.has(dexStat.dex)) {
            dexTotals.set(dexStat.dex, {
              dex: dexStat.dex,
              buyEvents: 0,
              tokenVolume: 0,
              uniqueWallets: new Set(),
              ticketsAllocated: 0,
            });
          }
          const total = dexTotals.get(dexStat.dex)!;
          total.buyEvents += dexStat.buyEvents;
          total.tokenVolume += parseFloat(dexStat.tokenVolume);
          total.ticketsAllocated += dexStat.ticketsAllocated;
        }
      }

      const dexSummary = Array.from(dexTotals.values()).map(d => ({
        dex: d.dex,
        buyEvents: d.buyEvents,
        tokenVolume: d.tokenVolume.toString(),
        ticketsAllocated: d.ticketsAllocated,
      }));

      return {
        period: {
          start: startDate,
          end: endDate,
          days: analytics.length,
        },
        totals: {
          activeUsers: totalActiveUsers,
          newUsers: totalNewUsers,
          ticketsAllocated: totalTickets,
          buyEvents: totalBuyEvents,
          tokenVolume: totalTokenVolume.toString(),
        },
        averages: {
          activeUsersPerDay: analytics.length > 0 ? totalActiveUsers / analytics.length : 0,
          newUsersPerDay: analytics.length > 0 ? totalNewUsers / analytics.length : 0,
          ticketsPerDay: analytics.length > 0 ? totalTickets / analytics.length : 0,
          buyEventsPerDay: analytics.length > 0 ? totalBuyEvents / analytics.length : 0,
        },
        dexBreakdown: dexSummary,
        dailyData: analytics.map(a => ({
          date: a.date,
          activeUsers: a.activeUsers,
          newUsers: a.newUsers,
          ticketsAllocated: a.totalTicketsAllocated,
          buyEvents: a.totalBuyEvents,
          tokenVolume: a.totalTokenVolume,
        })),
      };
    } catch (error) {
      logger.error('Failed to get analytics summary:', error);
      throw error;
    }
  }

  /**
   * Get raffle performance comparison
   */
  async getRaffleComparison(): Promise<any> {
    try {
      const raffleAnalytics = await prisma.raffleAnalytics.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
      });

      return raffleAnalytics.map(ra => ({
        raffleId: ra.raffleId,
        participants: ra.totalParticipants,
        tickets: ra.totalTickets,
        buyEvents: ra.totalBuyEvents,
        tokenVolume: ra.totalTokenVolume,
        participationRate: ra.participationRate,
        averageTickets: ra.averageTicketsPerUser,
        medianTickets: ra.medianTicketsPerUser,
        durationHours: ra.durationHours,
      }));
    } catch (error) {
      logger.error('Failed to get raffle comparison:', error);
      throw error;
    }
  }

  /**
   * Export analytics to CSV format
   */
  async exportToCsv(startDate: Date, endDate: Date): Promise<string> {
    try {
      const summary = await this.getAnalyticsSummary(startDate, endDate);
      
      let csv = 'Date,Active Users,New Users,Tickets Allocated,Buy Events,Token Volume\n';
      
      for (const day of summary.dailyData) {
        csv += `${day.date.toISOString().split('T')[0]},${day.activeUsers},${day.newUsers},${day.ticketsAllocated},${day.buyEvents},${day.tokenVolume}\n`;
      }

      return csv;
    } catch (error) {
      logger.error('Failed to export analytics to CSV:', error);
      throw error;
    }
  }
}

// Singleton instance
export const analyticsService = new AnalyticsService();

