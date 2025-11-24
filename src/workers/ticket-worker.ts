import { Worker, Job } from 'bullmq';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { bot } from '../bot';
import { getRedisClient } from '../utils/redis';
import { BUY_EVENTS_QUEUE } from '../blockchain/buy-detector';
import { notificationService } from '../services/notification-service';
import { trackTicketAllocation } from '../utils/metrics';

interface TicketAllocationJob {
  buyEventId: string;
  raffleId: string;
  walletAddress: string;
  ticketCount: number;
}

let ticketWorker: Worker | null = null;

export function startTicketWorker(): Worker {
  if (ticketWorker) {
    return ticketWorker;
  }

  ticketWorker = new Worker<TicketAllocationJob>(
    BUY_EVENTS_QUEUE,
    async (job: Job<TicketAllocationJob>) => {
      const { buyEventId, raffleId, walletAddress, ticketCount } = job.data;

      logger.info(`Processing ticket allocation: ${buyEventId}, ${ticketCount} tickets`);

      try {
        // Update or create ticket record
        const ticket = await prisma.ticket.upsert({
          where: {
            raffleId_walletAddress: {
              raffleId,
              walletAddress,
            },
          },
          update: {
            ticketCount: {
              increment: ticketCount,
            },
          },
          create: {
            raffleId,
            walletAddress,
            ticketCount,
          },
        });

        // Mark buy event as processed
        await prisma.buyEvent.update({
          where: { id: buyEventId },
          data: { processed: true },
        });

        logger.info(`Tickets allocated: ${ticket.ticketCount} total tickets for ${walletAddress}`);

        // Track metrics
        trackTicketAllocation(ticketCount);

        // Get buy event for token amount
        const buyEvent = await prisma.buyEvent.findUnique({
          where: { id: buyEventId },
        });

        // Notify user if wallet is linked (using enhanced notification service)
        const walletUser = await prisma.walletUser.findFirst({
          where: { walletAddress },
        });

        if (walletUser && buyEvent) {
          try {
            await notificationService.notifyTicketAllocation(
              walletUser.telegramUserId,
              walletAddress,
              ticketCount,
              buyEvent.tokenAmount,
              raffleId
            );
          } catch (error) {
            logger.warn(`Could not notify user ${walletUser.telegramUserId}:`, error);
          }
        }

        return { success: true, ticketCount: ticket.ticketCount };
      } catch (error) {
        logger.error('Error allocating tickets:', error);
        throw error;
      }
    },
    {
      connection: getRedisClient(),
      concurrency: 5,
    }
  );

  ticketWorker.on('completed', (job) => {
    logger.debug(`Ticket allocation job ${job.id} completed`);
  });

  ticketWorker.on('failed', (job, error) => {
    logger.error(`Ticket allocation job ${job?.id} failed:`, error);
  });

  logger.info('Ticket worker started');
  return ticketWorker;
}

export async function stopTicketWorker(): Promise<void> {
  if (ticketWorker) {
    await ticketWorker.close();
    ticketWorker = null;
    logger.info('Ticket worker stopped');
  }
}

