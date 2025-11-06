import { getSuiClient } from '../sui-client';
import { logger } from '../../utils/logger';
import { DexIntegration, BuyEventData } from './base';

// Cetus DEX Package IDs
const CETUS_PACKAGE_ID = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb';

export class CetusIntegration implements DexIntegration {
  name = 'cetus';
  private monitoring = false;
  private unsubscribe: (() => void) | null = null;

  async monitor(tokenAddress: string, callback: (buyEvent: BuyEventData) => Promise<void>): Promise<void> {
    if (this.monitoring) {
      logger.warn('Cetus monitoring already active');
      return;
    }

    this.monitoring = true;
    const client = getSuiClient();

    logger.info(`Starting Cetus monitoring for token: ${tokenAddress}`);

    try {
      // Subscribe to Cetus swap events
      const unsubscribe = await client.subscribeEvent({
        filter: {
          Package: CETUS_PACKAGE_ID,
        },
        onMessage: async (event) => {
          try {
            const buyEvent = await this.parseSwapEvent(event, tokenAddress);
            if (buyEvent) {
              await callback(buyEvent);
            }
          } catch (error) {
            logger.error('Error processing Cetus event:', error);
          }
        },
      });

      this.unsubscribe = unsubscribe;
    } catch (error) {
      logger.error('Error starting Cetus monitoring:', error);
      this.monitoring = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.monitoring = false;
    logger.info('Cetus monitoring stopped');
  }

  private async parseSwapEvent(event: any, targetTokenAddress: string): Promise<BuyEventData | null> {
    try {
      logger.info('Received Cetus event:', { type: event.type, id: event.id?.txDigest });
      
      // Check if this is a swap event
      if (!event.type || !event.type.includes('Swap')) {
        return null;
      }

      const parsedJson = event.parsedJson;
      if (!parsedJson) {
        logger.debug('No parsed JSON in event');
        return null;
      }

      logger.info('Cetus swap event data:', parsedJson);

      // Extract token addresses from the swap
      // Cetus events typically have coin types in the event type or parsed data
      const eventType = event.type || '';
      
      // Check if our target token is involved in the swap
      const normalizedTarget = targetTokenAddress.toLowerCase();
      const eventTypeLower = eventType.toLowerCase();
      
      if (!eventTypeLower.includes(normalizedTarget)) {
        logger.debug(`Event doesn't involve target token: ${targetTokenAddress}`);
        return null;
      }

      // Extract swap details
      // Common fields in Cetus swap events:
      // - amount_in, amount_out
      // - partner (the wallet performing the swap)
      // - coin_a, coin_b (token types)
      
      const sender = parsedJson.partner || parsedJson.sender || parsedJson.user;
      const amountIn = parsedJson.amount_in || parsedJson.amountIn || parsedJson.amount_a;
      const amountOut = parsedJson.amount_out || parsedJson.amountOut || parsedJson.amount_b;
      
      if (!sender) {
        logger.warn('Could not extract sender from Cetus event');
        return null;
      }

      // Determine which amount is for our token (the "buy" amount)
      // If they're buying our token, it would be the amount_out
      const tokenAmount = amountOut || amountIn || '1';

      logger.info(`✅ Cetus BUY DETECTED! Wallet: ${sender}, Amount: ${tokenAmount}`);

      return {
        walletAddress: sender,
        tokenAmount: tokenAmount.toString(),
        transactionHash: event.id?.txDigest || `cetus_${Date.now()}`,
        timestamp: new Date(parseInt(event.timestampMs || Date.now().toString())),
      };
    } catch (error) {
      logger.error('Error parsing Cetus swap event:', error);
      return null;
    }
  }
}

