import { logger } from '../../utils/logger';
import { DexType } from '../../utils/constants';
import { DexIntegration, BuyEventData } from './base';
import { CetusIntegration } from './cetus';
import { TurbosIntegration } from './turbos';
import { SevenKAgIntegration } from './7kag';
import { DexScreenerIntegration } from './dexscreener';
import { SuiDexIntegration } from './suidex';

export class DexFactory {
  private integrations: Map<DexType, DexIntegration> = new Map();

  constructor() {
    // Initialize all DEX integrations
    this.integrations.set('cetus', new CetusIntegration());
    this.integrations.set('turbos', new TurbosIntegration());
    this.integrations.set('7kag', new SevenKAgIntegration());
    this.integrations.set('dexscreener', new DexScreenerIntegration());
    this.integrations.set('suidex', new SuiDexIntegration());
  }

  getIntegration(dex: DexType): DexIntegration | null {
    const integration = this.integrations.get(dex);
    if (!integration) {
      logger.error(`DEX integration not found: ${dex}`);
      return null;
    }
    return integration;
  }

  async monitorDex(
    dex: DexType,
    tokenAddress: string,
    callback: (buyEvent: BuyEventData) => Promise<void>
  ): Promise<void> {
    const integration = this.getIntegration(dex);
    if (!integration) {
      throw new Error(`DEX integration not available: ${dex}`);
    }

    await integration.monitor(tokenAddress, callback);
  }

  async stopDex(dex: DexType): Promise<void> {
    const integration = this.getIntegration(dex);
    if (integration) {
      await integration.stop();
    }
  }

  async stopAll(): Promise<void> {
    for (const [dex, integration] of this.integrations.entries()) {
      try {
        await integration.stop();
      } catch (error) {
        logger.error(`Error stopping ${dex} integration:`, error);
      }
    }
  }
}

export const dexFactory = new DexFactory();

