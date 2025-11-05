import { Queue, Worker } from 'bullmq';
import { getRedisClient } from '../utils/redis';
import { notificationService } from '../services/notification-service';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';

const notificationQueue = new Queue('notifications', {
  connection: getRedisClient(),
});

// Worker to process notifications
const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    logger.info(`Processing notification job: ${job.name}`, { jobId: job.id });

    try {
      switch (job.name) {
        case 'process_due_notifications':
          await notificationService.processDueNotifications();
          break;

        case 'schedule_raffle_reminders':
          await scheduleRaffleReminders();
          break;

        case 'send_daily_summaries':
          await sendDailySummaries();
          break;

        case 'check_raffle_end':
          await checkRaffleEnd();
          break;

        default:
          logger.warn(`Unknown notification job type: ${job.name}`);
      }
    } catch (error) {
      logger.error(`Error processing notification job ${job.name}:`, error);
      throw error;
    }
  },
  {
    connection: getRedisClient(),
    concurrency: 5,
  }
);

/**
 * Schedule raffle reminder notifications
 */
async function scheduleRaffleReminders(): Promise<void> {
  try {
    const activeRaffles = await prisma.raffle.findMany({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
    });

    for (const raffle of activeRaffles) {
      const now = new Date();
      const endTime = new Date(raffle.endTime);
      const timeUntilEnd = endTime.getTime() - now.getTime();
      const hoursUntilEnd = timeUntilEnd / (1000 * 60 * 60);

      // Schedule 24h reminder
      if (hoursUntilEnd <= 24 && hoursUntilEnd > 23) {
        const reminderTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
        
        // Check if already scheduled
        const existing = await prisma.scheduledNotification.findFirst({
          where: {
            raffleId: raffle.id,
            type: 'raffle_reminder',
            metadata: { contains: '"hoursRemaining":24' },
          },
        });

        if (!existing) {
          await notificationService.scheduleNotification(
            'raffle_reminder',
            reminderTime,
            { hoursRemaining: 24 },
            raffle.id
          );
          logger.info(`Scheduled 24h reminder for raffle ${raffle.id}`);
        }
      }

      // Schedule 1h reminder
      if (hoursUntilEnd <= 1 && hoursUntilEnd > 0.9) {
        const reminderTime = new Date(endTime.getTime() - 60 * 60 * 1000);
        
        // Check if already scheduled
        const existing = await prisma.scheduledNotification.findFirst({
          where: {
            raffleId: raffle.id,
            type: 'raffle_reminder',
            metadata: { contains: '"hoursRemaining":1' },
          },
        });

        if (!existing) {
          await notificationService.scheduleNotification(
            'raffle_reminder',
            reminderTime,
            { hoursRemaining: 1 },
            raffle.id
          );
          logger.info(`Scheduled 1h reminder for raffle ${raffle.id}`);
        }
      }
    }
  } catch (error) {
    logger.error('Error scheduling raffle reminders:', error);
  }
}

/**
 * Send daily summaries to users
 */
async function sendDailySummaries(): Promise<void> {
  try {
    // Get all users with daily summary enabled
    const preferences = await prisma.notificationPreference.findMany({
      where: { dailySummary: true },
    });

    const currentHour = new Date().getUTCHours();
    const currentMinute = new Date().getUTCMinutes();

    for (const pref of preferences) {
      // Parse preferred time
      const [prefHour, prefMinute] = pref.preferredTime.split(':').map(Number);

      // Check if it's time to send (within 15 minute window)
      if (
        Math.abs(currentHour - prefHour) === 0 &&
        Math.abs(currentMinute - prefMinute) <= 15
      ) {
        try {
          await notificationService.sendDailySummary(pref.telegramUserId);
        } catch (error) {
          logger.error(`Error sending daily summary to user ${pref.telegramUserId}:`, error);
        }
      }
    }
  } catch (error) {
    logger.error('Error sending daily summaries:', error);
  }
}

/**
 * Check if any raffle has ended and send alerts
 */
async function checkRaffleEnd(): Promise<void> {
  try {
    const now = new Date();
    
    // Find raffles that just ended (within last 5 minutes)
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    const endedRaffles = await prisma.raffle.findMany({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: {
          gte: fiveMinutesAgo,
          lte: now,
        },
      },
    });

    for (const raffle of endedRaffles) {
      // Update status
      await prisma.raffle.update({
        where: { id: raffle.id },
        data: { status: RAFFLE_STATUS.ENDED },
      });

      // Send admin alert
      await notificationService.sendAdminAlert(
        `🏁 Raffle ended!\n\n` +
        `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
        `Ended: ${raffle.endTime.toLocaleString()}\n\n` +
        `Use /award_prize to select a winner.`
      );

      logger.info(`Raffle ${raffle.id} has ended, admin notified`);
    }
  } catch (error) {
    logger.error('Error checking raffle end:', error);
  }
}

/**
 * Setup recurring jobs
 */
export async function setupNotificationJobs(): Promise<void> {
  try {
    // Process due notifications every minute
    await notificationQueue.add(
      'process_due_notifications',
      {},
      {
        repeat: {
          pattern: '* * * * *', // Every minute
        },
        jobId: 'process_due_notifications',
      }
    );

    // Check for raffle reminders every 10 minutes
    await notificationQueue.add(
      'schedule_raffle_reminders',
      {},
      {
        repeat: {
          pattern: '*/10 * * * *', // Every 10 minutes
        },
        jobId: 'schedule_raffle_reminders',
      }
    );

    // Send daily summaries every 15 minutes (check for users' preferred times)
    await notificationQueue.add(
      'send_daily_summaries',
      {},
      {
        repeat: {
          pattern: '*/15 * * * *', // Every 15 minutes
        },
        jobId: 'send_daily_summaries',
      }
    );

    // Check raffle end every 5 minutes
    await notificationQueue.add(
      'check_raffle_end',
      {},
      {
        repeat: {
          pattern: '*/5 * * * *', // Every 5 minutes
        },
        jobId: 'check_raffle_end',
      }
    );

    logger.info('Notification jobs scheduled successfully');
  } catch (error) {
    logger.error('Error setting up notification jobs:', error);
  }
}

// Handle worker events
notificationWorker.on('completed', (job) => {
  logger.debug(`Notification job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
  logger.error(`Notification job ${job?.id} failed:`, err);
});

export { notificationQueue, notificationWorker };

