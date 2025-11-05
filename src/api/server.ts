import fastify from 'fastify';
import { logger } from '../utils/logger';
import { registerHealthRoutes } from './health';

const PORT = parseInt(process.env.PORT || '3000');

export async function startHealthServer(): Promise<void> {
  const server = fastify({
    logger: false, // Use our pino logger instead
  });

  // Register health routes
  await registerHealthRoutes(server);

  // Root endpoint
  server.get('/', async (request, reply) => {
    return {
      name: 'SUI Raffle Telegram Bot',
      version: '1.0.0',
      status: 'running',
    };
  });

  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Health server listening on port ${PORT}`);
  } catch (error) {
    logger.error('Failed to start health server:', error);
  }
}

