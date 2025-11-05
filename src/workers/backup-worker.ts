import { Queue, Worker } from 'bullmq';
import { getRedisClient } from '../utils/redis';
import { backupService } from '../services/backup-service';
import { logger } from '../utils/logger';

const backupQueue = new Queue('backups', {
  connection: getRedisClient(),
});

// Worker to process backup jobs
const backupWorker = new Worker(
  'backups',
  async (job) => {
    logger.info(`Processing backup job: ${job.name}`, { jobId: job.id });

    try {
      switch (job.name) {
        case 'create_full_backup':
          await backupService.createFullBackup();
          break;

        case 'create_raffle_backup':
          if (job.data.raffleId) {
            await backupService.createRaffleBackup(job.data.raffleId);
          }
          break;

        case 'cleanup_old_backups':
          const retentionDays = job.data.retentionDays || 30;
          await backupService.cleanupOldBackups(retentionDays);
          break;

        default:
          logger.warn(`Unknown backup job type: ${job.name}`);
      }
    } catch (error) {
      logger.error(`Error processing backup job ${job.name}:`, error);
      throw error;
    }
  },
  {
    connection: getRedisClient(),
    concurrency: 1, // Run backups sequentially
  }
);

/**
 * Schedule a raffle backup
 */
export async function scheduleRaffleBackup(raffleId: string): Promise<void> {
  try {
    await backupQueue.add(
      'create_raffle_backup',
      { raffleId },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    );

    logger.info(`Scheduled backup for raffle ${raffleId}`);
  } catch (error) {
    logger.error(`Failed to schedule raffle backup for ${raffleId}:`, error);
  }
}

/**
 * Setup recurring backup jobs
 */
export async function setupBackupJobs(): Promise<void> {
  try {
    // Initialize backup directory
    await backupService.initialize();

    // Create full backup daily at 2 AM UTC
    await backupQueue.add(
      'create_full_backup',
      {},
      {
        repeat: {
          pattern: '0 2 * * *', // 2 AM UTC daily
        },
        jobId: 'create_full_backup',
      }
    );

    // Cleanup old backups weekly (Sunday at 3 AM)
    await backupQueue.add(
      'cleanup_old_backups',
      { retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30') },
      {
        repeat: {
          pattern: '0 3 * * 0', // 3 AM UTC on Sundays
        },
        jobId: 'cleanup_old_backups',
      }
    );

    logger.info('Backup jobs scheduled successfully');
  } catch (error) {
    logger.error('Error setting up backup jobs:', error);
  }
}

// Handle worker events
backupWorker.on('completed', (job) => {
  logger.info(`Backup job ${job.id} completed successfully`);
});

backupWorker.on('failed', (job, err) => {
  logger.error(`Backup job ${job?.id} failed:`, err);
});

export { backupQueue, backupWorker };

