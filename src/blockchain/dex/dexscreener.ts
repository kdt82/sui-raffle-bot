import { logger } from '../../utils/logger';
import { DexIntegration, BuyEventData } from './base';
import { CetusIntegration } from './cetus';
import { TurbosIntegration } from './turbos';
import { SevenKAgIntegration } from './7kag';
import { SuiDexIntegration } from './suidex';

type DexScreenerPair = {
  pairAddress: string;
  dexId: string;
  chainId: string;
  liquidity?: { usd?: number };
};

const DEXSCREENER_API_URL = 'https://api.dexscreener.com/latest/dex';

const SUPPORTED_PROXIES: Record<string, () => DexIntegration> = {
  cetus: () => new CetusIntegration(),
  turbos: () => new TurbosIntegration(),
  '7kag': () => new SevenKAgIntegration(),
  suidex: () => new SuiDexIntegration(),
};

export class DexScreenerIntegration implements DexIntegration {
  name = 'dexscreener';
  private monitoring = false;
  private proxiedIntegration: DexIntegration | null = null;
  private proxiedDexId: string | null = null;

  async monitor(tokenAddress: string, callback: (buyEvent: BuyEventData) => Promise<void>): Promise<void> {
    if (this.monitoring) {
      logger.warn('DexScreener monitoring already active');
      return;
    }

    logger.info(`Starting DexScreener monitoring for token: ${tokenAddress}`);

    try {
      const pair = await this.findBestPair(tokenAddress);
      if (!pair) {
        logger.warn(`DexScreener: no suitable pair found for token ${tokenAddress}`);
        return;
      }

      const normalizedDexId = typeof pair.dexId === 'string' ? pair.dexId.toLowerCase() : '';
      const proxyFactory = SUPPORTED_PROXIES[normalizedDexId];
      if (!proxyFactory) {
        logger.warn(
          `DexScreener: unsupported dexId ${pair.dexId} for token ${tokenAddress}. Supported: ${Object.keys(
            SUPPORTED_PROXIES
          ).join(', ')}`,
        );
        return;
      }

      this.proxiedIntegration = proxyFactory();
      this.proxiedDexId = normalizedDexId;
      this.monitoring = true;

      logger.info(
        `DexScreener: delegating monitoring for ${tokenAddress} to ${this.proxiedDexId} integration (pair ${pair.pairAddress})`,
      );

      await this.proxiedIntegration.monitor(tokenAddress, callback);
    } catch (error) {
      logger.error('DexScreener monitor error:', error);
      this.monitoring = false;
      this.proxiedIntegration = null;
      this.proxiedDexId = null;
    }
  }

  async stop(): Promise<void> {
    if (this.proxiedIntegration) {
      try {
        await this.proxiedIntegration.stop();
      } catch (error) {
        logger.error('Error stopping proxied DexScreener integration:', error);
      }
    }

    this.monitoring = false;
    this.proxiedIntegration = null;
    this.proxiedDexId = null;
    logger.info('DexScreener monitoring stopped');
  }

  private async findBestPair(tokenAddress: string): Promise<DexScreenerPair | null> {
    try {
      const response = await fetch(`${DEXSCREENER_API_URL}/tokens/${tokenAddress}`);

      if (!response.ok) {
        logger.warn(`DexScreener API returned ${response.status} for token ${tokenAddress}`);
        return null;
      }

      const data: any = await response.json();
      if (!data?.pairs?.length) {
        return null;
      }

      const pairs: DexScreenerPair[] = data.pairs
        .filter((pair: any) => {
          const dexId = typeof pair?.dexId === 'string' ? pair.dexId.toLowerCase() : '';
          return dexId && SUPPORTED_PROXIES[dexId];
        })
        .map((pair: any) => ({
          pairAddress: pair.pairAddress,
          dexId: pair.dexId,
          chainId: pair.chainId,
          liquidity: pair.liquidity,
        }));

      if (!pairs.length) {
        return null;
      }

      // Prefer highest liquidity pair
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return pairs[0];
    } catch (error) {
      logger.error('Error fetching DexScreener pair info:', error);
      return null;
    }
  }
}

