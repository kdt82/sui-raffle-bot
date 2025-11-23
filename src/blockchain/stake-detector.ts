import { SuiClient } from '@mysten/sui.js/client';
import { Queue } from 'bullmq';
import { getSuiClient } from './sui-client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS, MOONBAGS_STAKE_EVENT, MOONBAGS_UNSTAKE_EVENT, STAKE_POLL_INTERVAL_MS } from '../utils/constants';
import { getRedisClient } from '../utils/redis';

export const STAKE_EVENTS_QUEUE = 'stake-events';

let stakeEventsQueue: Queue | null = null;

export function getStakeEventsQueue(): Queue {
    if (!stakeEventsQueue) {
        stakeEventsQueue = new Queue(STAKE_EVENTS_QUEUE, {
            connection: getRedisClient(),
        });
    }
    return stakeEventsQueue;
}

interface StakeEventData {
    walletAddress: string;
    tokenAmount: string;
    transactionHash: string;
    timestamp: Date;
    stakeType: 'stake' | 'unstake';
    stakingPool?: string;
    stakingAccount?: string;
}

interface MoonbagsStakeEvent {
    amount: string;
    staker: string;
    staking_account: string;
    staking_pool: string;
    timestamp: string;
    token_address: string;
}

interface MoonbagsUnstakeEvent {
    amount: string;
    unstaker: string;
    staking_account: string;
    staking_pool: string;
    timestamp: string;
    token_address: string;
    is_staking_account_deleted: boolean;
}

export class StakeDetector {
    private activeRaffle: { id: string; ca: string; ticketsPerToken?: string | null; stakingBonusPercent?: number | null } | null = null;
    private rafflePollInterval: NodeJS.Timeout | null = null;
    private onChainPollInterval: NodeJS.Timeout | null = null;
    private processedEventIds: Set<string> = new Set();
    private lastProcessedTimestamp = 0;
    private initialized = false;

    async start(): Promise<void> {
        logger.info('Starting stake detector...');
        await this.updateActiveRaffle();
        this.startRafflePolling();
    }

    async stop(): Promise<void> {
        this.stopOnChainMonitoring();

        if (this.rafflePollInterval) {
            clearInterval(this.rafflePollInterval);
            this.rafflePollInterval = null;
        }

        logger.info('Stake detector stopped');
    }

    private async updateActiveRaffle(): Promise<void> {
        try {
            const raffle = await prisma.raffle.findFirst({
                where: {
                    status: RAFFLE_STATUS.ACTIVE,
                    started: true,
                    endTime: { gt: new Date() },
                },
                orderBy: { createdAt: 'desc' },
            });

            if (raffle) {
                const hasChanged =
                    !this.activeRaffle ||
                    this.activeRaffle.id !== raffle.id ||
                    this.activeRaffle.ca !== raffle.ca;

                this.activeRaffle = {
                    id: raffle.id,
                    ca: raffle.ca,
                    ticketsPerToken: raffle.ticketsPerToken,
                    stakingBonusPercent: raffle.stakingBonusPercent
                };

                if (hasChanged) {
                    logger.info(`Active raffle found: ${raffle.id}, monitoring staking for CA: ${raffle.ca}`);
                    await this.startOnChainMonitoring(true);
                } else if (!this.onChainPollInterval) {
                    await this.startOnChainMonitoring(false);
                }
            } else {
                if (this.activeRaffle) {
                    logger.info('No active raffle found, stopping stake monitoring');
                }
                this.activeRaffle = null;
                this.stopOnChainMonitoring();
            }
        } catch (error) {
            logger.error('Error checking for active raffle in stake detector:', error);
        }
    }

