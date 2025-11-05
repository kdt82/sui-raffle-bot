import { Queue, Worker } from 'bullmq';
import { getRedisClient } from '../utils/redis';
import { analyticsService } from '../services/analytics-service';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';

const analyticsQueue = new Queue('analytics', {
  connection: getRedisClient(),
});

// Worker to process analytics jobs
const analyticsWorker = new Worker(
  'analytics',
  async (job) => {
    logger.info(`Processing analytics job: ${job.name}`, { jobId: job.id });

    try {
      switch (job.name) {
        case 'aggregate_daily':
          await aggregateDaily();
          break;

        case 'aggregate_raffle':
          if (job.data.raffleId) {
            await analyticsService.aggregateRaffleAnalytics(job.data.raffleId);
          }
          break;

        case 'cleanup_old_activities':
          await cleanupOldActivities();
          break;

        default:
          logger.warn(`Unknown analytics job type: ${job.name}`);
      }
    } catch (error) {
      logger.error(`Error processing analytics job ${job.name}:`, error);
      throw error;
    }
  },
  {
    connection: getRedisClient(),
    concurrency: 2,
  }
);

/**
 * Aggregate daily analytics
 */
async function aggregateDaily(): Promise<void> {
  try {
    // Aggregate yesterday's data
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);

    await analyticsService.aggregateDailyAnalytics(yesterday);

    // Also update today's partial data
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await analyticsService.aggregateDailyAnalytics(today);

    logger.info('Daily analytics aggregation completed');
  } catch (error) {
    logger.error('Error in daily aggregation:', error);
  }
}

/**
 * Cleanup old user activities (keep last 90 days)
 */
async function cleanupOldActivities(): Promise<void> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const result = await prisma.userActivity.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    logger.info(`Cleaned up ${result.count} old user activities`);
  } catch (error) {
    logger.error('Error cleaning up old activities:', error);
  }
}

/**
 * Schedule analytics aggregation for a raffle
 */
export async function scheduleRaffleAnalytics(raffleId: string): Promise<void> {
  try {
    await analyticsQueue.add(
      'aggregate_raffle',
      { raffleId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    );

    logger.info(`Scheduled analytics aggregation for raffle ${raffleId}`);
  } catch (error) {
    logger.error(`Failed to schedule raffle analytics for ${raffleId}:`, error);
  }
}

/**
 * Setup recurring analytics jobs
 */
export async function setupAnalyticsJobs(): Promise<void> {
  try {
    // Aggregate daily analytics at 1 AM UTC every day
    await analyticsQueue.add(
      'aggregate_daily',
      {},
      {
        repeat: {
          pattern: '0 1 * * *', // 1 AM UTC daily
        },
        jobId: 'aggregate_daily',
      }
    );

    // Cleanup old activities weekly (Sunday at 2 AM)
    await analyticsQueue.add(
      'cleanup_old_activities',
      {},
      {
        repeat: {
          pattern: '0 2 * * 0', // 2 AM UTC on Sundays
        },
        jobId: 'cleanup_old_activities',
      }
    );

    logger.info('Analytics jobs scheduled successfully');
  } catch (error) {
    logger.error('Error setting up analytics jobs:', error);
  }
}

// Handle worker events
analyticsWorker.on('completed', (job) => {
  logger.debug(`Analytics job ${job.id} completed`);
});

analyticsWorker.on('failed', (job, err) => {
  logger.error(`Analytics job ${job?.id} failed:`, err);
});

export { analyticsQueue, analyticsWorker };

