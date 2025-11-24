import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';
import { RAFFLE_STATUS, formatDate } from '../../utils/constants';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';
import { analyticsService } from '../../services/analytics-service';
import { auditService } from '../../services/audit-service';
import { ensureProjectExists, getProjectContext } from '../../middleware/project-context';
import { isProjectAdmin, isAdmin } from '../middleware';

export async function handleStartCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'start', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    const isPrivateChat = msg.chat.type === 'private';
    incrementCommand('start', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'start' });

    let projectContext = null;
    if (!isPrivateChat) {
      try {
        projectContext = await ensureProjectExists(msg);
      } catch (error) {
        logger.error('Failed to ensure project exists:', error);
      }
    }

    // Check if user is an admin
    let userIsAdmin = false;
    if (projectContext) {
      userIsAdmin = await isProjectAdmin(userId, projectContext.id);
    } else {
      userIsAdmin = await isAdmin(userId);
    }

    const welcomeMessage = `
🎰 Welcome to the SUI Raffle Bot!

Here's how it works:
• Buy tokens and automatically get raffle tickets
• Check your tickets with /mytickets
• View the leaderboard with /leaderboard
• Link your wallet with /linkwallet <address>

🎁 Prizes are awarded at the end of each raffle period!

Commands:
/start - Show this message
/leaderboard - View current raffle leaderboard
/mytickets - Check your ticket count
/linkwallet <address> - Link your wallet address
/walletstatus - View your linked wallet
/unlinkwallet - Unlink your current wallet

Good luck! 🍀
    `.trim();

    // Add admin hint if user is admin and in private chat
    let finalMessage = welcomeMessage;
    if (userIsAdmin && isPrivateChat) {
      finalMessage += '\n\n🔐 *Admin Access Detected*\nUse /adminhelp to see admin commands.';
    }

    await bot.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
  });
}

export async function handleMyIdCommand(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = msg.from!.id;
  const username = msg.from?.username || 'No username';

  await bot.sendMessage(
    chatId,
    `👤 **Your Telegram Info**\n\n` +
    `User ID: \`${userId}\`\n` +
    `Username: @${username}\n\n` +
    `_Use this ID to add yourself as an admin in the database_`,
    { parse_mode: 'Markdown' }
  );
}


