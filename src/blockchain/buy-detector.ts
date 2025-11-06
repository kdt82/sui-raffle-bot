import { getSuiClient } from './sui-client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';
import { Queue } from 'bullmq';
import { getRedisClient } from '../utils/redis';
import { dexFactory } from './dex/factory';
import { DexType } from '../utils/constants';
import { BuyEventData } from './dex/base';
import { bot } from '../bot';

export const BUY_EVENTS_QUEUE = 'buy-events';

let buyEventsQueue: Queue | null = null;

export function getBuyEventsQueue(): Queue {
  if (!buyEventsQueue) {
    buyEventsQueue = new Queue(BUY_EVENTS_QUEUE, {
      connection: getRedisClient(),
    });
  }
  return buyEventsQueue;
}

export class BuyDetector {
  private activeRaffle: { id: string; ca: string; dex: DexType } | null = null;
  private currentDexIntegration: any = null;

  async start(): Promise<void> {
    logger.info('Starting buy detector...');
    await this.updateActiveRaffle();
    this.startPolling();
  }

  async stop(): Promise<void> {
    if (this.currentDexIntegration) {
      await dexFactory.stopDex(this.activeRaffle!.dex);
      this.currentDexIntegration = null;
    }
    logger.info('Buy detector stopped');
  }

  private async updateActiveRaffle(): Promise<void> {
    const raffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (raffle) {
      // Stop previous DEX monitoring if raffle changed
      if (this.activeRaffle && this.activeRaffle.dex !== raffle.dex) {
        await dexFactory.stopDex(this.activeRaffle.dex);
        this.currentDexIntegration = null;
      }

      this.activeRaffle = { id: raffle.id, ca: raffle.ca, dex: raffle.dex as DexType };
      logger.info(`Active raffle found: ${raffle.id}, monitoring CA: ${raffle.ca} on DEX: ${raffle.dex}`);

      // Start monitoring with the selected DEX
      if (!this.currentDexIntegration) {
        await this.startDexMonitoring();
      }
    } else {
      // Stop monitoring if no active raffle
      if (this.activeRaffle) {
        await dexFactory.stopDex(this.activeRaffle.dex);
        this.currentDexIntegration = null;
      }
      this.activeRaffle = null;
      logger.info('No active raffle found');
    }
  }

  private async startDexMonitoring(): Promise<void> {
    if (!this.activeRaffle) {
      return;
    }

    try {
      logger.info(`Starting ${this.activeRaffle.dex} monitoring for token: ${this.activeRaffle.ca}`);
      
      await dexFactory.monitorDex(
        this.activeRaffle.dex,
        this.activeRaffle.ca,
        async (buyEvent: BuyEventData) => {
          await this.processBuyEvent(buyEvent);
        }
      );

      this.currentDexIntegration = this.activeRaffle.dex;
    } catch (error) {
      logger.error(`Error starting ${this.activeRaffle.dex} monitoring:`, error);
    }
  }

  private startPolling(): void {
    // Poll every 30 seconds to check for raffle updates
    setInterval(async () => {
      try {
        await this.updateActiveRaffle();
      } catch (error) {
        logger.error('Error in buy detector polling:', error);
      }
    }, 30000);
  }

