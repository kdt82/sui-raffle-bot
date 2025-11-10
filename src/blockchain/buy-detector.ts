import { SuiClient } from '@mysten/sui.js/client';
import { Queue } from 'bullmq';
import { getSuiClient } from './sui-client';
import { getBlockberryClient, BlockberryRawTrade } from './blockberry-client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS, DEFAULT_TICKETS_PER_TOKEN, formatDate } from '../utils/constants';
import { getRedisClient } from '../utils/redis';
import { bot } from '../bot';

// Helper function to calculate countdown time remaining
function getCountdownText(endTime: Date): string {
  const now = new Date();
  const diff = endTime.getTime() - now.getTime();
  
  if (diff <= 0) {
    return '⏱️ Raffle Ended';
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  
  return `⏱️ Time Remaining: ${parts.join(' ')}`;
}

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

interface BuyEventData {
  walletAddress: string;
  tokenAmount: string;
  transactionHash: string;
  timestamp: Date;
  rawAmount?: string;
  decimals?: number;
}

interface NormalizedBlockberryTrade {
  txDigest: string;
  eventKey: string;
  timestamp: number;
  walletAddress: string;
  amountRaw: string;
  coinType: string;
  decimals?: number;
}

export class BuyDetector {
  private activeRaffle: { id: string; ca: string; minimumPurchase?: string | null; ticketsPerToken?: string | null } | null = null;
  private rafflePollInterval: NodeJS.Timeout | null = null;
  private onChainPollInterval: NodeJS.Timeout | null = null;
  private processedEventIds: Set<string> = new Set();
  private lastProcessedTimestamp = 0;
  private decimalsCache: Map<string, number> = new Map();
  private initialized = false;
  private useBlockberry = false;
  private blockberryCursor: string | null = null;
  private blockberryFailureCount = 0;
  private blockberryFallbackActive = false;

  async start(): Promise<void> {
    logger.info('Starting buy detector...');
    await this.updateActiveRaffle();
    this.startRafflePolling();
  }

  async stop(): Promise<void> {
    this.stopOnChainMonitoring();

    if (this.rafflePollInterval) {
      clearInterval(this.rafflePollInterval);
      this.rafflePollInterval = null;
    }

    logger.info('Buy detector stopped');
  }

  private async updateActiveRaffle(): Promise<void> {
    try {
      const raffle = await prisma.raffle.findFirst({
        where: {
          status: RAFFLE_STATUS.ACTIVE,
          startTime: { lte: new Date() },
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
          minimumPurchase: raffle.minimumPurchase,
          ticketsPerToken: raffle.ticketsPerToken
        };

        if (hasChanged) {
          logger.info(`Active raffle found: ${raffle.id}, monitoring CA: ${raffle.ca} via on-chain transfers`);
          await this.startOnChainMonitoring(true);
        } else if (!this.onChainPollInterval) {
          await this.startOnChainMonitoring(false);
        }
      } else {
        if (this.activeRaffle) {
          logger.info('No active raffle found, stopping on-chain monitoring');
        } else {
          logger.debug('No active raffle found');
        }
        this.activeRaffle = null;
        this.stopOnChainMonitoring();
      }
    } catch (error) {
      logger.error('Error checking for active raffle:', error);
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

    const blockberryClient = getBlockberryClient();
    this.useBlockberry = blockberryClient.isConfigured();

    this.processedEventIds.clear();
    this.decimalsCache.clear();
    this.lastProcessedTimestamp = 0;
    this.initialized = false;
    this.blockberryCursor = null;

    await this.pollOnChainTransfers(true);
    this.initialized = true;

    const pollIntervalMs = this.useBlockberry
      ? Number(process.env.BLOCKBERRY_POLL_INTERVAL_MS || '10000')
      : 10000;

    this.onChainPollInterval = setInterval(async () => {
      try {
        await this.pollOnChainTransfers(false);
      } catch (error) {
        logger.error('Error polling on-chain transfer events:', error);
      }
    }, pollIntervalMs);

    const mode = this.useBlockberry ? 'Blockberry API' : 'on-chain event stream';
    logger.info(`Buy monitoring started for token: ${this.activeRaffle.ca} via ${mode}`);
  }

  private stopOnChainMonitoring(): void {
    if (this.onChainPollInterval) {
      clearInterval(this.onChainPollInterval);
      this.onChainPollInterval = null;
      logger.info('Buy monitoring stopped');
    }

    this.processedEventIds.clear();
    this.lastProcessedTimestamp = 0;
    this.initialized = false;
    this.blockberryCursor = null;
  }

  private startRafflePolling(): void {
    if (this.rafflePollInterval) {
      return;
    }

    this.rafflePollInterval = setInterval(async () => {
      try {
        await this.updateActiveRaffle();
      } catch (error) {
        logger.error('Error in buy detector polling:', error);
      }
    }, 30000);
  }

  private async pollOnChainTransfers(initial: boolean): Promise<void> {
    if (!this.activeRaffle) {
      return;
    }

    // If Blockberry is configured and not in fallback mode, try it first
    if (this.useBlockberry && !this.blockberryFallbackActive) {
      try {
        await this.pollBlockberryTrades(initial);
        // Reset failure count on success
        this.blockberryFailureCount = 0;
        return;
      } catch (error) {
        this.blockberryFailureCount++;
        logger.error(`Blockberry attempt ${this.blockberryFailureCount}/3 failed:`, error);
        
        // After 3 consecutive failures, fall back to native SUI events
        if (this.blockberryFailureCount >= 3) {
          logger.warn('⚠️ Blockberry has failed 3 times, falling back to native SUI event stream for reliability');
          this.blockberryFallbackActive = true;
          this.processedEventIds.clear();
          this.lastProcessedTimestamp = 0;
        } else {
          // Don't continue to native method yet, wait for next poll
          return;
        }
      }
    }

    // If in fallback mode, occasionally retry Blockberry to see if it recovered
    if (this.blockberryFallbackActive && Math.random() < 0.1) { // 10% chance each poll
      try {
        await this.pollBlockberryTrades(true); // Test with initial=true
        logger.info('✅ Blockberry has recovered! Switching back to Blockberry API');
        this.blockberryFallbackActive = false;
        this.blockberryFailureCount = 0;
        return;
      } catch (error) {
        logger.debug('Blockberry still unavailable, continuing with native SUI events');
      }
    }

    // Use native SUI event stream (either as primary or fallback)
    const client = getSuiClient();
    const coinType = this.activeRaffle.ca;
    const transferEventType = `0x2::coin::TransferEvent<${coinType}>`;

    try {
      const events = await client.queryEvents({
        query: {
          MoveEventType: transferEventType,
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

        this.lastProcessedTimestamp = latestTimestamp || Date.now();

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
        if (!eventKey) {
          continue;
        }

        const timestamp = parseInt(event.timestampMs || '0', 10) || Date.now();

        if (this.processedEventIds.has(eventKey)) {
          continue;
        }

        if (this.initialized && timestamp <= this.lastProcessedTimestamp) {
          continue;
        }

        const parsed = (event.parsedJson as Record<string, any>) ?? {};
        const recipient = this.extractRecipient(parsed);
        const amountRaw = this.extractAmount(parsed);

        if (!recipient || !amountRaw) {
          logger.debug('Skipping transfer event without recipient or amount', { eventKey });
          this.processedEventIds.add(eventKey);
          continue;
        }

        // Check if this transfer is from a DEX swap by inspecting the transaction
        const txDigest = event.id?.txDigest;
        if (txDigest) {
          const isDexSwap = await this.isTransferFromDexSwap(client, txDigest);
          if (!isDexSwap) {
            logger.debug('Skipping non-DEX transfer (wallet-to-wallet)', { txDigest, recipient });
            this.processedEventIds.add(eventKey);
            continue;
          }
        }

        const decimals = await this.getCoinDecimals(client, coinType);
        const tokenAmount = this.formatAmount(amountRaw, decimals);

        const buyEvent: BuyEventData = {
          walletAddress: String(recipient),
          tokenAmount,
          transactionHash: event.id?.txDigest || `transfer_${Date.now()}`,
          timestamp: new Date(timestamp),
        };

        await this.processBuyEvent(buyEvent);

        this.processedEventIds.add(eventKey);
        this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, timestamp);
      }

      this.compactProcessedEvents();
    } catch (error) {
      if (initial) {
        this.lastProcessedTimestamp = Date.now();
      }
      logger.error('Failed to query on-chain transfer events:', error);
    }
  }

  private async pollBlockberryTrades(initial: boolean): Promise<void> {
    if (!this.activeRaffle) {
      return;
    }

    const client = getBlockberryClient();
    if (!client.isConfigured()) {
      if (!this.initialized) {
        logger.warn('Blockberry API not configured; skipping buy monitoring');
      }
      return;
    }

    const tokenAddress = this.activeRaffle.ca;

    try {
      const response = await client.fetchTrades(tokenAddress, {
        limit: Number(process.env.BLOCKBERRY_POLL_LIMIT || '100'),
        cursor: initial ? null : this.blockberryCursor,
        sortOrder: 'desc',
      });

      const rawTrades = response.data ?? [];
      if (rawTrades.length === 0) {
        const nextCursor = client.extractNextCursor(response);
        if (nextCursor) {
          this.blockberryCursor = nextCursor;
        }
        if (initial) {
          this.lastProcessedTimestamp = Date.now();
        }
        return;
      }

      const normalizedTrades = this.normalizeBlockberryTrades(rawTrades, tokenAddress);

      if (normalizedTrades.length === 0) {
        const nextCursor = client.extractNextCursor(response);
        if (nextCursor) {
          this.blockberryCursor = nextCursor;
        }
        if (initial) {
          this.lastProcessedTimestamp = Date.now();
        }
        return;
      }

      if (initial) {
        const latestTimestamp = normalizedTrades.reduce((max, trade) => Math.max(max, trade.timestamp), 0);
        this.lastProcessedTimestamp = latestTimestamp || Date.now();
        for (const trade of normalizedTrades) {
          this.processedEventIds.add(trade.eventKey);
        }
        this.blockberryCursor = client.extractNextCursor(response) ?? this.blockberryCursor;
        return;
      }

      const orderedTrades = [...normalizedTrades].sort((a, b) => a.timestamp - b.timestamp);
      let suiClient: SuiClient | null = null;

      for (const trade of orderedTrades) {
        if (this.processedEventIds.has(trade.eventKey)) {
          continue;
        }

        if (this.initialized && trade.timestamp <= this.lastProcessedTimestamp) {
          this.processedEventIds.add(trade.eventKey);
          continue;
        }

        let decimals = trade.decimals;
        if (decimals === undefined) {
          if (!suiClient) {
            suiClient = getSuiClient();
          }
          decimals = await this.getCoinDecimals(suiClient, trade.coinType);
        }

        // Validate that this is actually a DEX swap, not a simple transfer
        if (!suiClient) {
          suiClient = getSuiClient();
        }
        const isDexSwap = await this.isTransferFromDexSwap(suiClient, trade.txDigest);
        if (!isDexSwap) {
          logger.debug('Blockberry trade is actually a wallet transfer, skipping', { 
            txDigest: trade.txDigest, 
            wallet: trade.walletAddress 
          });
          this.processedEventIds.add(trade.eventKey);
          continue;
        }

        const tokenAmount = this.formatAmount(trade.amountRaw, decimals);

        const buyEvent: BuyEventData = {
          walletAddress: trade.walletAddress,
          tokenAmount,
          transactionHash: trade.txDigest,
          timestamp: new Date(trade.timestamp),
          rawAmount: trade.amountRaw,
          decimals,
        };

        await this.processBuyEvent(buyEvent);

        this.processedEventIds.add(trade.eventKey);
        this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, trade.timestamp);
      }

      const nextCursor = client.extractNextCursor(response);
      if (nextCursor) {
        this.blockberryCursor = nextCursor;
      }

      this.compactProcessedEvents();
    } catch (error) {
      if (initial) {
        this.lastProcessedTimestamp = Date.now();
      }
      logger.error('Failed to query Blockberry trades:', error);
      // Re-throw to trigger fallback mechanism
      throw error;
    }
  }

  private normalizeBlockberryTrades(
    trades: BlockberryRawTrade[],
    targetCoin: string
  ): NormalizedBlockberryTrade[] {
    const normalizedTarget = targetCoin.trim().toLowerCase();
    const results: NormalizedBlockberryTrade[] = [];

    trades.forEach((trade, index) => {
      try {
        const txDigest = this.pickString(trade, [
          'txDigest',
          'transactionDigest',
          'digest',
          'tx_hash',
          'txHash',
          'transactionHash',
          'transaction_block',
          'transactionBlock',
        ]);

        if (!txDigest) {
          logger.debug('Blockberry trade missing tx digest', trade);
          return;
        }

        const timestampCandidate = this.pickString(trade, [
          'timestampMs',
          'timestamp',
          'time',
          'executedAt',
          'executed_at',
          'blockTimestamp',
          'checkpointTimestampMs',
          'createdAt',
          'created_at',
        ]);

        const timestampFallback = this.pickNumber(trade, [
          'timestamp',
          'timestampMs',
          'checkpointTimestampMs',
          'created_at',
          'createdAt',
        ]);

        const timestamp = this.parseTimestamp(timestampCandidate ?? timestampFallback ?? Date.now());

        const balanceChanges = this.getNestedValue(trade, 'balanceChanges');
        if (Array.isArray(balanceChanges) && balanceChanges.length > 0) {
          let producedFromBalance = false;

          balanceChanges.forEach((change: any, changeIndex: number) => {
            if (!change || typeof change !== 'object') {
              return;
            }

            const changeCoinType = this.pickString(change, ['coinType']);
            if (!changeCoinType || changeCoinType.trim().toLowerCase() !== normalizedTarget) {
              return;
            }

            const amountCandidate = this.pickString(change, ['amount']);
            if (!amountCandidate) {
              return;
            }

            let amountBigInt: bigint;
            try {
              amountBigInt = BigInt(amountCandidate);
            } catch {
              logger.debug('Blockberry balance change has non-numeric amount', {
                amountCandidate,
              });
              return;
            }

            if (amountBigInt <= 0n) {
              return;
            }

            const walletAddressFromChange = this.pickString(change, [
              'owner.addressOwner',
              'ownerAddress',
              'addressOwner',
            ]);

            if (!walletAddressFromChange) {
              logger.debug('Blockberry balance change missing wallet address', change);
              return;
            }

            const decimalsFromChange = this.pickNumber(change, ['decimals']);
            const eventKey = `${txDigest}:${walletAddressFromChange}:${changeIndex}`;

            results.push({
              txDigest,
              eventKey,
              timestamp,
              walletAddress: walletAddressFromChange,
              amountRaw: amountBigInt.toString(),
              coinType: changeCoinType,
              decimals: decimalsFromChange,
            });

            producedFromBalance = true;
          });

          if (producedFromBalance) {
            return;
          }
        }

        const directionRaw = this.pickString(trade, [
          'direction',
          'side',
          'tradeSide',
          'swapSide',
          'orderSide',
        ]);
        const direction = directionRaw?.toLowerCase();

        const coinOutType = this.pickString(trade, [
          'outCoin.coinType',
          'outCoin.type',
          'coinTypeOut',
          'coin_type_out',
          'tokenOut.coinType',
          'tokenOutType',
          'coinOut.coin_type',
          'coinsOut.0.coinType',
          'coins_out.0.coin_type',
          'coins.0.coinType',
          'balanceChanges.0.coinType',
        ]);

        const coinInType = this.pickString(trade, [
          'inCoin.coinType',
          'inCoin.type',
          'coinTypeIn',
          'coin_type_in',
          'tokenIn.coinType',
          'tokenInType',
          'coinIn.coin_type',
          'coinsIn.0.coinType',
          'coins_in.0.coin_type',
          'coins.1.coinType',
        ]);

        const normalizedOut = coinOutType?.toLowerCase();
        const normalizedIn = coinInType?.toLowerCase();

        let isBuy = false;
        if (direction === 'buy') {
          isBuy = true;
        } else if (direction === 'sell') {
          isBuy = false;
        } else if (normalizedOut && normalizedOut === normalizedTarget) {
          isBuy = true;
        } else if (normalizedIn && normalizedIn === normalizedTarget) {
          isBuy = false;
        } else if (normalizedOut?.includes(normalizedTarget)) {
          isBuy = true;
        } else if (normalizedIn?.includes(normalizedTarget)) {
          isBuy = false;
        } else {
          return;
        }

        if (!isBuy) {
          return;
        }

        const walletAddress = this.pickString(trade, [
          'buyerAddress',
          'buyer',
          'accountAddress',
          'walletAddress',
          'traderAddress',
          'trader',
          'recipientAddress',
          'toAddress',
          'owner',
          'userAddress',
          'address',
          'ownerAddress',
          'owner.addressOwner',
        ]);

        if (!walletAddress) {
          logger.debug('Blockberry trade missing wallet address', trade);
          return;
        }

        const amountRaw = this.pickString(trade, [
          'outCoin.amount',
          'outCoin.amount_raw',
          'amountOut',
          'amount_out',
          'tokenOutAmount',
          'outAmount',
          'amount',
          'receivedAmount',
          'amountReceived',
          'coin.amount',
          'coinsOut.0.amount',
          'coins_out.0.amount_raw',
          'coins.0.amount',
          'balanceChanges.0.amount',
        ]);

        if (!amountRaw) {
          logger.debug('Blockberry trade missing amount', trade);
          return;
        }

        const decimals = this.pickNumber(trade, [
          'outCoin.decimals',
          'coin.decimals',
          'decimals',
          'tokenOutDecimals',
          'decimalsOut',
          'coinsOut.0.decimals',
          'coins_out.0.decimals',
          'coins.0.decimals',
        ]);

        const eventSeqCandidate = this.pickString(trade, [
          'eventSeq',
          'eventIndex',
          'event_index',
          'seq',
          'sequence',
          'swapIndex',
          'swap_index',
          'id',
        ]) ?? this.pickNumber(trade, [
          'eventSeq',
          'eventIndex',
          'event_index',
          'seq',
          'sequence',
          'swapIndex',
          'swap_index',
          'id',
        ])?.toString();

        const eventKey = `${txDigest}:${eventSeqCandidate ?? `${timestamp}:${index}`}`;

        results.push({
          txDigest,
          eventKey,
          timestamp,
          walletAddress,
          amountRaw,
          coinType: coinOutType || targetCoin,
          decimals,
        });
      } catch (error) {
        logger.debug('Failed to normalize Blockberry trade', error);
      }
    });

    return results;
  }

  private getNestedValue(source: Record<string, any>, path: string): any {
    if (!source) {
      return undefined;
    }

    if (!path.includes('.')) {
      return source?.[path];
    }

    return path.split('.').reduce((value: any, key) => {
      if (value === undefined || value === null) {
        return undefined;
      }
      return value?.[key];
    }, source);
  }

  private pickString(source: Record<string, any>, paths: string[]): string | null {
    for (const path of paths) {
      const value = this.getNestedValue(source, path);
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          continue;
        }
        return trimmed;
      }

      if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
      }
    }

    return null;
  }

  private pickNumber(source: Record<string, any>, paths: string[]): number | undefined {
    for (const path of paths) {
      const value = this.getNestedValue(source, path);
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === 'number') {
        if (!Number.isNaN(value)) {
          return value;
        }
      }

      if (typeof value === 'string' || typeof value === 'bigint') {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
      }
    }

    return undefined;
  }

  private parseTimestamp(value: unknown): number {
    if (value === null || value === undefined) {
      return Date.now();
    }

    let numeric: number | null = null;

    if (typeof value === 'number') {
      numeric = value;
    } else if (typeof value === 'bigint') {
      numeric = Number(value);
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return Date.now();
      }

      if (/^\d+$/u.test(trimmed)) {
        numeric = Number(trimmed);
      } else {
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed)) {
          numeric = parsed;
        }
      }
    }

    if (numeric === null || Number.isNaN(numeric)) {
      return Date.now();
    }

    if (numeric > 1e15) {
      return numeric;
    }

    if (numeric < 1e12) {
      return numeric * 1000;
    }

    return numeric;
  }

  private calculateTicketCount(data: BuyEventData): number {
    try {
      // Get the tickets per token ratio for this raffle
      const ticketsPerToken = this.activeRaffle?.ticketsPerToken 
        ? parseFloat(this.activeRaffle.ticketsPerToken) 
        : DEFAULT_TICKETS_PER_TOKEN;

      // Check minimum purchase requirement
      if (this.activeRaffle?.minimumPurchase) {
        const minimumRequired = parseFloat(this.activeRaffle.minimumPurchase);
        
        // Use rawAmount for comparison if available (more accurate)
        let purchaseAmount: number;
        if (data.rawAmount && data.decimals !== undefined) {
          const rawBigInt = BigInt(data.rawAmount);
          const scale = BigInt(10) ** BigInt(data.decimals);
          purchaseAmount = Number(rawBigInt) / Number(scale);
        } else {
          purchaseAmount = parseFloat(data.tokenAmount);
        }
        
        if (!isNaN(minimumRequired) && !isNaN(purchaseAmount) && purchaseAmount < minimumRequired) {
          logger.info(`Purchase ${purchaseAmount} tokens is below minimum ${minimumRequired} tokens, no tickets awarded`, {
            wallet: data.walletAddress,
            txHash: data.transactionHash,
          });
          return 0;
        }
      }

      if (data.rawAmount && data.decimals !== undefined) {
        const amount = BigInt(data.rawAmount);
        const scale = BigInt(10) ** BigInt(data.decimals);
        if (scale === 0n) {
          return 0;
        }

        // Convert ticketsPerToken to a ratio we can use with BigInt
        // For very small ratios (e.g., 0.0002 = 1 ticket per 5000 tokens), we need precision
        const PRECISION = 1000000; // 6 decimal places of precision
        const ratio = Math.floor(ticketsPerToken * PRECISION);
        const ratioBig = BigInt(ratio);
        const precisionBig = BigInt(PRECISION);

        const ticketsBig = (amount * ratioBig) / (scale * precisionBig);

        if (ticketsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
          logger.warn('Calculated ticket count exceeds safe integer range', {
            tickets: ticketsBig.toString(),
            wallet: data.walletAddress,
          });
          return Number.MAX_SAFE_INTEGER;
        }

        return Number(ticketsBig);
      }

      const asFloat = Number.parseFloat(data.tokenAmount);
      if (Number.isNaN(asFloat)) {
        return 0;
      }
      return Math.floor(asFloat * ticketsPerToken);
    } catch (error) {
      logger.warn('Falling back to float-based ticket calculation', error);
      const ticketsPerToken = this.activeRaffle?.ticketsPerToken 
        ? parseFloat(this.activeRaffle.ticketsPerToken) 
        : DEFAULT_TICKETS_PER_TOKEN;
      const asFloat = Number.parseFloat(data.tokenAmount);
      if (Number.isNaN(asFloat)) {
        return 0;
      }
      return Math.floor(asFloat * ticketsPerToken);
    }
  }

  private compactProcessedEvents(): void {
    if (this.processedEventIds.size <= 200) {
      return;
    }

    const recent = Array.from(this.processedEventIds).slice(-100);
    this.processedEventIds = new Set(recent);
  }

  private getEventKey(event: any): string | null {
    const txDigest = event.id?.txDigest;
    const seq = event.id?.eventSeq;
    if (!txDigest || typeof seq === 'undefined') {
      return null;
    }

    return `${txDigest}:${seq}`;
  }

  /**
   * Check if a transfer came from a DEX swap by inspecting the transaction
   * Returns true if the transaction contains calls to known DEX packages
   */
  private async isTransferFromDexSwap(client: SuiClient, txDigest: string): Promise<boolean> {
    try {
      const txResponse = await client.getTransactionBlock({
        digest: txDigest,
        options: {
          showInput: true,
          showEffects: true,
        },
      });

      if (!txResponse || !txResponse.transaction) {
        return false;
      }

      const txData = txResponse.transaction.data;
      if (!txData || txData.transaction.kind !== 'ProgrammableTransaction') {
        return false;
      }

      const programmableTx = txData.transaction;
      if (!programmableTx.transactions || programmableTx.transactions.length === 0) {
        return false;
      }

      // Known DEX package prefixes on SUI
      const dexPackages = [
        '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb', // Cetus
        '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1', // Turbos
        '0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66', // Kriya
        '0xdee9', // DeepBook
      ];

      // Check all transactions in the programmable transaction
      let hasMoveCalls = false;
      let isDexSwap = false;

      for (const tx of programmableTx.transactions) {
        // Check for simple transfers (TransferObjects) - these are wallet-to-wallet
        if ('TransferObjects' in tx) {
          logger.debug('Transaction contains TransferObjects (likely wallet-to-wallet)', { txDigest });
          // Don't immediately reject - there could be other calls
          continue;
        }

        // Type assertion since MoveCall isn't in the union type but exists at runtime
        if ('MoveCall' in tx) {
          hasMoveCalls = true;
          const moveCall = (tx as any).MoveCall;
          const packageId = moveCall.package;
          
          // Check if this is a call to a DEX package
          // Most DEX swaps will have "swap" in the function name
          const functionName = moveCall.function?.toLowerCase() || '';
          const isSwapFunction = functionName.includes('swap') || 
                                functionName.includes('trade') || 
                                functionName.includes('exchange');

          if (isSwapFunction) {
            logger.debug('Transfer is from DEX swap', { txDigest, function: moveCall.function });
            isDexSwap = true;
            break;
          }

          // Also check if package is a known DEX (even without "swap" in function name)
          for (const dexPkg of dexPackages) {
            if (packageId.startsWith(dexPkg)) {
              logger.debug('Transfer is from known DEX package', { txDigest, package: packageId });
              isDexSwap = true;
              break;
            }
          }

          if (isDexSwap) break;
        }
      }

      // If we found DEX swap indicators, it's a buy
      if (isDexSwap) {
        return true;
      }

      // If there are no MoveCall transactions, it's likely a simple transfer
      if (!hasMoveCalls) {
        logger.debug('No MoveCall found - simple wallet transfer detected', { txDigest });
        return false;
      }

      // Has MoveCall but not to a DEX - likely not a swap
      logger.debug('No DEX swap detected in transaction', { txDigest });
      return false;
    } catch (error) {
      logger.error('Error checking if transfer is from DEX swap:', error);
      // On error, be conservative and reject the transfer
      // This prevents wallet-to-wallet transfers from sneaking through
      return false;
    }
  }

  private extractRecipient(data: Record<string, any>): string | null {
    const candidateKeys = [
      'recipient',
      'to',
      'toAddress',
      'to_addr',
      'to_address',
      'dst_addr',
      'receiver',
    ];

    for (const key of candidateKeys) {
      if (data[key]) {
        return String(data[key]);
      }
    }

    if (data.fields && typeof data.fields === 'object') {
      return this.extractRecipient(data.fields as Record<string, any>);
    }

    return null;
  }

  private extractAmount(data: Record<string, any>): string | null {
    const candidateKeys = ['amount', 'quantity', 'value', 'coinAmount'];

    for (const key of candidateKeys) {
      if (data[key] !== undefined && data[key] !== null) {
        return String(data[key]);
      }
    }

    if (data.fields && typeof data.fields === 'object') {
      return this.extractAmount(data.fields as Record<string, any>);
    }

    return null;
  }

  private async getCoinDecimals(client: SuiClient, coinType: string): Promise<number> {
    if (this.decimalsCache.has(coinType)) {
      return this.decimalsCache.get(coinType)!;
    }

    try {
      const metadata = await client.getCoinMetadata({ coinType });
      const decimals = metadata?.decimals ?? 9;
      this.decimalsCache.set(coinType, decimals);
      return decimals;
    } catch (error) {
      logger.warn(`Failed to fetch coin metadata for ${coinType}, defaulting decimals to 9`, error);
      this.decimalsCache.set(coinType, 9);
      return 9;
    }
  }

  private formatAmount(rawAmount: string, decimals: number): string {
    try {
      const raw = BigInt(rawAmount);
      if (decimals === 0) {
        return raw.toString();
      }
      const divisor = BigInt(10) ** BigInt(decimals);
      const whole = raw / divisor;
      const remainder = raw % divisor;
      if (remainder === 0n) {
        return whole.toString();
      }
      const fraction = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
      return `${whole.toString()}.${fraction}`;
    } catch (error) {
      logger.warn('Failed to format amount, returning raw value', error);
      return rawAmount;
    }
  }

  async processBuyEvent(data: BuyEventData): Promise<void> {
    if (!this.activeRaffle) {
      logger.warn('No active raffle, skipping buy event');
      return;
    }

    try {
      const existing = await prisma.buyEvent.findUnique({
        where: { transactionHash: data.transactionHash },
      });

      if (existing) {
        logger.debug(`Transaction ${data.transactionHash} already processed`);
        return;
      }

      const ticketCount = this.calculateTicketCount(data);

      const buyEvent = await prisma.buyEvent.create({
        data: {
          raffleId: this.activeRaffle.id,
          walletAddress: data.walletAddress,
          tokenAmount: data.tokenAmount,
          ticketCount,
          transactionHash: data.transactionHash,
          timestamp: data.timestamp,
          processed: false,
        },
      });

      const queue = getBuyEventsQueue();
      await queue.add('allocate-tickets', {
        buyEventId: buyEvent.id,
        raffleId: buyEvent.raffleId,
        walletAddress: buyEvent.walletAddress,
        ticketCount: buyEvent.ticketCount,
      });

      logger.info(`Buy event queued: ${buyEvent.id}, ${buyEvent.ticketCount} tickets`);

      await this.broadcastBuyNotification(buyEvent, data);
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
        logger.debug(`New wallet detected: ${walletAddress} (not linked to Telegram user)`);
      }
    } catch (error) {
      logger.error('Error auto-linking wallet:', error);
    }
  }

  private async broadcastBuyNotification(buyEvent: any, data: BuyEventData): Promise<void> {
    try {
      // Only broadcast if tickets were actually earned (meets minimum purchase)
      if (buyEvent.ticketCount === 0) {
        logger.debug(`No tickets earned for this purchase, skipping broadcast notification`);
        return;
      }

      const broadcastChannelId = process.env.BROADCAST_CHANNEL_ID;
      if (!broadcastChannelId) {
        logger.debug('No BROADCAST_CHANNEL_ID configured, skipping broadcast');
        return;
      }

      const raffle = await prisma.raffle.findUnique({
        where: { id: buyEvent.raffleId },
      });

      if (!raffle) {
        return;
      }

      const shortWallet = `${data.walletAddress.slice(0, 6)}...${data.walletAddress.slice(-4)}`;

      const minimumText = raffle.minimumPurchase 
        ? `\n💎 Minimum Purchase: \`${raffle.minimumPurchase}\` tokens` 
        : '';

      // Calculate countdown
      const countdown = getCountdownText(raffle.endTime);

      // Get the dynamic tickets per token ratio
      const ticketsPerTokenRatio = raffle.ticketsPerToken 
        ? parseFloat(raffle.ticketsPerToken) 
        : 100;

      const message =
        `🎉 *NEW BUY DETECTED!* 🎉\n\n` +
        `💰 Amount: \`${data.tokenAmount}\` tokens\n` +
        `🎟️ Tickets Earned: \`${buyEvent.ticketCount}\`\n` +
        `👛 Wallet: \`${shortWallet}\`\n` +
        `🔗 Source: \`On-chain\`\n\n` +
        `🏆 Prize Pool: \`${raffle.prizeAmount} ${raffle.prizeType}\`\n` +
        `${countdown}\n` +
        `📅 Ends: ${formatDate(raffle.endTime)} UTC${minimumText}\n\n` +
        `_Every 1 token purchased = ${ticketsPerTokenRatio} raffle tickets!_`;

      // Use notification media if available, otherwise fall back to old media fields
      const mediaUrl = raffle.notificationMediaUrl || raffle.mediaUrl;
      const mediaType = raffle.notificationMediaType || raffle.mediaType;

      if (mediaUrl && mediaType) {
        if (mediaType === 'image') {
          try {
            await bot.sendPhoto(broadcastChannelId, mediaUrl, {
              caption: message,
              parse_mode: 'Markdown',
            });
          } catch (photoError: any) {
            if (photoError?.message?.includes('Document as Photo')) {
              logger.warn('Photo is actually a document, sending as document instead');
              await bot.sendDocument(broadcastChannelId, mediaUrl, {
                caption: message,
                parse_mode: 'Markdown',
              });
            } else {
              throw photoError;
            }
          }
        } else if (mediaType === 'video') {
          try {
            await bot.sendVideo(broadcastChannelId, mediaUrl, {
              caption: message,
              parse_mode: 'Markdown',
            });
          } catch (videoError: any) {
            if (videoError?.message?.includes('Document as Video')) {
              logger.warn('Video is actually a document, sending as document instead');
              await bot.sendDocument(broadcastChannelId, mediaUrl, {
                caption: message,
                parse_mode: 'Markdown',
              });
            } else {
              throw videoError;
            }
          }
        } else if (mediaType === 'gif') {
          await bot.sendAnimation(broadcastChannelId, mediaUrl, {
            caption: message,
            parse_mode: 'Markdown',
          });
        }
      } else {
        await bot.sendMessage(broadcastChannelId, message, {
          parse_mode: 'Markdown',
        });
      }

      logger.info(`?? Broadcast buy notification sent to channel ${broadcastChannelId}`);
    } catch (error) {
      logger.error('Error broadcasting buy notification:', error);
    }
  }
}

export const buyDetector = new BuyDetector();