    private async startOnChainMonitoring(forceReset = false): Promise<void> {
        if (!this.activeRaffle) {
            return;
        }

        if (forceReset) {
            this.stopOnChainMonitoring();
        } else if (this.onChainPollInterval) {
            return;
        }

        this.processedEventIds.clear();
        this.lastProcessedTimestamp = 0;
        this.initialized = false;

        await this.pollStakeEvents(true);
        this.initialized = true;

        this.onChainPollInterval = setInterval(async () => {
            try {
                await this.pollStakeEvents(false);
            } catch (error) {
                logger.error('Error polling stake events:', error);
            }
        }, STAKE_POLL_INTERVAL_MS);

        logger.info(`Stake monitoring started for token: ${this.activeRaffle.ca}`);
    }

    private stopOnChainMonitoring(): void {
        if (this.onChainPollInterval) {
            clearInterval(this.onChainPollInterval);
            this.onChainPollInterval = null;
            logger.info('Stake monitoring stopped');
        }

        this.processedEventIds.clear();
        this.lastProcessedTimestamp = 0;
        this.initialized = false;
    }

    private startRafflePolling(): void {
        if (this.rafflePollInterval) {
            return;
        }

        this.rafflePollInterval = setInterval(async () => {
            try {
                await this.updateActiveRaffle();
            } catch (error) {
                logger.error('Error in stake detector polling:', error);
            }
        }, 30000);
    }

    private async pollStakeEvents(initial: boolean): Promise<void> {
        if (!this.activeRaffle) {
            return;
        }

        const client = getSuiClient();

        // Poll both stake and unstake events
        await this.pollEventType(client, MOONBAGS_STAKE_EVENT, 'stake', initial);
        await this.pollEventType(client, MOONBAGS_UNSTAKE_EVENT, 'unstake', initial);
    }

    private async pollEventType(
        client: SuiClient,
        eventType: string,
        stakeType: 'stake' | 'unstake',
        initial: boolean
    ): Promise<void> {
        if (!this.activeRaffle) return;

        try {
            const events = await client.queryEvents({
                query: {
                    MoveEventType: eventType,
                },
                order: 'descending',
                limit: 50,
            });

            const eventList = events.data ?? [];

            if (initial) {
                const latestTimestamp = eventList.reduce((max, event) => {
                    const ts = parseInt(event.timestampMs || '0', 10);
                    return Number.isNaN(ts) ? max : Math.max(max, ts);
                }, 0);

                this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, latestTimestamp || Date.now());

                for (const event of eventList) {
                    const key = this.getEventKey(event);
                    if (key) {
                        this.processedEventIds.add(key);
                    }
                }
                return;
            }

            const orderedEvents = [...eventList].reverse();

            for (const event of orderedEvents) {
                const eventKey = this.getEventKey(event);
                if (!eventKey) continue;

                const timestamp = parseInt(event.timestampMs || '0', 10) || Date.now();

                if (this.processedEventIds.has(eventKey)) continue;
                if (this.initialized && timestamp <= this.lastProcessedTimestamp) continue;

                const parsed = (event.parsedJson as Record<string, any>) ?? {};

                // Filter by token_address matching active raffle's CA
                const tokenAddress = parsed.token_address as string;
                if (!tokenAddress) {
                    this.processedEventIds.add(eventKey);
                    continue;
                }

                // Normalize token addresses for comparison (remove 0x prefix if present)
                const normalizedTokenAddress = tokenAddress.toLowerCase().replace(/^0x/, '');
                const normalizedRaffleCA = this.activeRaffle.ca.toLowerCase().replace(/^0x/, '');

                if (!normalizedTokenAddress.includes(normalizedRaffleCA)) {
                    this.processedEventIds.add(eventKey);
                    continue;
                }

                const txDigest = event.id?.txDigest;
                if (!txDigest) {
                    this.processedEventIds.add(eventKey);
                    continue;
                }

                // Extract wallet address and amount based on stake type
                const walletAddress = stakeType === 'stake'
                    ? (parsed.staker as string)
                    : (parsed.unstaker as string);

                const amount = parsed.amount as string;

                if (!walletAddress || !amount) {
                    this.processedEventIds.add(eventKey);
                    continue;
                }

                // Use composite key for transactionHash to handle multiple events in one tx
                const uniqueTransactionKey = `${txDigest}:${event.id?.eventSeq}`;

                const stakeEvent: StakeEventData = {
                    walletAddress,
                    tokenAmount: amount,
                    transactionHash: uniqueTransactionKey,
                    timestamp: new Date(timestamp),
                    stakeType,
                    stakingPool: parsed.staking_pool as string | undefined,
                    stakingAccount: parsed.staking_account as string | undefined,
                };

                await this.processStakeEvent(stakeEvent);

                this.processedEventIds.add(eventKey);
                this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, timestamp);
            }

