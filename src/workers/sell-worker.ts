import { Worker, Job } from 'bullmq';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { getRedisClient } from '../utils/redis';
import { SELL_EVENTS_QUEUE } from '../blockchain/sell-detector';
import { notificationService } from '../services/notification-service';
import { bot } from '../bot';

interface TicketRemovalJob {
    sellEventId: string;
    raffleId: string;
    walletAddress: string;
    ticketsRemoved: number;
}

let sellWorker: Worker | null = null;

export function startSellWorker(): Worker {
    if (sellWorker) {
        return sellWorker;
    }

    sellWorker = new Worker<TicketRemovalJob>(
        SELL_EVENTS_QUEUE,
        async (job: Job<TicketRemovalJob>) => {
            const { sellEventId, raffleId, walletAddress, ticketsRemoved } = job.data;

            logger.info(`Processing ticket removal: ${sellEventId}, -${ticketsRemoved} tickets`);

            try {
                // Find existing ticket record
                const existingTicket = await prisma.ticket.findUnique({
                    where: {
                        raffleId_walletAddress: {
                            raffleId,
                            walletAddress,
                        },
                    },
                });

                if (!existingTicket) {
                    logger.info(`No tickets found for ${walletAddress} to remove.`);
                    // Mark as processed anyway
                    await prisma.sellEvent.update({
                        where: { id: sellEventId },
                        data: { processed: true },
                    });
                    return { success: true, ticketsRemoved: 0 };
                }

                // Calculate new count, ensuring it doesn't go below 0
                const currentCount = existingTicket.ticketCount;
                const newCount = Math.max(0, currentCount - ticketsRemoved);
                const actualRemoved = currentCount - newCount;

                // Update ticket record
                await prisma.ticket.update({
                    where: {
                        raffleId_walletAddress: {
                            raffleId,
                            walletAddress,
                        },
                    },
                    data: {
                        ticketCount: newCount,
                    },
                });

                // Mark sell event as processed
                await prisma.sellEvent.update({
                    where: { id: sellEventId },
                    data: { processed: true },
                });

                logger.info(`Tickets removed: ${actualRemoved} (requested ${ticketsRemoved}) for ${walletAddress}. New balance: ${newCount}`);

                // Notify user if wallet is linked
                const walletUser = await prisma.walletUser.findUnique({
                    where: { walletAddress },
                });

                if (walletUser && actualRemoved > 0) {
                    try {
                        // Notify the user privately
                        await bot.sendMessage(Number(walletUser.telegramUserId),
                            `⚠️ *Tickets Removed*\n\n` +
                            `We detected a sell transaction from your wallet.\n` +
                            `📉 Tickets Removed: *${actualRemoved}*\n` +
                            `🎫 Remaining Tickets: *${newCount}*\n\n` +
                            `_To maintain your tickets, please hold your tokens until the raffle ends._`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (error) {
                        logger.warn(`Could not notify user ${walletUser.telegramUserId}:`, error);
                    }
                }

                // Send Admin Alert (as requested: "post an update in the private chat of the person who installed it")
                if (actualRemoved > 0) {
                    await notificationService.sendAdminAlert(
                        `📉 *Sell Detected & Tickets Removed*\n\n` +
                        `👤 Wallet: \`${walletAddress}\`\n` +
                        `📉 Tickets Removed: ${actualRemoved}\n` +
                        `🎫 Remaining: ${newCount}\n` +
                        `🔗 Event ID: \`${sellEventId}\``
                    );
                }

                return { success: true, ticketsRemoved: actualRemoved };
            } catch (error) {
                logger.error('Error removing tickets:', error);
                throw error;
            }
        },
        {
            connection: getRedisClient(),
            concurrency: 5,
        }
    );

    sellWorker.on('completed', (job) => {
        logger.debug(`Ticket removal job ${job.id} completed`);
    });

    sellWorker.on('failed', (job, error) => {
        logger.error(`Ticket removal job ${job?.id} failed:`, error);
    });

    logger.info('Sell worker started');
    return sellWorker;
}

export async function stopSellWorker(): Promise<void> {
    if (sellWorker) {
        await sellWorker.close();
        sellWorker = null;
        logger.info('Sell worker stopped');
    }
}
