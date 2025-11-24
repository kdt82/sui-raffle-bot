import { Worker, Job } from 'bullmq';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { getRedisClient } from '../utils/redis';
import { STAKE_EVENTS_QUEUE } from '../blockchain/stake-detector';
import { notificationService } from '../services/notification-service';
import { bot } from '../bot';
import { RAFFLE_STATUS } from '../utils/constants';

interface StakeTicketJob {
    stakeEventId: string;
    raffleId: string;
    walletAddress: string;
    tokenAmount: string;
    ticketsAdjusted: number;
    stakeType: 'stake' | 'unstake';
}

let stakeWorker: Worker | null = null;

export function startStakeWorker(): Worker {
    if (stakeWorker) {
        return stakeWorker;
    }

    stakeWorker = new Worker<StakeTicketJob>(
        STAKE_EVENTS_QUEUE,
        async (job: Job<StakeTicketJob>) => {
            const { stakeEventId, raffleId, walletAddress, tokenAmount, ticketsAdjusted, stakeType } = job.data;

            logger.info(`Processing ${stakeType} event: ${stakeEventId}, ${stakeType === 'stake' ? '+' : '-'}${ticketsAdjusted} tickets`);

            try {
                // Check if raffle is still active and winner hasn't been selected yet
                const raffle = await prisma.raffle.findUnique({
                    where: { id: raffleId },
                });

                if (!raffle) {
                    logger.warn(`Raffle ${raffleId} not found for stake event ${stakeEventId}`);
                    await prisma.stakeEvent.update({
                        where: { id: stakeEventId },
                        data: { processed: true },
                    });
                    return { success: false, reason: 'raffle_not_found' };
                }

                // Only process if winner hasn't been selected yet
                if (raffle.status === RAFFLE_STATUS.WINNER_SELECTED) {
                    logger.info(`Raffle ${raffleId} winner already selected, ignoring ${stakeType} event`);
                    await prisma.stakeEvent.update({
                        where: { id: stakeEventId },
                        data: { processed: true },
                    });
                    return { success: false, reason: 'winner_already_selected' };
                }

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
                    logger.info(`No tickets found for ${walletAddress} in raffle ${raffleId}`);
                    await prisma.stakeEvent.update({
                        where: { id: stakeEventId },
                        data: { processed: true },
                    });
                    return { success: false, reason: 'no_tickets' };
                }

                const currentCount = existingTicket.ticketCount;
                let newCount: number;
                let actualAdjustment: number;

                if (stakeType === 'stake') {
                    // Add bonus tickets
                    newCount = currentCount + ticketsAdjusted;
                    actualAdjustment = ticketsAdjusted;
                } else {
                    // Remove bonus tickets, but don't go below 0
                    newCount = Math.max(0, currentCount - ticketsAdjusted);
                    actualAdjustment = currentCount - newCount;
                }

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

                // Mark stake event as processed
                await prisma.stakeEvent.update({
                    where: { id: stakeEventId },
                    data: { processed: true },
                });

                logger.info(`${stakeType === 'stake' ? 'Added' : 'Removed'} ${actualAdjustment} bonus tickets for ${walletAddress}. New balance: ${newCount}`);

                // Notify user if wallet is linked
                const walletUser = await prisma.walletUser.findUnique({
                    where: { walletAddress },
                });

                if (walletUser && actualAdjustment > 0) {
                    try {
                        const message = stakeType === 'stake'
                            ? `🎁 *Staking Bonus!*\n\n` +
                            `You've staked your tokens and earned bonus tickets!\n` +
                            `📈 Bonus Tickets: *+${actualAdjustment}*\n` +
                            `🎫 Total Tickets: *${newCount}*\n\n` +
                            `_Keep your tokens staked until the winner is selected to maintain your bonus!_`
                            : `⚠️ *Unstaking Penalty*\n\n` +
                            `You've unstaked your tokens and lost bonus tickets.\n` +
                            `📉 Bonus Tickets Removed: *-${actualAdjustment}*\n` +
                            `🎫 Remaining Tickets: *${newCount}*\n\n` +
                            `_Stake again to earn bonus tickets!_`;

                        await bot.sendMessage(Number(walletUser.telegramUserId), message, {
                            parse_mode: 'Markdown'
                        });
                    } catch (error) {
                        logger.warn(`Could not notify user ${walletUser.telegramUserId}:`, error);
                    }
                }

                // Send Admin Alert
                if (actualAdjustment > 0) {
                    const emoji = stakeType === 'stake' ? '📈' : '📉';
                    const action = stakeType === 'stake' ? 'Staked' : 'Unstaked';
                    await notificationService.sendAdminAlert(
                        `${emoji} *${action} Tokens Detected*\n\n` +
                        `👤 Wallet: \`${walletAddress}\`\n` +
                        `${stakeType === 'stake' ? '📈' : '📉'} Tickets ${stakeType === 'stake' ? 'Added' : 'Removed'}: ${actualAdjustment}\n` +
                        `🎫 Total Tickets: ${newCount}\n` +
                        `🔗 Event ID: \`${stakeEventId}\``
                    );

                    // Send public announcement to main chat for stakes
                    if (stakeType === 'stake') {
                        const MAIN_CHAT_ID = process.env.MAIN_CHAT_ID;
                        if (MAIN_CHAT_ID) {
                            try {
                                const shortWallet = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
                                await bot.sendMessage(
                                    MAIN_CHAT_ID,
                                    `📢 **Staking Bonus Awarded!**\n\n` +
                                    `Wallet \`${shortWallet}\` has staked tokens on Moonbags.io!\n` +
                                    `🎟️ They have been awarded an additional **${actualAdjustment}** tickets in the raffle!`,
                                    { parse_mode: 'Markdown' }
                                );
                            } catch (error) {
                                logger.warn('Failed to send staking announcement to main chat:', error);
                            }
                        }
                    }
                }

                return { success: true, ticketsAdjusted: actualAdjustment, newCount };
            } catch (error) {
                logger.error('Error adjusting tickets for stake event:', error);
                throw error;
            }
        },
        {
            connection: getRedisClient(),
            concurrency: 5,
        }
    );

    stakeWorker.on('completed', (job) => {
        logger.debug(`Stake ticket adjustment job ${job.id} completed`);
    });

    stakeWorker.on('failed', (job, error) => {
        logger.error(`Stake ticket adjustment job ${job?.id} failed:`, error);
    });

    logger.info('Stake worker started');
    return stakeWorker;
}

export async function stopStakeWorker(): Promise<void> {
    if (stakeWorker) {
        await stakeWorker.close();
        stakeWorker = null;
        logger.info('Stake worker stopped');
    }
}
