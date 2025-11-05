// DEX Integration Interface
export interface BuyEventData {
  walletAddress: string;
  tokenAmount: string;
  transactionHash: string;
  timestamp: Date;
}

export interface DexIntegration {
  name: string;
  monitor(tokenAddress: string, callback: (buyEvent: BuyEventData) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