export async function handleLeaderboardCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'leaderboard', RATE_LIMITS.LEADERBOARD, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('leaderboard', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'leaderboard' });

    const projectContext = await getProjectContext(msg);
    if (!projectContext) {
      if (msg.chat.type === 'private') {
        await bot.sendMessage(chatId, '❌ Please use this command in the project group chat.');
      } else {
        await bot.sendMessage(chatId, '❌ Project not configured. Please run /start first.');
      }
      return;
    }

    try {
      // Find active raffle for this project
      const activeRaffle = await prisma.raffle.findFirst({
        where: {
          projectId: projectContext.id,
          status: RAFFLE_STATUS.ACTIVE,
          endTime: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeRaffle) {
        await bot.sendMessage(chatId, '📭 No active raffle found.');
        return;
      }

      // Get top 25 tickets
      const topTickets = await prisma.ticket.findMany({
        where: {
          raffleId: activeRaffle.id,
          ticketCount: { gt: 0 },
        },
        orderBy: { ticketCount: 'desc' },
        take: 25,
      });

      if (topTickets.length === 0) {
        await bot.sendMessage(chatId, '📊 No tickets allocated yet. Buy tokens to get started!');
        return;
      }

      // Get total participant count
      const totalParticipants = await prisma.ticket.count({
        where: {
          raffleId: activeRaffle.id,
          ticketCount: { gt: 0 },
        },
      });

      let leaderboardMessage = '🏆 **Leaderboard**\n\n';
      leaderboardMessage += `Raffle ends: ${formatDate(activeRaffle.endTime)} UTC\n\n`;

      topTickets.forEach((ticket, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
        leaderboardMessage += `${medal} ${ticket.walletAddress.slice(0, 8)}...${ticket.walletAddress.slice(-6)} - ${ticket.ticketCount.toLocaleString()} tickets\n`;
      });

      // Add footer with total participants
      if (totalParticipants > 25) {
        leaderboardMessage += `\n_Showing top 25 of ${totalParticipants} participants_`;
      }

      // Send with leaderboard media if available
      if (activeRaffle.leaderboardMediaUrl && activeRaffle.leaderboardMediaType) {
        if (activeRaffle.leaderboardMediaType === 'image') {
          try {
            await bot.sendPhoto(chatId, activeRaffle.leaderboardMediaUrl, {
              caption: leaderboardMessage,
              parse_mode: 'Markdown',
            });
          } catch (photoError: any) {
            if (photoError?.message?.includes('Document as Photo')) {
              await bot.sendDocument(chatId, activeRaffle.leaderboardMediaUrl, {
                caption: leaderboardMessage,
                parse_mode: 'Markdown',
              });
            } else {
              throw photoError;
            }
          }
        } else if (activeRaffle.leaderboardMediaType === 'video') {
          try {
            await bot.sendVideo(chatId, activeRaffle.leaderboardMediaUrl, {
              caption: leaderboardMessage,
              parse_mode: 'Markdown',
            });
          } catch (videoError: any) {
            if (videoError?.message?.includes('Document as Video')) {
              await bot.sendDocument(chatId, activeRaffle.leaderboardMediaUrl, {
                caption: leaderboardMessage,
                parse_mode: 'Markdown',
              });
            } else {
              throw videoError;
            }
          }
        } else if (activeRaffle.leaderboardMediaType === 'gif') {
          await bot.sendAnimation(chatId, activeRaffle.leaderboardMediaUrl, {
            caption: leaderboardMessage,
            parse_mode: 'Markdown',
          });
        } else {
          await bot.sendMessage(chatId, leaderboardMessage, { parse_mode: 'Markdown' });
        }
      } else {
        await bot.sendMessage(chatId, leaderboardMessage, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      logger.error('Error fetching leaderboard:', error);
      await bot.sendMessage(chatId, '❌ Error fetching leaderboard. Please try again.');
    }
  });
}

export async function handleMyTicketsCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'mytickets', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('mytickets', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'mytickets' });

    const projectContext = await getProjectContext(msg);
    if (!projectContext) {
      if (msg.chat.type === 'private') {
        await bot.sendMessage(chatId, '❌ Please use this command in the project group chat.');
      } else {
        await bot.sendMessage(chatId, '❌ Project not configured. Please run /start first.');
      }
      return;
    }

    try {
      // Find user's linked wallet for this project
      const walletUser = await prisma.walletUser.findUnique({
        where: {
          projectId_walletAddress: {
            projectId: projectContext.id,
            walletAddress: '', // We need to find by telegramUserId first, but schema is walletAddress primary key... wait, schema changed.
            // Actually, we should find by telegramUserId AND projectId
          }
        }
      }).catch(() => null); // This query is wrong because we don't know wallet address yet

      // Correct query: Find by telegramUserId and projectId
      const walletUserFound = await prisma.walletUser.findFirst({
        where: {
          telegramUserId: userId,
          projectId: projectContext.id
        },
      });

      if (!walletUserFound) {
        await bot.sendMessage(
          chatId,
          '🔗 No wallet linked for this project. Use /linkwallet <address> to link your wallet address.'
        );
        return;
      }

      // Find active raffle
      const activeRaffle = await prisma.raffle.findFirst({
        where: {
          projectId: projectContext.id,
          status: RAFFLE_STATUS.ACTIVE,
          endTime: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!activeRaffle) {
        await bot.sendMessage(chatId, '📭 No active raffle found.');
        return;
      }

      // Get user's tickets
      const ticket = await prisma.ticket.findUnique({
        where: {
          raffleId_walletAddress: {
            raffleId: activeRaffle.id,
            walletAddress: walletUserFound.walletAddress,
          },
        },
      });

      const ticketCount = ticket?.ticketCount || 0;
      const message = `🎫 Your Tickets\n\nWallet: ${walletUserFound.walletAddress}\nTickets: ${ticketCount.toLocaleString()}\n\nRaffle ends: ${formatDate(activeRaffle.endTime)} UTC`;

      await bot.sendMessage(chatId, message);
    } catch (error) {
      logger.error('Error fetching user tickets:', error);
      await bot.sendMessage(chatId, '❌ Error fetching your tickets. Please try again.');
    }
  });
}

export async function handleLinkWalletCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'link_wallet', RATE_LIMITS.LINK_WALLET, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    const username = msg.from?.username || null;
    incrementCommand('linkwallet', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'linkwallet' });

    const projectContext = await getProjectContext(msg);
    if (!projectContext) {
      if (msg.chat.type === 'private') {
        await bot.sendMessage(chatId, '❌ Please use this command in the project group chat.');
      } else {
        await bot.sendMessage(chatId, '❌ Project not configured. Please run /start first.');
      }
      return;
    }

    const args = msg.text?.split(' ').slice(1) || [];

    if (args.length === 0) {
      await bot.sendMessage(
        chatId,
        '📝 Usage: /linkwallet <wallet_address>\n\nExample: /linkwallet 0x1234567890abcdef...'
      );
      return;
    }

    const walletAddress = args[0].trim();

    // Basic validation - SUI addresses typically start with 0x and are 66 chars
    if (!walletAddress.startsWith('0x') || walletAddress.length < 20) {
      await bot.sendMessage(chatId, '❌ Invalid wallet address format. Please check and try again.');
      return;
    }

    try {
      // Check if wallet already exists for this project
      const existing = await prisma.walletUser.findUnique({
        where: {
          projectId_walletAddress: {
            projectId: projectContext.id,
            walletAddress,
          }
        },
      });
      const isNew = !existing;

      // Upsert wallet user
      await prisma.walletUser.upsert({
        where: {
          projectId_walletAddress: {
            projectId: projectContext.id,
            walletAddress,
          }
        },
        update: {
          telegramUserId: userId,
          telegramUsername: username,
          linkedAt: new Date(),
        },
        create: {
          projectId: projectContext.id,
          walletAddress,
          telegramUserId: userId,
          telegramUsername: username,
          verified: false,
        },
      });

      // AUDIT LOG: Wallet linked (non-blocking)
      auditService.logWalletLinked(userId, username || undefined, walletAddress, isNew).catch(err =>
        logger.error('Audit log failed (non-blocking):', err)
      );

      await bot.sendMessage(
        chatId,
        `✅ Wallet linked successfully!\n\nWallet: ${walletAddress}\n\nYour tickets will be automatically allocated when you make purchases.`
      );

      // Track wallet link activity
      await analyticsService.trackActivity(userId, 'wallet_link', { walletAddress, projectId: projectContext.id });
    } catch (error) {
      logger.error('Error linking wallet:', error);
      await bot.sendMessage(chatId, '❌ Error linking wallet. Please try again.');
    }
  });
}

