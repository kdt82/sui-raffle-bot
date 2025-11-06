import TelegramBot from 'node-telegram-bot-api';
import { bot } from './index';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export async function isAdmin(telegramUserId: bigint): Promise<boolean> {
  try {
    logger.info(`Checking admin status for Telegram user ID: ${telegramUserId}`);
    const admin = await prisma.admin.findUnique({
      where: { telegramUserId },
    });
    logger.info(`Admin found: ${!!admin}`, admin ? { id: admin.id, permissions: admin.permissions } : {});
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

export async function requireAdminCallback(
  query: TelegramBot.CallbackQuery,
  callback: () => Promise<void>
): Promise<void> {
  const userId = BigInt(query.from.id);
  logger.info(`Checking admin status for callback from Telegram user ID: ${userId}`);
  if (!(await isAdmin(userId))) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin access required',
      show_alert: true,
    });
    return;
  }
  await callback();
}

/**
 * Require message to be in a private chat
 */
export async function requirePrivateChat(
  msg: TelegramBot.Message,
  callback: () => Promise<void>
): Promise<void> {
  if (msg.chat.type !== 'private') {
    await bot.sendMessage(
      msg.chat.id,
      '❌ This command can only be used in private messages. Please DM the bot directly.',
      { reply_to_message_id: msg.message_id }
    );
    return;
  }
  await callback();
}

/**
 * Require both admin access AND private chat for admin commands
 */
export async function requireAdminPrivate(
  msg: TelegramBot.Message,
  callback: () => Promise<void>
): Promise<void> {
  // First check if private chat
  if (msg.chat.type !== 'private') {
    await bot.sendMessage(
      msg.chat.id,
      '❌ Admin commands must be used in private messages. Please DM the bot directly.',
      { reply_to_message_id: msg.message_id }
    );
    return;
  }
  
  // Then check admin status
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

/**
 * Require both admin access AND private chat for callback queries
 */
export async function requireAdminPrivateCallback(
  query: TelegramBot.CallbackQuery,
  callback: () => Promise<void>
): Promise<void> {
  const chatType = query.message?.chat.type;
  
  // First check if private chat
  if (chatType !== 'private') {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin commands must be used in private messages',
      show_alert: true,
    });
    return;
  }
  
  // Then check admin status
  const userId = BigInt(query.from.id);
  logger.info(`Checking admin status for callback from Telegram user ID: ${userId}`);
  if (!(await isAdmin(userId))) {
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Admin access required',
      show_alert: true,
    });
    return;
  }
  
  await callback();
}

