import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../utils/logger';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
}

export const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  logger.error('Telegram polling error:', error);
});

bot.on('error', (error) => {
  logger.error('Telegram bot error:', error);
});

logger.info('Telegram bot initialized');

