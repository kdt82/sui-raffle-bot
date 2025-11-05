import { getRedisClient } from './redis';
import { logger } from './logger';

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Max requests in window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export class RateLimiter {
  private redis = getRedisClient();

  /**
   * Check if a request is rate limited
   * @param key - Unique identifier (e.g., userId:command)
   * @param config - Rate limit configuration
   */
  async checkLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Remove old entries outside the window
      await this.redis.zremrangebyscore(redisKey, 0, windowStart);

      // Count requests in current window
      const count = await this.redis.zcard(redisKey);

      if (count >= config.maxRequests) {
        // Get the oldest entry to calculate reset time
        const oldest = await this.redis.zrange(redisKey, 0, 0, 'WITHSCORES');
        const resetAt = oldest.length > 1 
          ? new Date(parseInt(oldest[1]) + config.windowMs)
          : new Date(now + config.windowMs);

        return {
          allowed: false,
          remaining: 0,
          resetAt,
        };
      }

      // Add current request
      await this.redis.zadd(redisKey, now, `${now}`);

      // Set expiry on the key
      await this.redis.expire(redisKey, Math.ceil(config.windowMs / 1000));

      return {
        allowed: true,
        remaining: config.maxRequests - count - 1,
        resetAt: new Date(now + config.windowMs),
      };
    } catch (error) {
      logger.error('Rate limit check failed:', error);
      // On error, allow the request (fail open)
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetAt: new Date(now + config.windowMs),
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async resetLimit(key: string): Promise<void> {
    const redisKey = `ratelimit:${key}`;
    try {
      await this.redis.del(redisKey);
    } catch (error) {
      logger.error('Failed to reset rate limit:', error);
    }
  }

  /**
   * Get current usage for a key
   */
  async getUsage(key: string, windowMs: number): Promise<number> {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      await this.redis.zremrangebyscore(redisKey, 0, windowStart);
      return await this.redis.zcard(redisKey);
    } catch (error) {
      logger.error('Failed to get rate limit usage:', error);
      return 0;
    }
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Predefined rate limit configurations
export const RATE_LIMITS = {
  // User commands
  USER_COMMAND: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 10,       // 10 requests per minute
  },
  
  // Wallet linking (more strict to prevent abuse)
  LINK_WALLET: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 3,        // 3 attempts per minute
  },

  // Admin commands (less strict)
  ADMIN_COMMAND: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 30,       // 30 requests per minute
  },

  // Create raffle (very strict)
  CREATE_RAFFLE: {
    windowMs: 5 * 60 * 1000,  // 5 minutes
    maxRequests: 3,            // 3 attempts per 5 minutes
  },

  // Leaderboard queries (prevent spam)
  LEADERBOARD: {
    windowMs: 30 * 1000,  // 30 seconds
    maxRequests: 5,        // 5 requests per 30 seconds
  },

  // Media uploads
  UPLOAD_MEDIA: {
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 5,        // 5 uploads per minute
  },

  // Callback queries (button clicks)
  CALLBACK_QUERY: {
    windowMs: 10 * 1000,  // 10 seconds
    maxRequests: 20,       // 20 clicks per 10 seconds
  },
} as const;

// Helper function to create rate limit key
export function createRateLimitKey(userId: bigint | number, action: string): string {
  return `${userId}:${action}`;
}

