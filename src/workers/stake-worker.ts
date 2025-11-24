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
                    include: { project: true },
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
                    // Add bonus tickets based on CURRENT ticket count (eligible tokens)
                    // This ensures bonus is only calculated on tokens bought during raffle
                    const bonusPercent = raffle.stakingBonusPercent || 25;
                    const bonusTickets = Math.floor(currentCount * (bonusPercent / 100));

                    newCount = currentCount + bonusTickets;
                    actualAdjustment = bonusTickets;
                } else {
                    // UNSTAKE: Remove bonus tickets proportionally
                    // Calculate what percentage of total staked amount is being unstaked

                    // Get all stake events for this wallet in this raffle
                    const allStakeEvents = await prisma.stakeEvent.findMany({
                        where: {
                            raffleId,
                            walletAddress,
                            processed: true,
                        },
                        orderBy: { timestamp: 'asc' },
                    });

                    // Calculate total staked and total unstaked amounts
                    let totalStaked = 0n;
                    let totalUnstaked = 0n;
                    let totalBonusAwarded = 0;

                    for (const evt of allStakeEvents) {
                        if (evt.stakeType === 'stake') {
                            totalStaked += BigInt(evt.tokenAmount);
                            totalBonusAwarded += evt.ticketsAdjusted;
                        } else {
                            totalUnstaked += BigInt(evt.tokenAmount);
                        }
                    }

                    // Current staked balance (before this unstake)
                    const currentStaked = totalStaked - totalUnstaked;

                    if (currentStaked <= 0n) {
                        // Nothing staked, remove all bonus tickets
                        actualAdjustment = ticketsAdjusted;
                        newCount = Math.max(0, currentCount - actualAdjustment);
                    } else {
                        // Calculate proportional bonus to remove
                        const unstakeAmount = BigInt(tokenAmount);
                        const proportionUnstaked = Number(unstakeAmount * 10000n / currentStaked) / 10000; // Use basis points for precision

                        // Remove proportional amount of total bonus tickets awarded
                        const bonusToRemove = Math.floor(totalBonusAwarded * proportionUnstaked);

                        actualAdjustment = bonusToRemove;
                        newCount = Math.max(0, currentCount - bonusToRemove);
                    }
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
                const walletUser = await prisma.walletUser.findFirst({
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

                    // Send public announcement to broadcast channel for stakes
                    if (stakeType === 'stake') {
                        const broadcastChannelId = raffle.project?.broadcastChannelId;
                        if (broadcastChannelId) {
                            try {
                                const shortWallet = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
                                await bot.sendMessage(
                                    String(broadcastChannelId),
                                    `📢 **Staking Bonus Awarded!**\n\n` +
                                    `Wallet \`${shortWallet}\` has staked tokens on Moonbags.io!\n` +
                                    `🎟️ They have been awarded an additional **${actualAdjustment}** tickets in the raffle!`,
                                    { parse_mode: 'Markdown' }
                                );
                            } catch (error) {
                                logger.warn('Failed to send staking announcement to broadcast channel:', error);
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
