import { SuiClient } from '@mysten/sui.js/client';
import { Queue } from 'bullmq';
import { getSuiClient } from './sui-client';
import { getBlockberryClient, BlockberryRawTrade } from './blockberry-client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS, DEFAULT_TICKETS_PER_TOKEN } from '../utils/constants';
import { getRedisClient } from '../utils/redis';

export const SELL_EVENTS_QUEUE = 'sell-events';

let sellEventsQueue: Queue | null = null;

export function getSellEventsQueue(): Queue {
  if (!sellEventsQueue) {
    sellEventsQueue = new Queue(SELL_EVENTS_QUEUE, {
      connection: getRedisClient(),
    });
  }
  return sellEventsQueue;
}

interface SellEventData {
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

export class SellDetector {
  private activeRaffle: { id: string; ca: string; ticketsPerToken?: string | null } | null = null;
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
    logger.info('Starting sell detector...');
    await this.updateActiveRaffle();
    this.startRafflePolling();
  }

  async stop(): Promise<void> {
    this.stopOnChainMonitoring();

    if (this.rafflePollInterval) {
      clearInterval(this.rafflePollInterval);
      this.rafflePollInterval = null;
    }

    logger.info('Sell detector stopped');
  }

  private async updateActiveRaffle(): Promise<void> {
    try {
      const raffle = await prisma.raffle.findFirst({
        where: {
          status: RAFFLE_STATUS.ACTIVE,
          started: true, // Only track if manually started
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
          ticketsPerToken: raffle.ticketsPerToken
        };

        if (hasChanged) {
          logger.info(`Active raffle found: ${raffle.id}, monitoring sells for CA: ${raffle.ca}`);
          await this.startOnChainMonitoring(true);
        } else if (!this.onChainPollInterval) {
          await this.startOnChainMonitoring(false);
        }
      } else {
        if (this.activeRaffle) {
          logger.info('No active raffle found, stopping sell monitoring');
        }
        this.activeRaffle = null;
        this.stopOnChainMonitoring();
      }
    } catch (error) {
      logger.error('Error checking for active raffle in sell detector:', error);
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
        logger.error('Error polling sell events:', error);
      }
    }, pollIntervalMs);

