import { getRedisClient } from './redis';
import { logger } from './logger';

/**
 * Simple metrics tracking using Redis
 * For full monitoring, integrate with Prometheus
 */

const redis = getRedisClient();

/**
 * Increment command counter
 */
export async function incrementCommand(command: string, isAdmin: boolean): Promise<void> {
  try {
    const key = `metrics:command:${isAdmin ? 'admin' : 'user'}:${command}`;
    await redis.incr(key);
    
    // Also increment daily counter
    const date = new Date().toISOString().split('T')[0];
    const dailyKey = `metrics:daily:${date}:${command}`;
    await redis.incr(dailyKey);
    await redis.expire(dailyKey, 30 * 24 * 60 * 60); // Keep for 30 days
  } catch (error) {
    logger.error('Failed to increment command metric:', error);
  }
}

/**
 * Record error occurrence
 */
export async function recordError(type: string, component: string): Promise<void> {
  try {
    const key = `metrics:error:${type}:${component}`;
    await redis.incr(key);
    
    // Also track hourly errors
    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const hourlyKey = `metrics:hourly:${hour}:errors`;
    await redis.incr(hourlyKey);
    await redis.expire(hourlyKey, 7 * 24 * 60 * 60); // Keep for 7 days
  } catch (error) {
    logger.error('Failed to record error metric:', error);
  }
}

/**
 * Track raffle event
 */
export async function trackRaffleEvent(event: 'created' | 'ended' | 'winner_selected'): Promise<void> {
  try {
    const key = `metrics:raffle:${event}`;
    await redis.incr(key);
  } catch (error) {
    logger.error('Failed to track raffle event:', error);
  }
}

/**
 * Track ticket allocation
 */
export async function trackTicketAllocation(ticketCount: number): Promise<void> {
  try {
    await redis.incrby('metrics:tickets:total', ticketCount);
  } catch (error) {
    logger.error('Failed to track ticket allocation:', error);
  }
}

/**
 * Get metrics summary
 */
export async function getMetricsSummary(): Promise<Record<string, number>> {
  try {
    const keys = await redis.keys('metrics:*');
    const summary: Record<string, number> = {};

    for (const key of keys) {
      const value = await redis.get(key);
      if (value) {
        summary[key] = parseInt(value, 10);
      }
    }

    return summary;
  } catch (error) {
    logger.error('Failed to get metrics summary:', error);
    return {};
  }
}