  async processBuyEvent(data: BuyEventData): Promise<void> {
    if (!this.activeRaffle) {
      logger.warn('No active raffle, skipping buy event');
      return;
    }

    try {
      // Check if transaction already processed
      const existing = await prisma.buyEvent.findUnique({
        where: { transactionHash: data.transactionHash },
      });

      if (existing) {
        logger.debug(`Transaction ${data.transactionHash} already processed`);
        return;
      }

      // Create buy event
      const buyEvent = await prisma.buyEvent.create({
        data: {
          raffleId: this.activeRaffle.id,
          walletAddress: data.walletAddress,
          tokenAmount: data.tokenAmount,
          ticketCount: Math.floor(parseFloat(data.tokenAmount) * 100), // 100 tickets per token
          transactionHash: data.transactionHash,
          timestamp: data.timestamp,
          processed: false,
        },
      });

      // Queue ticket allocation job
      const queue = getBuyEventsQueue();
      await queue.add('allocate-tickets', {
        buyEventId: buyEvent.id,
        raffleId: buyEvent.raffleId,
        walletAddress: buyEvent.walletAddress,
        ticketCount: buyEvent.ticketCount,
      });

      logger.info(`Buy event queued: ${buyEvent.id}, ${buyEvent.ticketCount} tickets`);

      // Send broadcast notification to channel
      await this.broadcastBuyNotification(buyEvent, data);

      // Auto-link wallet if not already linked
      await this.autoLinkWallet(data.walletAddress);
    } catch (error) {
      logger.error('Error processing buy event:', error);
    }
  }

  private async autoLinkWallet(walletAddress: string): Promise<void> {
    try {
      const walletUser = await prisma.walletUser.findUnique({
        where: { walletAddress },
      });

      if (!walletUser) {
        // Wallet detected but not linked - we'll create a record but not verify
        // Users can still link manually to get notifications
        logger.debug(`New wallet detected: ${walletAddress} (not linked to Telegram user)`);
      }
    } catch (error) {
      logger.error('Error auto-linking wallet:', error);
    }
  }

  private async broadcastBuyNotification(buyEvent: any, data: BuyEventData): Promise<void> {
    try {
      const broadcastChannelId = process.env.BROADCAST_CHANNEL_ID;
      if (!broadcastChannelId) {
        logger.debug('No BROADCAST_CHANNEL_ID configured, skipping broadcast');
        return;
      }

      // Get raffle details
      const raffle = await prisma.raffle.findUnique({
        where: { id: buyEvent.raffleId },
      });

      if (!raffle) return;

      // Format wallet address
      const shortWallet = `${data.walletAddress.slice(0, 6)}...${data.walletAddress.slice(-4)}`;

      // Build message
      const message = 
        `🎉 *NEW BUY DETECTED!* 🎉\n\n` +
        `💰 Amount: \`${data.tokenAmount}\` tokens\n` +
        `🎟️ Tickets Earned: \`${buyEvent.ticketCount}\`\n` +
        `👤 Wallet: \`${shortWallet}\`\n` +
        `🔗 DEX: \`${raffle.dex.toUpperCase()}\`\n\n` +
        `🏆 Prize Pool: \`${raffle.prizeAmount} ${raffle.prizeType}\`\n` +
        `⏰ Raffle Ends: ${raffle.endTime.toLocaleString('en-US', { timeZone: 'UTC' })} UTC\n\n` +
        `_Every 1 token purchased = 100 raffle tickets!_`;

      // Send message with media if available
      if (raffle.mediaUrl && raffle.mediaType) {
        if (raffle.mediaType === 'image') {
          await bot.sendPhoto(broadcastChannelId, raffle.mediaUrl, {
            caption: message,
            parse_mode: 'Markdown',
          });
        } else if (raffle.mediaType === 'video') {
          await bot.sendVideo(broadcastChannelId, raffle.mediaUrl, {
            caption: message,
            parse_mode: 'Markdown',
          });
        } else if (raffle.mediaType === 'gif') {
          await bot.sendAnimation(broadcastChannelId, raffle.mediaUrl, {
            caption: message,
            parse_mode: 'Markdown',
          });
        }
      } else {
        // No media, just send text
        await bot.sendMessage(broadcastChannelId, message, {
          parse_mode: 'Markdown',
        });
      }

      logger.info(`📢 Broadcast buy notification sent to channel ${broadcastChannelId}`);
    } catch (error) {
      logger.error('Error broadcasting buy notification:', error);
    }
  }
}

export const buyDetector = new BuyDetector();