            this.compactProcessedEvents();
        } catch (error) {
            if (initial) {
                this.lastProcessedTimestamp = Date.now();
            }
            logger.error(`Failed to query ${stakeType} events:`, error);
        }
    }

    private async processStakeEvent(data: StakeEventData): Promise<void> {
        if (!this.activeRaffle) return;

        try {
            const existing = await prisma.stakeEvent.findUnique({
                where: { transactionHash: data.transactionHash },
            });

            if (existing) return;

            const ticketsAdjusted = this.calculateTicketAdjustment(data);

            const stakeEvent = await prisma.stakeEvent.create({
                data: {
                    raffleId: this.activeRaffle.id,
                    walletAddress: data.walletAddress,
                    tokenAmount: data.tokenAmount,
                    stakeType: data.stakeType,
                    ticketsAdjusted,
                    transactionHash: data.transactionHash,
                    stakingPool: data.stakingPool,
                    stakingAccount: data.stakingAccount,
                    timestamp: data.timestamp,
                    processed: false,
                },
            });

            const queue = getStakeEventsQueue();
            await queue.add('adjust-tickets', {
                stakeEventId: stakeEvent.id,
                raffleId: stakeEvent.raffleId,
                walletAddress: stakeEvent.walletAddress,
                tokenAmount: stakeEvent.tokenAmount,
                ticketsAdjusted: stakeEvent.ticketsAdjusted,
                stakeType: stakeEvent.stakeType,
            });

            logger.info(`${data.stakeType} event queued: ${stakeEvent.id}, ${data.stakeType === 'stake' ? '+' : '-'}${stakeEvent.ticketsAdjusted} tickets`);
        } catch (error) {
            logger.error('Error processing stake event:', error);
        }
    }

    private calculateTicketAdjustment(data: StakeEventData): number {
        try {
            const ticketsPerToken = this.activeRaffle?.ticketsPerToken
                ? parseFloat(this.activeRaffle.ticketsPerToken)
                : 100;

            // Use raffle's staking bonus percent, default to 25% if not set
            const bonusPercent = this.activeRaffle?.stakingBonusPercent ?? 25;
            const bonusMultiplier = bonusPercent / 100;

            const amount = BigInt(data.tokenAmount);
            const decimals = 9; // SUI standard decimals
            const scale = BigInt(10) ** BigInt(decimals);
            if (scale === 0n) return 0;

            const PRECISION = 1000000;
            const ratio = Math.floor(ticketsPerToken * PRECISION);
            const bonusRatio = Math.floor(ratio * bonusMultiplier);
            const ratioBig = BigInt(bonusRatio);
            const precisionBig = BigInt(PRECISION);

            const ticketsBig = (amount * ratioBig) / (scale * precisionBig);
            return Number(ticketsBig);
        } catch (error) {
            return 0;
        }
    }

    private compactProcessedEvents(): void {
        if (this.processedEventIds.size <= 200) return;
        const recent = Array.from(this.processedEventIds).slice(-100);
        this.processedEventIds = new Set(recent);
    }

    private getEventKey(event: any): string | null {
        const txDigest = event.id?.txDigest;
        const seq = event.id?.eventSeq;
        if (!txDigest || typeof seq === 'undefined') return null;
        return `${txDigest}:${seq}`;
    }
}

export const stakeDetector = new StakeDetector();