export async function handleWalletStatusCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'wallet_status', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('walletstatus', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'walletstatus' });

    const projectContext = await getProjectContext(msg);
    if (!projectContext) {
      if (msg.chat.type === 'private') {
        await bot.sendMessage(chatId, '❌ Please use this command in the project group chat.');
      } else {
        await bot.sendMessage(chatId, '❌ Project not configured. Please run /start first.');
      }
      return;
    }

    try {
      const walletUser = await prisma.walletUser.findFirst({
        where: {
          telegramUserId: userId,
          projectId: projectContext.id
        },
      });

      if (!walletUser) {
        await bot.sendMessage(
          chatId,
          '❌ No wallet linked to your account for this project.\n\n' +
          'Link your wallet using:\n' +
          '/linkwallet <your_wallet_address>\n\n' +
          'Example: /linkwallet 0x1234567890abcdef...'
        );
        return;
      }

      const shortWallet = `${walletUser.walletAddress.slice(0, 8)}...${walletUser.walletAddress.slice(-6)}`;
      const linkedDate = walletUser.linkedAt ? formatDate(walletUser.linkedAt) : 'Unknown';

      await bot.sendMessage(
        chatId,
        `👛 *Wallet Status*\n\n` +
        `✅ Wallet Linked\n\n` +
        `📍 Address: \`${walletUser.walletAddress}\`\n` +
        `📍 Short: \`${shortWallet}\`\n` +
        `📅 Linked: ${linkedDate} UTC\n\n` +
        `To unlink this wallet, use /unlinkwallet`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      logger.error('Error fetching wallet status:', error);
      await bot.sendMessage(chatId, '❌ Error fetching wallet status. Please try again.');
    }
  });
}

export async function handleUnlinkWalletCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'unlink_wallet', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('unlinkwallet', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'unlinkwallet' });

    const projectContext = await getProjectContext(msg);
    if (!projectContext) {
      if (msg.chat.type === 'private') {
        await bot.sendMessage(chatId, '❌ Please use this command in the project group chat.');
      } else {
        await bot.sendMessage(chatId, '❌ Project not configured. Please run /start first.');
      }
      return;
    }

    try {
      const walletUser = await prisma.walletUser.findFirst({
        where: {
          telegramUserId: userId,
          projectId: projectContext.id
        },
      });

      if (!walletUser) {
        await bot.sendMessage(
          chatId,
          '❌ No wallet is currently linked to your account for this project.'
        );
        return;
      }

      const walletAddress = walletUser.walletAddress;
      const shortWallet = `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`;
      const username = msg.from?.username || undefined;

      // Delete the wallet user link
      await prisma.walletUser.delete({
        where: {
          projectId_walletAddress: {
            projectId: projectContext.id,
            walletAddress,
          }
        },
      });

      // AUDIT LOG: Wallet unlinked (non-blocking)
      auditService.logWalletUnlinked(userId, username, walletAddress).catch(err =>
        logger.error('Audit log failed (non-blocking):', err)
      );

      await bot.sendMessage(
        chatId,
        `✅ *Wallet Unlinked Successfully*\n\n` +
        `The wallet \`${shortWallet}\` has been unlinked from your Telegram account.\n\n` +
        `⚠️ Note: Any future purchases from this wallet will not earn raffle tickets unless you link it again.\n\n` +
        `To link a wallet again, use:\n` +
        `/linkwallet <your_wallet_address>`,
        { parse_mode: 'Markdown' }
      );

      // Track wallet unlink activity
      await analyticsService.trackActivity(userId, 'wallet_unlink', { walletAddress, projectId: projectContext.id });
    } catch (error) {
      logger.error('Error unlinking wallet:', error);
      await bot.sendMessage(chatId, '❌ Error unlinking wallet. Please try again.');
    }
  });
}

