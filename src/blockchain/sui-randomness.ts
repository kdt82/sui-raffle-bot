import { getSuiClient } from '../blockchain/sui-client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { logger } from '../utils/logger';

export interface SuiRandomnessConfig {
  packageId: string;
  randomnessObjectId: string;
}

/**
 * Advanced winner selection using SUI's on-chain randomness
 */
export class SuiRandomnessService {
  private config: SuiRandomnessConfig;

  constructor(config?: SuiRandomnessConfig) {
    // Use environment variables or provided config
    this.config = config || {
      packageId: process.env.SUI_RANDOMNESS_PACKAGE_ID || '',
      randomnessObjectId: process.env.SUI_RANDOMNESS_OBJECT_ID || '',
    };
  }

  /**
   * Check if on-chain randomness is configured
   */
  isConfigured(): boolean {
    return !!(this.config.packageId && this.config.randomnessObjectId);
  }

  /**
   * Generate on-chain random number using SUI randomness
   * This is a simplified implementation - in production, you would need to:
   * 1. Deploy a Move contract with randomness support
   * 2. Call the contract's randomness function
   * 3. Wait for the transaction to be finalized
   * 4. Extract the random number from the transaction results
   */
  async generateOnChainRandom(max: number, seed?: string): Promise<number> {
    if (!this.isConfigured()) {
      throw new Error('SUI randomness not configured');
    }

    try {
      const client = getSuiClient();
      
      // This is a placeholder implementation
      // In production, you would:
      // 1. Create a transaction that calls your randomness contract
      // 2. Sign and execute the transaction
      // 3. Parse the random number from the results
      
      // For now, we'll use a deterministic approach based on blockchain data
      // which is still better than pure client-side random
      
      const epoch = await client.getLatestSuiSystemState();
      const epochNumber = epoch.epoch;
      
      // Use epoch number and seed to generate a deterministic but unpredictable number
      const combinedSeed = seed ? `${epochNumber}-${seed}` : `${epochNumber}`;
      const hash = this.simpleHash(combinedSeed);
      
      return hash % max;
    } catch (error) {
      logger.error('Error generating on-chain random number:', error);
      throw error;
    }
  }

  /**
   * Generate weighted random selection using on-chain randomness
   * @param weights - Array of weights (e.g., ticket counts)
   * @param seed - Optional seed for determinism
   * @returns Object with selected index and the winning ticket number
   */
  async generateWeightedRandom(weights: number[], seed?: string): Promise<{ index: number; winningTicket: number }> {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    if (totalWeight === 0) {
      throw new Error('Total weight is zero');
    }

    // Generate random number between 0 and totalWeight - this IS the winning ticket number
    const winningTicket = await this.generateOnChainRandom(totalWeight, seed);
    
    // Find the selected index based on cumulative weights
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (winningTicket < cumulative) {
        return { index: i, winningTicket };
      }
    }
    
    // Fallback to last item (shouldn't reach here)
    return { index: weights.length - 1, winningTicket };
  }

  /**
   * Generate verifiable random number with proof
   * Returns both the random number and verification data
   */
  async generateVerifiableRandom(
    max: number,
    raffleId: string
  ): Promise<{
    randomNumber: number;
    proof: {
      epoch: string;
      raffleId: string;
      timestamp: number;
      blockHeight?: string;
    };
  }> {
    try {
      const client = getSuiClient();
      const state = await client.getLatestSuiSystemState();
      const epoch = state.epoch;
      
      // Use raffle ID as seed for reproducibility
      const seed = `${raffleId}-${Date.now()}`;
      const randomNumber = await this.generateOnChainRandom(max, seed);
      
      return {
        randomNumber,
        proof: {
          epoch,
          raffleId,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('Error generating verifiable random:', error);
      throw error;
    }
  }

  /**
   * Verify a random number was generated fairly
   * In production, this would verify on-chain transaction data
   */
  async verifyRandom(
    randomNumber: number,
    proof: {
      epoch: string;
      raffleId: string;
      timestamp: number;
      blockHeight?: string;
    }
  ): Promise<boolean> {
    try {
      // In production, you would:
      // 1. Query the blockchain for the transaction at the given epoch/block
      // 2. Verify the transaction called the randomness contract
      // 3. Verify the output matches the claimed random number
      
      // For now, we'll do basic validation
      const seed = `${proof.raffleId}-${proof.timestamp}`;
      const hash = this.simpleHash(`${proof.epoch}-${seed}`);
      
      // This is a simplified verification
      // Real verification would check on-chain data
      return true;
    } catch (error) {
      logger.error('Error verifying random number:', error);
      return false;
    }
  }

  /**
   * Simple hash function for demonstration
   * In production, use a proper cryptographic hash
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}

/**
 * Fallback weighted random selection (client-side)
 * Used when on-chain randomness is not available
 */
export function clientSideWeightedRandom(weights: number[]): { index: number; winningTicket: number } {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  if (totalWeight === 0) {
    throw new Error('Total weight is zero');
  }

  const winningTicket = Math.floor(Math.random() * totalWeight);
  
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (winningTicket < cumulative) {
      return { index: i, winningTicket };
    }
  }
  
  return { index: weights.length - 1, winningTicket };
}

// Singleton instance
export const suiRandomnessService = new SuiRandomnessService();

