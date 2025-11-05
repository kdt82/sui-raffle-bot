import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';
import { selectWinner } from './winner-service';
import { notificationService } from './notification-service';
import { trackRaffleEvent } from '../utils/metrics';
import { scheduleRaffleAnalytics } from '../workers/analytics-worker';
import { scheduleRaffleBackup } from '../workers/backup-worker';

export async function checkAndEndRaffles(): Promise<void> {
  try {
    const endedRaffles = await prisma.raffle.findMany({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { lte: new Date() },
      },
    });

    for (const raffle of endedRaffles) {
      await endRaffle(raffle.id);
    }
  } catch (error) {
    logger.error('Error checking for ended raffles:', error);
  }
}

async function endRaffle(raffleId: string): Promise<void> {
  try {
    logger.info(`Ending raffle: ${raffleId}`);

    const raffle = await prisma.raffle.findUnique({
      where: { id: raffleId },
    });

    if (!raffle) return;

    // Update raffle status
    await prisma.raffle.update({
      where: { id: raffleId },
      data: { status: RAFFLE_STATUS.ENDED },
    });

    // Track metrics
    trackRaffleEvent('ended');

    // Send admin alert
    await notificationService.sendAdminAlert(
      `🏁 Raffle ended!\n\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
      `Ended: ${raffle.endTime.toLocaleString()}\n\n` +
      `Winner will be selected automatically.`
    );

    // Create backup before selecting winner
    await scheduleRaffleBackup(raffleId);

    // Select winner
    await selectWinner(raffleId);

    // Schedule analytics aggregation for this raffle
    await scheduleRaffleAnalytics(raffleId);

    logger.info(`Raffle ${raffleId} ended and winner selected`);
  } catch (error) {
    logger.error(`Error ending raffle ${raffleId}:`, error);
  }
}

// Start periodic check for ended raffles
let raffleCheckInterval: NodeJS.Timeout | null = null;

export function startRaffleManager(): void {
  if (raffleCheckInterval) {
    return;
  }

  // Check every minute
  raffleCheckInterval = setInterval(async () => {
    await checkAndEndRaffles();
  }, 60000);

  logger.info('Raffle manager started');
}

export function stopRaffleManager(): void {
  if (raffleCheckInterval) {
    clearInterval(raffleCheckInterval);
    raffleCheckInterval = null;
    logger.info('Raffle manager stopped');
  }
}

