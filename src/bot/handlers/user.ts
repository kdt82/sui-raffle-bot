import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';
import { RAFFLE_STATUS } from '../../utils/constants';
import { withRateLimit } from '../rate-limit-middleware';
import { RATE_LIMITS } from '../../utils/rate-limiter';
import { incrementCommand } from '../../utils/metrics';
import { analyticsService } from '../../services/analytics-service';

export async function handleStartCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'start', RATE_LIMITS.USER_COMMAND, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('start', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'start' });
    
    const welcomeMessage = `
🎰 Welcome to the SUI Raffle Bot!

Here's how it works:
• Buy tokens and automatically get raffle tickets (100 tickets per token)
• Check your tickets with /mytickets
• View the leaderboard with /leaderboard
• Link your wallet with /linkwallet <address>

🎁 Prizes are awarded at the end of each raffle period!

Commands:
/start - Show this message
/leaderboard - View current raffle leaderboard
/mytickets - Check your ticket count
/linkwallet <address> - Link your wallet address

Good luck! 🍀
    `.trim();

    await bot.sendMessage(chatId, welcomeMessage);
  });
}

export async function handleLeaderboardCommand(msg: TelegramBot.Message): Promise<void> {
  return withRateLimit(msg, 'leaderboard', RATE_LIMITS.LEADERBOARD, async () => {
    const chatId = msg.chat.id;
    const userId = BigInt(msg.from!.id);
    incrementCommand('leaderboard', false);
    await analyticsService.trackActivity(userId, 'command', { command: 'leaderboard' });

    try {
    // Find active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '📭 No active raffle found.');
      return;
    }

    // Get top 10 tickets
    const topTickets = await prisma.ticket.findMany({
      where: {
        raffleId: activeRaffle.id,
        ticketCount: { gt: 0 },
      },
      orderBy: { ticketCount: 'desc' },
      take: 10,
    });

    if (topTickets.length === 0) {
      await bot.sendMessage(chatId, '📊 No tickets allocated yet. Buy tokens to get started!');
      return;
    }

    let leaderboardMessage = '🏆 **Leaderboard**\n\n';
    leaderboardMessage += `Raffle ends: ${activeRaffle.endTime.toLocaleString()}\n\n`;

    topTickets.forEach((ticket, index) => {
      const rank = index + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
      leaderboardMessage += `${medal} ${ticket.walletAddress.slice(0, 8)}...${ticket.walletAddress.slice(-6)} - ${ticket.ticketCount.toLocaleString()} tickets\n`;
    });

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

    try {
    // Find user's linked wallet
    const walletUser = await prisma.walletUser.findFirst({
      where: { telegramUserId: userId },
    });

    if (!walletUser) {
      await bot.sendMessage(
        chatId,
        '🔗 No wallet linked. Use /linkwallet <address> to link your wallet address.'
      );
      return;
    }

    // Find active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
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
          walletAddress: walletUser.walletAddress,
        },
      },
    });

    const ticketCount = ticket?.ticketCount || 0;
    const message = `🎫 Your Tickets\n\nWallet: ${walletUser.walletAddress}\nTickets: ${ticketCount.toLocaleString()}\n\nRaffle ends: ${activeRaffle.endTime.toLocaleString()}`;

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
    // Upsert wallet user
    await prisma.walletUser.upsert({
      where: { walletAddress },
      update: {
        telegramUserId: userId,
        telegramUsername: username,
        linkedAt: new Date(),
      },
      create: {
        walletAddress,
        telegramUserId: userId,
        telegramUsername: username,
        verified: false,
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ Wallet linked successfully!\n\nWallet: ${walletAddress}\n\nYour tickets will be automatically allocated when you make purchases.`
    );

    // Track wallet link activity
    await analyticsService.trackActivity(userId, 'wallet_link', { walletAddress });
    } catch (error) {
      logger.error('Error linking wallet:', error);
      await bot.sendMessage(chatId, '❌ Error linking wallet. Please try again.');
    }
  });
}

