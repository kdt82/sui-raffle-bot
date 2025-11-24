import TelegramBot from 'node-telegram-bot-api';
import { bot } from './index';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';


export async function isProjectAdmin(telegramUserId: bigint, projectId: string): Promise<boolean> {
  try {
    const admin = await prisma.projectAdmin.findUnique({
      where: {
        projectId_telegramUserId: {
          projectId,
          telegramUserId,
        },
      },
    });

    if (admin) return true;

    // Check for global super admin as fallback
    const globalAdmin = await prisma.admin.findUnique({
      where: { telegramUserId },
    });

    return globalAdmin?.permissions === 'super_admin';
  } catch (error) {
    logger.error('Error checking project admin status:', error);
    return false;
  }
}

export async function isAdmin(telegramUserId: bigint): Promise<boolean> {
  try {
    // This is now primarily for global super admins
    const admin = await prisma.admin.findUnique({
      where: { telegramUserId },
    });

    if (admin) return true;

    // Auto-promote first user if no admins exist (Global fallback)
    // Note: This might need to be removed or adjusted for multi-tenancy
    const adminCount = await prisma.admin.count();
    if (adminCount === 0) {
      logger.info(`No global admins found. Promoting user ${telegramUserId} to super_admin.`);
      await prisma.admin.create({
        data: {
          telegramUserId,
          permissions: 'super_admin',
        },
      });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('Error checking admin status:', error);
    return false;
  }
}


import { getProjectContext } from '../middleware/project-context';

export async function requireAdmin(
  msg: TelegramBot.Message,
  callback: () => Promise<void>
): Promise<void> {
  const userId = BigInt(msg.from!.id);
  const projectContext = await getProjectContext(msg);

  let hasAccess = false;
  if (projectContext) {
    hasAccess = await isProjectAdmin(userId, projectContext.id);
  } else {
    // Fallback to global admin check (e.g. for private chats or system admins)
    hasAccess = await isAdmin(userId);
  }

  if (!hasAccess) {
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

  // For callbacks, we need to check the message context if available
  let hasAccess = false;
  if (query.message) {
    const projectContext = await getProjectContext(query.message);
    if (projectContext) {
      hasAccess = await isProjectAdmin(userId, projectContext.id);
    } else {
      hasAccess = await isAdmin(userId);
    }
  } else {
    hasAccess = await isAdmin(userId);
  }

  if (!hasAccess) {
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
  // In private chat, we default to global admin check for now
  // TODO: Implement project selection context for admins in DM
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

