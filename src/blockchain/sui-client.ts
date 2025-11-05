import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { logger } from '../utils/logger';

let suiClient: SuiClient | null = null;

export function getSuiClient(): SuiClient {
  if (!suiClient) {
    const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl('mainnet');
    suiClient = new SuiClient({ url: rpcUrl });
    logger.info(`SUI client initialized with RPC: ${rpcUrl}`);
  }
  return suiClient;
}

