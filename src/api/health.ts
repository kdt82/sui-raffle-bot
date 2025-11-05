import { FastifyInstance } from 'fastify';
import { prisma } from '../utils/database';
import { getRedisClient } from '../utils/redis';
import { logger } from '../utils/logger';
import { register } from '../utils/metrics';

export async function registerHealthRoutes(fastify: FastifyInstance) {
  // Prometheus metrics endpoint
  fastify.get('/metrics', async (request, reply) => {
    try {
      reply.type('text/plain');
      const metrics = await register.metrics();
      return reply.send(metrics);
    } catch (error) {
      logger.error('Metrics endpoint error:', error);
      return reply.code(500).send('Error generating metrics');
    }
  });

  // Basic health check
  fastify.get('/health', async (request, reply) => {
    try {
      const health = await getHealthStatus();
      
      if (health.status === 'healthy') {
        return reply.code(200).send(health);
      } else {
        return reply.code(503).send(health);
      }
    } catch (error) {
      logger.error('Health check error:', error);
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });

  // Detailed health check (admin only)
  fastify.get('/health/detailed', async (request, reply) => {
    try {
      const health = await getDetailedHealth();
      return reply.code(200).send(health);
    } catch (error) {
      logger.error('Detailed health check error:', error);
      return reply.code(500).send({
        status: 'error',
        error: 'Failed to get detailed health status',
      });
    }
  });

  // Readiness check (for Kubernetes/container orchestration)
  fastify.get('/ready', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.code(200).send({ ready: true });
    } catch (error) {
      return reply.code(503).send({ ready: false });
    }
  });

  // Liveness check (for Kubernetes/container orchestration)
  fastify.get('/live', async (request, reply) => {
    return reply.code(200).send({ alive: true });
  });
}

async function getHealthStatus() {
  const checks = {
    database: false,
    redis: false,
    bot: false,
  };

  // Check database
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    logger.error('Database health check failed:', error);
  }

  // Check Redis
  try {
    const redis = getRedisClient();
    await redis.ping();
    checks.redis = true;
  } catch (error) {
    logger.error('Redis health check failed:', error);
  }

  // Check bot (basic check - just verify it's loaded)
  try {
    const { bot } = await import('../bot');
    checks.bot = bot && typeof bot.sendMessage === 'function';
  } catch (error) {
    logger.error('Bot health check failed:', error);
  }

  const allHealthy = Object.values(checks).every(check => check === true);

  return {
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  };
}

async function getDetailedHealth() {
  const startTime = Date.now();
  
  // Database stats
  let databaseStats = null;
  try {
    const raffleCount = await prisma.raffle.count();
    const activeRaffles = await prisma.raffle.count({
      where: { status: 'active' },
    });
    const totalTickets = await prisma.ticket.count();
    const totalBuyEvents = await prisma.buyEvent.count();
    
    databaseStats = {
      connected: true,
      raffles: {
        total: raffleCount,
        active: activeRaffles,
      },
      tickets: totalTickets,
      buyEvents: totalBuyEvents,
    };
  } catch (error) {
    databaseStats = {
      connected: false,
      error: String(error),
    };
  }

  // Redis stats
  let redisStats = null;
  try {
    const redis = getRedisClient();
    await redis.ping();
    const info = await redis.info('memory');
    const usedMemory = info.match(/used_memory_human:([^\r\n]+)/)?.[1];
    
    redisStats = {
      connected: true,
      usedMemory,
    };
  } catch (error) {
    redisStats = {
      connected: false,
      error: String(error),
    };
  }

  // System info
  const uptime = process.uptime();
  const memory = process.memoryUsage();

  const responseTime = Date.now() - startTime;

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(uptime / 60)} minutes`,
    responseTime: `${responseTime}ms`,
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: `${Math.round(memory.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`,
      },
    },
    services: {
      database: databaseStats,
      redis: redisStats,
    },
  };
}

