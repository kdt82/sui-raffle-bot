import { getSuiClient } from '../sui-client';
import { logger } from '../../utils/logger';
import { DexIntegration, BuyEventData } from './base';
import { SuiClient } from '@mysten/sui.js/client';

// Cetus DEX Package IDs
const CETUS_PACKAGE_ID = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb';

export class CetusIntegration implements DexIntegration {
  name = 'cetus';
  private monitoring = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastProcessedTimestamp: number = Date.now();
  private poolCache: Map<string, { coinAType: string; coinBType: string }> = new Map();
  private decimalsCache: Map<string, number> = new Map();

  async monitor(tokenAddress: string, callback: (buyEvent: BuyEventData) => Promise<void>): Promise<void> {
    if (this.monitoring) {
      logger.warn('Cetus monitoring already active');
      return;
    }

    this.monitoring = true;
    const client = getSuiClient();

    logger.info(`🔄 Starting Cetus POLLING for token: ${tokenAddress}`);
    logger.info('📡 Polling every 10 seconds for recent transactions');

    // Start polling for events instead of WebSocket subscription
    this.pollInterval = setInterval(async () => {
      try {
        await this.pollForSwapEvents(client, tokenAddress, callback);
      } catch (error) {
        logger.error('⚠️ Error polling Cetus events:', error);
      }
    }, 10_000);

    // Do an immediate poll on start
    try {
      await this.pollForSwapEvents(client, tokenAddress, callback);
    } catch (error) {
      logger.error('⚠️ Error in initial Cetus poll:', error);
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.monitoring = false;
    logger.info('🛑 Cetus monitoring stopped');
  }

  private async pollForSwapEvents(
    client: SuiClient,
    tokenAddress: string,
    callback: (buyEvent: BuyEventData) => Promise<void>
  ): Promise<void> {
    try {
      // Query recent SwapEvent from Cetus pool module
      const events = await client.queryEvents({
        query: {
          MoveEventModule: {
            package: CETUS_PACKAGE_ID,
            module: 'pool',
          },
        },
        limit: 50,
        order: 'descending',
      });

      const eventCount = events.data?.length || 0;
      logger.info(`📥 Fetched ${eventCount} recent Cetus events`);

      if (!events.data || events.data.length === 0) {
        logger.warn('⚠️ No events returned from Cetus query');
        return;
      }

      // Log first event as sample
      if (events.data.length > 0) {
        logger.info('🔬 Sample event type:', events.data[0].type);
      }

      // Process events in reverse order (oldest first)
      const eventsToProcess = events.data.reverse();
      let processedCount = 0;
      let skippedCount = 0;

      for (const event of eventsToProcess) {
        const eventTimestamp = parseInt(event.timestampMs || '0', 10);
        if (eventTimestamp <= this.lastProcessedTimestamp) {
          skippedCount++;
          continue;
        }

        const buyEvent = await this.parseSwapEvent(client, event, tokenAddress);
        if (buyEvent) {
          await callback(buyEvent);
          processedCount++;
        }

        this.lastProcessedTimestamp = eventTimestamp;
      }

      if (processedCount > 0) {
        logger.info(`✅ Processed ${processedCount} new buy events`);
      }
      if (skippedCount > 0) {
        logger.debug(`ℹ️ Skipped ${skippedCount} already-processed events`);
      }
    } catch (error) {
      logger.error('⚠️ Error querying Cetus events:', error);
    }
  }

  private async parseSwapEvent(
    client: SuiClient,
    event: any,
    targetTokenAddress: string
  ): Promise<BuyEventData | null> {
    try {
      if (!event.type || !event.type.includes('Swap')) {
        return null;
      }

      logger.info('🔍 Processing Cetus Swap Event');
      logger.info(`   Type: ${event.type}`);
      logger.info(`   TX: ${event.id?.txDigest || 'unknown'}`);
      logger.info(`   Has parsedJson: ${!!event.parsedJson}`);

      const parsedJson = event.parsedJson;
      if (!parsedJson) {
        logger.warn('⚠️ No parsedJson in swap event');
        return null;
      }

      logger.info('📦 Swap Data Fields:', Object.keys(parsedJson).join(', '));
      logger.info('📦 Full Swap Data:', parsedJson);

      const poolId = parsedJson.pool;
      if (!poolId || typeof poolId !== 'string') {
        logger.warn('⚠️ Swap event missing pool id');
        return null;
      }

      const poolInfo = await this.getPoolInfo(client, poolId);
      if (!poolInfo) {
        logger.warn(`⚠️ Unable to resolve pool info for ${poolId}`);
        return null;
      }

      const targetLower = targetTokenAddress.toLowerCase();
      const coinALower = poolInfo.coinAType.toLowerCase();
      const coinBLower = poolInfo.coinBType.toLowerCase();
      const targetIsCoinA = coinALower.includes(targetLower);
      const targetIsCoinB = coinBLower.includes(targetLower);

      if (!targetIsCoinA && !targetIsCoinB) {
        logger.debug(
          `ℹ️ Swap event pool ${poolId} (${poolInfo.coinAType}, ${poolInfo.coinBType}) does not include target ${targetTokenAddress}`
        );
        return null;
      }

      const sender =
        parsedJson.partner ||
        parsedJson.sender ||
        parsedJson.user ||
        parsedJson.account ||
        parsedJson.owner ||
        parsedJson.trader;

      const amountIn =
        parsedJson.amount_in || parsedJson.amountIn || parsedJson.amount_a || parsedJson.amountA || parsedJson.in_amount;
      const amountOut =
        parsedJson.amount_out ||
        parsedJson.amountOut ||
        parsedJson.amount_b ||
        parsedJson.amountB ||
        parsedJson.out_amount;
      const aToB =
        parsedJson.a_to_b === undefined
          ? parsedJson.atob !== undefined
            ? parsedJson.atob
            : parsedJson.direction === 'a_to_b'
          : parsedJson.a_to_b;

      logger.info(`👤 Extracted sender: ${sender}`);
      logger.info(`💰 Amount In: ${amountIn}, Amount Out: ${amountOut}, a_to_b: ${aToB}`);

      if (!sender) {
        logger.warn('⚠️ Could not extract sender from Cetus event. Available fields:', Object.keys(parsedJson));
        return null;
      }

      if (!amountIn || !amountOut) {
        logger.warn('⚠️ Swap event missing amount data');
        return null;
      }

      const isAToB = aToB === true;
      let tokenAmountRaw: string | null = null;
      const targetCoinType = targetIsCoinA ? poolInfo.coinAType : poolInfo.coinBType;

      if (targetIsCoinA) {
        if (isAToB) {
          logger.debug('ℹ️ Target token is coin A but swap direction is A -> B (sell). Skipping.');
          return null;
        }
        tokenAmountRaw = amountOut;
      } else if (targetIsCoinB) {
        if (!isAToB) {
          logger.debug('ℹ️ Target token is coin B but swap direction is B -> A (sell). Skipping.');
          return null;
        }
        tokenAmountRaw = amountOut;
      }

      if (!tokenAmountRaw) {
        logger.debug('ℹ️ Unable to determine token amount for buy event');
        return null;
      }

      const targetDecimals = await this.getCoinDecimals(client, targetCoinType);
      const tokenAmountDecimal = this.formatAmount(tokenAmountRaw, targetDecimals);

      logger.info(
        `✅ Cetus BUY DETECTED! Wallet: ${sender}, Amount: ${tokenAmountDecimal} tokens (raw: ${tokenAmountRaw})`
      );

      return {
        walletAddress: sender,
        tokenAmount: tokenAmountDecimal,
        transactionHash: event.id?.txDigest || `cetus_${Date.now()}`,
        timestamp: new Date(parseInt(event.timestampMs || Date.now().toString(), 10)),
      };
    } catch (error) {
      logger.error('⚠️ Error parsing Cetus swap event:', error);
      return null;
    }
  }

  private async getPoolInfo(
    client: SuiClient,
    poolId: string
  ): Promise<{ coinAType: string; coinBType: string } | null> {
    if (this.poolCache.has(poolId)) {
      return this.poolCache.get(poolId)!;
    }

    try {
      const response = await client.getObject({
        id: poolId,
        options: { showType: true },
      });

      const poolType = response?.data?.type;
      if (!poolType || typeof poolType !== 'string') {
        return null;
      }

      const typeArgsMatch = poolType.match(/<(.+)>/);
      if (!typeArgsMatch) {
        return null;
      }

      const typeArgs = typeArgsMatch[1].split(',').map((arg) => arg.trim());
      if (typeArgs.length < 2) {
        return null;
      }

      const info = { coinAType: typeArgs[0], coinBType: typeArgs[1] };
      this.poolCache.set(poolId, info);
      return info;
    } catch (error) {
      logger.error('⚠️ Failed to fetch pool info:', error);
      return null;
    }
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
      logger.warn(`⚠️ Failed to fetch coin metadata for ${coinType}, defaulting decimals to 9`, error);
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
      logger.warn('⚠️ Failed to format amount, returning raw value', error);
      return rawAmount;
    }
  }
}
