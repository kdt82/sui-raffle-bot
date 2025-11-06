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
      // Log ALL events for debugging
      logger.info('🔍 Received Cetus event:', { 
        type: event.type, 
        id: event.id?.txDigest,
        hasData: !!event.parsedJson 
      });
      
      // Check if this is a swap event
      if (!event.type || !event.type.includes('Swap')) {
        return null;
      }

      const parsedJson = event.parsedJson;
      if (!parsedJson) {
        logger.debug('No parsed JSON in event');
        return null;
      }

      // Log the full event data for debugging
      logger.info('📦 Cetus swap event data:', JSON.stringify(parsedJson, null, 2));
      logger.info('🎯 Event type:', event.type);

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