    const mode = this.useBlockberry ? 'Blockberry API' : 'on-chain event stream';
    logger.info(`Sell monitoring started for token: ${this.activeRaffle.ca} via ${mode}`);
  }

  private stopOnChainMonitoring(): void {
    if (this.onChainPollInterval) {
      clearInterval(this.onChainPollInterval);
      this.onChainPollInterval = null;
      logger.info('Sell monitoring stopped');
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
        logger.error('Error in sell detector polling:', error);
      }
    }, 30000);
  }

  private async pollOnChainTransfers(initial: boolean): Promise<void> {
    if (!this.activeRaffle) {
      return;
    }

    if (this.useBlockberry && !this.blockberryFallbackActive) {
      try {
        await this.pollBlockberryTrades(initial);
        this.blockberryFailureCount = 0;
        return;
      } catch (error) {
        this.blockberryFailureCount++;
        logger.error(`Blockberry sell poll attempt ${this.blockberryFailureCount}/3 failed:`, error);

        if (this.blockberryFailureCount >= 3) {
          logger.warn('⚠️ Blockberry has failed 3 times, falling back to native SUI event stream for sells');
          this.blockberryFallbackActive = true;
          this.processedEventIds.clear();
          this.lastProcessedTimestamp = 0;
        } else {
          return;
        }
      }
    }

    if (this.blockberryFallbackActive && Math.random() < 0.1) {
      try {
        await this.pollBlockberryTrades(true);
        logger.info('✅ Blockberry has recovered! Switching back to Blockberry API for sells');
        this.blockberryFallbackActive = false;
        this.blockberryFailureCount = 0;
        return;
      } catch (error) {
        logger.debug('Blockberry still unavailable for sells, continuing with native SUI events');
      }
    }

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
        if (!eventKey) continue;

        const timestamp = parseInt(event.timestampMs || '0', 10) || Date.now();

        if (this.processedEventIds.has(eventKey)) continue;
        if (this.initialized && timestamp <= this.lastProcessedTimestamp) continue;

        const parsed = (event.parsedJson as Record<string, any>) ?? {};

        const txDigest = event.id?.txDigest;
        if (!txDigest) {
          this.processedEventIds.add(eventKey);
          continue;
        }

        // Removed DEX check to capture ALL outgoing transfers (robustness)
        // const isDexSwap = await this.isTransferFromDexSwap(client, txDigest);
        // if (!isDexSwap) { ... }

        const sender = await this.getTransactionSender(client, txDigest);
        if (!sender) {
          this.processedEventIds.add(eventKey);
          continue;
        }

        // Check for self-transfer (consolidating coins)
        const recipient = this.extractRecipient(parsed);
        if (recipient && recipient === sender) {
          this.processedEventIds.add(eventKey);
          continue;
        }

        const amountRaw = this.extractAmount(parsed);
        if (!amountRaw) {
          this.processedEventIds.add(eventKey);
          continue;
        }

        const decimals = await this.getCoinDecimals(client, coinType);
        const tokenAmount = this.formatAmount(amountRaw, decimals);

        // Use composite key for transactionHash to handle multiple transfers in one tx
        const uniqueTransactionKey = `${txDigest}:${event.id?.eventSeq}`;

        const sellEvent: SellEventData = {
          walletAddress: sender,
          tokenAmount,
          transactionHash: uniqueTransactionKey,
          timestamp: new Date(timestamp),
          rawAmount: amountRaw,
          decimals,
        };

        await this.processSellEvent(sellEvent);

        this.processedEventIds.add(eventKey);
        this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, timestamp);
      }

      this.compactProcessedEvents();
    } catch (error) {
      if (initial) {
        this.lastProcessedTimestamp = Date.now();
      }
      logger.error('Failed to query on-chain sell events:', error);
    }
  }

  private async pollBlockberryTrades(initial: boolean): Promise<void> {
    if (!this.activeRaffle) return;

    const client = getBlockberryClient();
    if (!client.isConfigured()) return;

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
        if (nextCursor) this.blockberryCursor = nextCursor;
        if (initial) this.lastProcessedTimestamp = Date.now();
        return;
      }

      const normalizedTrades = this.normalizeBlockberryTrades(rawTrades, tokenAddress);

      if (normalizedTrades.length === 0) {
        const nextCursor = client.extractNextCursor(response);
        if (nextCursor) this.blockberryCursor = nextCursor;
        if (initial) this.lastProcessedTimestamp = Date.now();
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
        if (this.processedEventIds.has(trade.eventKey)) continue;
        if (this.initialized && trade.timestamp <= this.lastProcessedTimestamp) {
          this.processedEventIds.add(trade.eventKey);
          continue;
        }

        let decimals = trade.decimals;
        if (decimals === undefined) {
          if (!suiClient) suiClient = getSuiClient();
          decimals = await this.getCoinDecimals(suiClient, trade.coinType);
        }

        // Removed DEX check to capture ALL outgoing transfers
        // if (!suiClient) suiClient = getSuiClient();
        // const isDexSwap = await this.isTransferFromDexSwap(suiClient, trade.txDigest);
        // if (!isDexSwap) { ... }

        const tokenAmount = this.formatAmount(trade.amountRaw, decimals);

        // Use eventKey as transactionHash to ensure uniqueness per trade/event
        const sellEvent: SellEventData = {
          walletAddress: trade.walletAddress,
          tokenAmount,
          transactionHash: trade.eventKey,
          timestamp: new Date(trade.timestamp),
          rawAmount: trade.amountRaw,
          decimals,
        };

        await this.processSellEvent(sellEvent);

        this.processedEventIds.add(trade.eventKey);
        this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, trade.timestamp);
      }

      const nextCursor = client.extractNextCursor(response);
      if (nextCursor) this.blockberryCursor = nextCursor;

      this.compactProcessedEvents();
    } catch (error) {
      if (initial) this.lastProcessedTimestamp = Date.now();
      logger.error('Failed to query Blockberry sell trades:', error);
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
        const txDigest = this.pickString(trade, ['txDigest', 'transactionDigest', 'digest', 'tx_hash', 'txHash']);
        if (!txDigest) return;

        const timestampCandidate = this.pickString(trade, ['timestampMs', 'timestamp', 'time', 'executedAt']);
        const timestampFallback = this.pickNumber(trade, ['timestamp', 'timestampMs']);
        const timestamp = this.parseTimestamp(timestampCandidate ?? timestampFallback ?? Date.now());

        // Check direction
        const directionRaw = this.pickString(trade, ['direction', 'side', 'tradeSide']);
        const direction = directionRaw?.toLowerCase();

        const coinOutType = this.pickString(trade, ['outCoin.coinType', 'coinOut.coin_type', 'tokenOut.coinType']);
        const coinInType = this.pickString(trade, ['inCoin.coinType', 'coinIn.coin_type', 'tokenIn.coinType']);

        const normalizedOut = coinOutType?.toLowerCase();
        const normalizedIn = coinInType?.toLowerCase();

        let isSell = false;
        if (direction === 'sell') {
          isSell = true;
        } else if (direction === 'buy') {
          isSell = false;
        } else if (normalizedIn && normalizedIn === normalizedTarget) {
          // If Input is Target, I am giving Target, so I am Selling
          isSell = true;
        } else if (normalizedOut && normalizedOut === normalizedTarget) {
          // If Output is Target, I am receiving Target, so I am Buying
          isSell = false;
        } else if (normalizedIn?.includes(normalizedTarget)) {
          isSell = true;
        }

        if (!isSell) return;

        const walletAddress = this.pickString(trade, ['buyerAddress', 'senderAddress', 'address', 'owner', 'walletAddress']);
        if (!walletAddress) return;

        let amountRaw: string | null = null;
        let decimals: number | undefined = undefined;

        if (normalizedIn === normalizedTarget) {
          amountRaw = this.pickString(trade, ['inCoin.amount', 'amountIn', 'tokenInAmount', 'amount']);
          decimals = this.pickNumber(trade, ['inCoin.decimals', 'decimalsIn', 'tokenInDecimals']);
        } else {
          amountRaw = this.pickString(trade, ['amount']);
        }

        if (!amountRaw) return;

        const eventKey = `${txDigest}:${timestamp}:${index}`;

        results.push({
          txDigest,
          eventKey,
          timestamp,
          walletAddress,
          amountRaw,
          coinType: coinInType || targetCoin,
          decimals,
        });
      } catch (error) {
        logger.debug('Failed to normalize Blockberry sell trade', error);
      }
    });

    return results;
  }

  private async getTransactionSender(client: SuiClient, txDigest: string): Promise<string | null> {
    try {
      const tx = await client.getTransactionBlock({
        digest: txDigest,
        options: { showInput: true }
      });
      return tx.transaction?.data.sender ?? null;
    } catch (e) {
      return null;
    }
  }

  private async processSellEvent(data: SellEventData): Promise<void> {
    if (!this.activeRaffle) return;

    try {
      const existing = await prisma.sellEvent.findUnique({
        where: { transactionHash: data.transactionHash },
      });

      if (existing) return;

      const ticketsRemoved = this.calculateTicketRemoval(data);

      const sellEvent = await prisma.sellEvent.create({
        data: {
          raffleId: this.activeRaffle.id,
          walletAddress: data.walletAddress,
          tokenAmount: data.tokenAmount,
          ticketsRemoved,
          transactionHash: data.transactionHash,
          timestamp: data.timestamp,
          processed: false,
        },
      });

      const queue = getSellEventsQueue();
      await queue.add('remove-tickets', {
        sellEventId: sellEvent.id,
        raffleId: sellEvent.raffleId,
        walletAddress: sellEvent.walletAddress,
        ticketsRemoved: sellEvent.ticketsRemoved,
      });

      logger.info(`Sell event queued: ${sellEvent.id}, -${sellEvent.ticketsRemoved} tickets`);
    } catch (error) {
      logger.error('Error processing sell event:', error);
    }
  }

  private calculateTicketRemoval(data: SellEventData): number {
    try {
      const ticketsPerToken = this.activeRaffle?.ticketsPerToken
        ? parseFloat(this.activeRaffle.ticketsPerToken)
        : DEFAULT_TICKETS_PER_TOKEN;

      if (data.rawAmount && data.decimals !== undefined) {
        const amount = BigInt(data.rawAmount);
        const scale = BigInt(10) ** BigInt(data.decimals);
        if (scale === 0n) return 0;

        const PRECISION = 1000000;
        const ratio = Math.floor(ticketsPerToken * PRECISION);
        const ratioBig = BigInt(ratio);
        const precisionBig = BigInt(PRECISION);

        const ticketsBig = (amount * ratioBig) / (scale * precisionBig);
        return Number(ticketsBig);
      }

      const asFloat = Number.parseFloat(data.tokenAmount);
      if (Number.isNaN(asFloat)) return 0;
      return Math.floor(asFloat * ticketsPerToken);
    } catch (error) {
      return 0;
    }
  }

  private getNestedValue(source: Record<string, any>, path: string): any {
    if (!source) return undefined;
    if (!path.includes('.')) return source?.[path];
    return path.split('.').reduce((value: any, key) => {
      if (value === undefined || value === null) return undefined;
      return value?.[key];
    }, source);
  }

  private pickString(source: Record<string, any>, paths: string[]): string | null {
    for (const path of paths) {
      const value = this.getNestedValue(source, path);
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
      }
      if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    }
    return null;
  }

  private pickNumber(source: Record<string, any>, paths: string[]): number | undefined {
    for (const path of paths) {
      const value = this.getNestedValue(source, path);
      if (value === undefined || value === null) continue;
      if (typeof value === 'number' && !Number.isNaN(value)) return value;
      if (typeof value === 'string' || typeof value === 'bigint') {
        const numeric = Number(value);
        if (!Number.isNaN(numeric)) return numeric;
      }
    }
    return undefined;
  }

  private parseTimestamp(value: unknown): number {
    if (value === null || value === undefined) return Date.now();
    let numeric: number | null = null;
    if (typeof value === 'number') numeric = value;
    else if (typeof value === 'bigint') numeric = Number(value);
    else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return Date.now();
      if (/^\d+$/u.test(trimmed)) numeric = Number(trimmed);
      else {
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed)) numeric = parsed;
      }
    }
    if (numeric === null || Number.isNaN(numeric)) return Date.now();
    if (numeric > 1e15) return numeric;
    if (numeric < 1e12) return numeric * 1000;
    return numeric;
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

  private extractAmount(data: Record<string, any>): string | null {
    const candidateKeys = ['amount', 'quantity', 'value', 'coinAmount'];
    for (const key of candidateKeys) {
      if (data[key] !== undefined && data[key] !== null) return String(data[key]);
    }
    if (data.fields && typeof data.fields === 'object') {
      return this.extractAmount(data.fields as Record<string, any>);
    }
    return null;
  }

  private extractRecipient(data: Record<string, any>): string | null {
    const candidateKeys = ['recipient', 'to', 'receiver', 'destination'];
    for (const key of candidateKeys) {
      if (data[key] !== undefined && data[key] !== null) return String(data[key]);
    }
    if (data.fields && typeof data.fields === 'object') {
      return this.extractRecipient(data.fields as Record<string, any>);
    }
    return null;
  }

  private async getCoinDecimals(client: SuiClient, coinType: string): Promise<number> {
    if (this.decimalsCache.has(coinType)) return this.decimalsCache.get(coinType)!;
    try {
      const metadata = await client.getCoinMetadata({ coinType });
      const decimals = metadata?.decimals ?? 9;
      this.decimalsCache.set(coinType, decimals);
      return decimals;
    } catch (error) {
      this.decimalsCache.set(coinType, 9);
      return 9;
    }
  }

  private formatAmount(rawAmount: string, decimals: number): string {
    try {
      const raw = BigInt(rawAmount);
      if (decimals === 0) return raw.toString();
      const divisor = BigInt(10) ** BigInt(decimals);
      const whole = raw / divisor;
      const remainder = raw % divisor;
      if (remainder === 0n) return whole.toString();
      const fraction = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
      return `${whole.toString()}.${fraction}`;
    } catch (error) {
      return rawAmount;
    }
  }
}

export const sellDetector = new SellDetector();
