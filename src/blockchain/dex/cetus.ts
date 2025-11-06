import { getSuiClient } from '../sui-client';
import { logger } from '../../utils/logger';
import { DexIntegration, BuyEventData } from './base';

// Cetus DEX Package IDs
const CETUS_PACKAGE_ID = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb';

export class CetusIntegration implements DexIntegration {
  name = 'cetus';
  private monitoring = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastProcessedTimestamp: number = Date.now();

  async monitor(tokenAddress: string, callback: (buyEvent: BuyEventData) => Promise<void>): Promise<void> {
    if (this.monitoring) {
      logger.warn('Cetus monitoring already active');
      return;
    }

    this.monitoring = true;
    const client = getSuiClient();

    logger.info(`🔄 Starting Cetus POLLING for token: ${tokenAddress}`);
    logger.info(`📡 Polling every 10 seconds for recent transactions`);

    // Start polling for events instead of WebSocket subscription
    this.pollInterval = setInterval(async () => {
      try {
        await this.pollForSwapEvents(client, tokenAddress, callback);
      } catch (error) {
        logger.error('❌ Error polling Cetus events:', error);
      }
    }, 10000); // Poll every 10 seconds

    // Do an immediate poll on start
    try {
      await this.pollForSwapEvents(client, tokenAddress, callback);
    } catch (error) {
      logger.error('❌ Error in initial Cetus poll:', error);
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.monitoring = false;
    logger.info('Cetus monitoring stopped');
  }

  private async pollForSwapEvents(
    client: any,
    tokenAddress: string,
    callback: (buyEvent: BuyEventData) => Promise<void>
  ): Promise<void> {
    try {
      // Query recent events from Cetus package (use Package filter, not MoveEventType)
      const events = await client.queryEvents({
        query: {
          Package: CETUS_PACKAGE_ID,
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
        // Skip events we've already processed
        const eventTimestamp = parseInt(event.timestampMs || '0');
        if (eventTimestamp <= this.lastProcessedTimestamp) {
          skippedCount++;
          continue;
        }

        const buyEvent = await this.parseSwapEvent(event, tokenAddress);
        if (buyEvent) {
          await callback(buyEvent);
          processedCount++;
        }

        // Update last processed timestamp
        this.lastProcessedTimestamp = eventTimestamp;
      }

      if (processedCount > 0) {
        logger.info(`✅ Processed ${processedCount} new buy events`);
      }
      if (skippedCount > 0) {
        logger.debug(`⏩ Skipped ${skippedCount} already-processed events`);
      }
    } catch (error) {
      logger.error('❌ Error querying Cetus events:', error);
    }
  }

  private async parseSwapEvent(event: any, targetTokenAddress: string): Promise<BuyEventData | null> {
    try {
      // Check if this is a swap event FIRST
      if (!event.type || !event.type.includes('Swap')) {
        return null;
      }

      // Log event basics
      logger.info('🔍 Processing Cetus Swap Event');
      logger.info(`   Type: ${event.type}`);
      logger.info(`   TX: ${event.id?.txDigest || 'unknown'}`);
      logger.info(`   Has parsedJson: ${!!event.parsedJson}`);

      const parsedJson = event.parsedJson;
      if (!parsedJson) {
        logger.warn('❌ No parsedJson in swap event');
        return null;
      }

      // Log parsed data fields
      logger.info('📦 Swap Data Fields:', Object.keys(parsedJson).join(', '));
      logger.info('📦 Full Swap Data:', parsedJson);

      // Extract token addresses from the swap
      const eventType = event.type || '';
      
      // More flexible token matching:
      // Extract just the package address (before ::) for comparison
      const targetPackageAddress = targetTokenAddress.split('::')[0].toLowerCase();
      const eventTypeLower = eventType.toLowerCase();
      
      // Check if our target token package is involved in the swap
      const isTargetInvolved = eventTypeLower.includes(targetPackageAddress) || 
                               eventTypeLower.includes(targetTokenAddress.toLowerCase());
      
      logger.info(`🔎 Token match check:`, {
        targetPackage: targetPackageAddress,
        fullTarget: targetTokenAddress,
        eventType: event.type,
        matched: isTargetInvolved
      });
      
      if (!isTargetInvolved) {
        logger.debug(`⏭️ Event doesn't involve target token: ${targetTokenAddress}`);
        return null;
      }

      // Extract swap details
      // Common fields in Cetus swap events:
      // - amount_in, amount_out
      // - partner (the wallet performing the swap)
      // - coin_a, coin_b (token types)
      
      const sender = parsedJson.partner || parsedJson.sender || parsedJson.user || parsedJson.recipient;
      const amountIn = parsedJson.amount_in || parsedJson.amountIn || parsedJson.amount_a;
      const amountOut = parsedJson.amount_out || parsedJson.amountOut || parsedJson.amount_b;
      
      logger.info(`👤 Extracted sender: ${sender}`);
      logger.info(`💰 Amount In: ${amountIn}, Amount Out: ${amountOut}`);
      
      if (!sender) {
        logger.warn('❌ Could not extract sender from Cetus event. Available fields:', Object.keys(parsedJson));
        return null;
      }

      // Determine which amount is for our token (the "buy" amount)
      // If they're buying our token, it would be the amount_out
      // We need to figure out which token is being bought based on the event type
      let tokenAmount = '0';
      
      // Check which position our token is in (coin_a or coin_b in the type parameters)
      const typeParams = eventType.match(/<(.+)>/)?.[1]?.split(',') || [];
      logger.info(`🔢 Type parameters:`, typeParams);
      
      if (typeParams.length >= 2) {
        const firstToken = typeParams[0].trim().toLowerCase();
        const secondToken = typeParams[1].trim().toLowerCase();
        
        // If our token is the first type parameter, use amount_out (they're buying it with the second token)
        // If our token is the second type parameter, use amount_in (they're selling the first token for it)
        if (firstToken.includes(targetPackageAddress)) {
          tokenAmount = amountOut || amountIn || '0';
          logger.info(`✅ Target is first token (amount_out): ${tokenAmount}`);
        } else if (secondToken.includes(targetPackageAddress)) {
          tokenAmount = amountIn || amountOut || '0';
          logger.info(`✅ Target is second token (amount_in): ${tokenAmount}`);
        }
      } else {
        // Fallback: use whichever amount is available
        tokenAmount = amountOut || amountIn || '0';
        logger.info(`⚠️ Using fallback amount: ${tokenAmount}`);
      }
      
      // Convert from blockchain units (usually needs to be divided by decimals, but we'll handle that)
      // For now, divide by 10^9 assuming 9 decimals (common for SUI tokens)
      const tokenAmountDecimal = (parseFloat(tokenAmount) / 1_000_000_000).toString();

      logger.info(`🎉 Cetus BUY DETECTED! Wallet: ${sender}, Amount: ${tokenAmountDecimal} tokens (raw: ${tokenAmount})`);

      return {
        walletAddress: sender,
        tokenAmount: tokenAmountDecimal,
        transactionHash: event.id?.txDigest || `cetus_${Date.now()}`,
        timestamp: new Date(parseInt(event.timestampMs || Date.now().toString())),
      };
    } catch (error) {
      logger.error('❌ Error parsing Cetus swap event:', error);
      return null;
    }
  }
}

