import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS, formatDate } from '../utils/constants';
import { selectWinner } from './winner-service';
import { notificationService } from './notification-service';
import { trackRaffleEvent } from '../utils/metrics';
import { scheduleRaffleAnalytics } from '../workers/analytics-worker';
import { scheduleRaffleBackup } from '../workers/backup-worker';
import { bot } from '../bot';
import { auditService } from './audit-service';

const MAIN_CHAT_ID = process.env.MAIN_CHAT_ID;

export async function checkAndStartRaffles(): Promise<void> {
  try {
    const rafflesToStart = await prisma.raffle.findMany({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        startTime: { lte: new Date() },
        started: false, // Only raffles that haven't sent start message yet
      },
    });

    for (const raffle of rafflesToStart) {
      await sendRaffleStartAnnouncement(raffle);
    }
  } catch (error) {
    logger.error('Error checking for starting raffles:', error);
  }
}

async function sendRaffleStartAnnouncement(raffle: any): Promise<void> {
  try {
    logger.info(`Sending start announcement for raffle: ${raffle.id}`);

    // Mark as started to prevent duplicate announcements
    await prisma.raffle.update({
      where: { id: raffle.id },
      data: { started: true },
    });

    if (!MAIN_CHAT_ID) {
      logger.warn('MAIN_CHAT_ID not configured, skipping start announcement');
      return;
    }

    // Format ticket ratio for display
    const ratio = parseFloat(raffle.ticketsPerToken || '100');
    const ticketExplanation = ratio >= 1
      ? `For every token you purchase, you'll receive **${ratio} raffle tickets**!`
      : `For every **${Math.round(1 / ratio).toLocaleString()} tokens** you purchase, you'll receive **1 raffle ticket**!`;

    const minimumPurchaseText = raffle.minimumPurchase
      ? `\n\n🎫 **Minimum Purchase:** ${raffle.minimumPurchase} tokens`
      : '';

    const startMessage =
      `🚀 **RAFFLE HAS STARTED!** 🚀\n\n` +
      `💰 **Prize:** ${raffle.prizeAmount} ${raffle.prizeType}\n\n` +
      `⏰ **Active Now Until:** ${formatDate(raffle.endTime)} UTC\n\n` +
      `📝 **Contract Address:**\n\`${raffle.ca}\`${minimumPurchaseText}\n\n` +
      `🎟️ **Ticket Allocation:**\n${ticketExplanation}\n\n` +
      `🔗 **Quick Start:**\n` +
      `1. Link wallet: /linkwallet <address>\n` +
      `2. Buy tokens now!\n` +
      `3. Tickets earned automatically\n\n` +
      `⚠️ **Link your wallet first!**\n\n` +
      `Good luck! 🍀`;

    // Send with announcement media if available
    if (raffle.announcementMediaUrl && raffle.announcementMediaType) {
      if (raffle.announcementMediaType === 'image') {
        try {
          await bot.sendPhoto(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
            caption: startMessage,
            parse_mode: 'Markdown',
          });
        } catch (photoError: any) {
          if (photoError?.message?.includes('Document as Photo')) {
            await bot.sendDocument(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
              caption: startMessage,
              parse_mode: 'Markdown',
            });
          } else {
            throw photoError;
          }
        }
      } else if (raffle.announcementMediaType === 'video') {
        try {
          await bot.sendVideo(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
            caption: startMessage,
            parse_mode: 'Markdown',
          });
        } catch (videoError: any) {
          if (videoError?.message?.includes('Document as Video')) {
            await bot.sendDocument(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
              caption: startMessage,
              parse_mode: 'Markdown',
            });
          } else {
            throw videoError;
          }
        }
      } else if (raffle.announcementMediaType === 'gif') {
        await bot.sendAnimation(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
          caption: startMessage,
          parse_mode: 'Markdown',
        });
      }
    } else {
      // Send without media
      await bot.sendMessage(MAIN_CHAT_ID, startMessage, {
        parse_mode: 'Markdown',
      });
    }

    logger.info(`Start announcement sent for raffle: ${raffle.id}`);

    // AUDIT LOG: Raffle started (non-blocking)
    auditService.logRaffleStarted(raffle.id).catch(err =>
      logger.error('Audit log failed (non-blocking):', err)
    );

    // Track metrics
    trackRaffleEvent('started');

    // Send admin notification
    await notificationService.sendAdminAlert(
      `🚀 Raffle started!\n\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
      `Started: ${new Date().toLocaleString()}\n` +
      `Ends: ${raffle.endTime.toLocaleString()}`
    );
  } catch (error) {
    logger.error(`Error sending start announcement for raffle ${raffle.id}:`, error);
    // Revert started flag if announcement failed
    await prisma.raffle.update({
      where: { id: raffle.id },
      data: { started: false },
    }).catch(err => logger.error('Failed to revert started flag:', err));
  }
}

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

    // AUDIT LOG: Raffle ended (non-blocking)
    auditService.logRaffleEnded(raffleId, raffle).catch(err =>
      logger.error('Audit log failed (non-blocking):', err)
    );

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

// Start periodic check for raffles
let raffleCheckInterval: NodeJS.Timeout | null = null;

export function startRaffleManager(): void {
  if (raffleCheckInterval) {
    return;
  }

  // Check every minute for both starting and ending raffles
  raffleCheckInterval = setInterval(async () => {
    await checkAndStartRaffles();
    await checkAndEndRaffles();
  }, 60000);

  // Run immediately on startup
  checkAndStartRaffles().catch(err => logger.error('Initial start check failed:', err));
  checkAndEndRaffles().catch(err => logger.error('Initial end check failed:', err));

  logger.info('Raffle manager started');
}

export function stopRaffleManager(): void {
  if (raffleCheckInterval) {
    clearInterval(raffleCheckInterval);
    raffleCheckInterval = null;
    logger.info('Raffle manager stopped');
  }
}

