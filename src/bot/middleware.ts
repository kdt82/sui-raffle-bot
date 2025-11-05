import TelegramBot from 'node-telegram-bot-api';
import { bot } from './index';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export async function isAdmin(telegramUserId: bigint): Promise<boolean> {
  try {
    const admin = await prisma.admin.findUnique({
      where: { telegramUserId },
    });
    return !!admin;
  } catch (error) {
    logger.error('Error checking admin status:', error);
    return false;
  }
}

export async function requireAdmin(
  msg: TelegramBot.Message,
  callback: () => Promise<void>
): Promise<void> {
  const userId = BigInt(msg.from!.id);
  if (!(await isAdmin(userId))) {
    await bot.sendMessage(
      msg.chat.id,
      '❌ You do not have permission to use this command. Admin access required.'
    );
    return;
  }
  await callback();
}

