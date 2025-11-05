import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from './utils/database';
import { getRedisClient, closeRedis } from './utils/redis';
import { logger } from './utils/logger';
import { registerUserHandlers, registerAdminHandlers } from './bot/handlers';
import { buyDetector } from './blockchain/buy-detector';
import { startTicketWorker, stopTicketWorker } from './workers/ticket-worker';
import { startRaffleManager, stopRaffleManager } from './services/raffle-service';
import { setupNotificationJobs } from './workers/notification-worker';
import { setupAnalyticsJobs } from './workers/analytics-worker';
import { setupBackupJobs } from './workers/backup-worker';
import { startHealthServer } from './api/server';

// Load environment variables
dotenv.config();

async function start(): Promise<void> {
  try {
    logger.info('Starting SUI Raffle Telegram Bot...');

    // Connect to database
    await connectDatabase();

    // Connect to Redis
    getRedisClient();

    // Start health server
    await startHealthServer();

    // Register bot handlers
    registerUserHandlers();
    registerAdminHandlers();
    logger.info('Bot handlers registered');

    // Start buy detector
    await buyDetector.start();

    // Start ticket worker
    startTicketWorker();

    // Start raffle manager
    startRaffleManager();

    // Setup notification jobs
    await setupNotificationJobs();
    logger.info('Notification jobs scheduled');

    // Setup analytics jobs
    await setupAnalyticsJobs();
    logger.info('Analytics jobs scheduled');

    // Setup backup jobs
    await setupBackupJobs();
    logger.info('Backup jobs scheduled');

    logger.info('✅ SUI Raffle Telegram Bot started successfully!');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  try {
    await buyDetector.stop();
    await stopTicketWorker();
    stopRaffleManager();
    await closeRedis();
    await disconnectDatabase();
    logger.info('Shutdown complete');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }

  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle unhandled errors
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  shutdown();
});

// Start the application
start();

