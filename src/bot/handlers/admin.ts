import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';
import { PRIZE_TYPES, RAFFLE_STATUS, MEDIA_TYPES, DEX_OPTIONS, formatDate } from '../../utils/constants';
import { handleCreateRaffleUI, handleCreateRaffleStep } from './admin-ui';
import { conversationManager } from '../conversation';
import { auditService } from '../../services/audit-service';

// Re-export UI handler
export { handleCreateRaffleUI, handleCreateRaffleStep } from './admin-ui';

export async function handleCancelRaffle(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    // Find active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
      },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle to cancel.');
      return;
    }

    // Update raffle status to ended (or we could add a 'cancelled' status)
    await prisma.raffle.update({
      where: { id: activeRaffle.id },
      data: { 
        status: 'cancelled',
        updatedAt: new Date(),
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ Raffle Cancelled Successfully!\n\n` +
      `Raffle ID: ${activeRaffle.id}\n` +
      `Contract: ${activeRaffle.ca.slice(0, 10)}...${activeRaffle.ca.slice(-6)}\n` +
      `DEX: ${activeRaffle.dex.toUpperCase()}\n` +
      `Prize: ${activeRaffle.prizeAmount} ${activeRaffle.prizeType}\n\n` +
      `The raffle has been cancelled and buy detection has stopped.`
    );

    logger.info(`Raffle cancelled: ${activeRaffle.id}`);
  } catch (error) {
    logger.error('Error cancelling raffle:', error);
    await bot.sendMessage(chatId, '❌ Failed to cancel raffle. Please try again.');
  }
}

export async function handleCreateRaffle(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const args = msg.text?.split(' ').slice(1) || [];

  // Check if user is in a conversation
  const conversation = conversationManager.getConversation(userId, chatId);
  if (conversation && conversation.step.startsWith('create_raffle')) {
    await handleCreateRaffleStep(msg, conversation.step, conversation.data);
    return;
  }

  // If no args, use UI mode
  if (args.length === 0) {
    await handleCreateRaffleUI(msg);
    return;
  }

  // Otherwise, use command mode with args (keeping original implementation)
  if (args.length < 4) {
    await bot.sendMessage(
      chatId,
      `📝 Usage: /create_raffle <contract_address> <dex> <end_time> <prize_type> <prize_amount>\n\n` +
      `Example: /create_raffle 0x123... cetus 2024-12-31T23:59:59 SUI 1000\n\n` +
      `Or use /create_raffle without arguments for interactive mode.\n\n` +
      `DEX options: ${DEX_OPTIONS.join(', ')}\n` +
      `Prize types: ${PRIZE_TYPES.join(', ')}\n` +
      `End time format: YYYY-MM-DDTHH:mm:ss`
    );
    return;
  }

  const [ca, dex, endTimeStr, prizeType, prizeAmount] = args;

  if (!DEX_OPTIONS.includes(dex.toLowerCase() as any)) {
    await bot.sendMessage(chatId, `❌ Invalid DEX. Must be one of: ${DEX_OPTIONS.join(', ')}`);
    return;
  }

  if (!PRIZE_TYPES.includes(prizeType as any)) {
    await bot.sendMessage(chatId, `❌ Invalid prize type. Must be one of: ${PRIZE_TYPES.join(', ')}`);
    return;
  }

  try {
    const endTime = new Date(endTimeStr);
    if (isNaN(endTime.getTime())) {
      await bot.sendMessage(chatId, '❌ Invalid date format. Use: YYYY-MM-DDTHH:mm:ss');
      return;
    }

    if (endTime <= new Date()) {
      await bot.sendMessage(chatId, '❌ End time must be in the future.');
      return;
    }

    // Check if there's already an active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
    });

    if (activeRaffle) {
      await bot.sendMessage(
        chatId,
        `❌ There is already an active raffle. End it first or wait for it to complete.\n\n` +
        `Active raffle ID: ${activeRaffle.id}`
      );
      return;
    }

    const raffle = await prisma.raffle.create({
      data: {
        ca,
        dex: dex.toLowerCase(),
        startTime: new Date(),
        endTime,
        prizeType,
        prizeAmount,
        status: RAFFLE_STATUS.ACTIVE,
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ Raffle created successfully!\n\n` +
      `Raffle ID: ${raffle.id}\n` +
      `Contract Address: ${ca}\n` +
      `DEX: ${dex.toUpperCase()}\n` +
      `Ends: ${endTime.toLocaleString()}\n` +
      `Prize: ${prizeAmount} ${prizeType}`
    );
  } catch (error) {
    logger.error('Error creating raffle:', error);
    await bot.sendMessage(chatId, '❌ Error creating raffle. Please try again.');
  }
}

export async function handleSetPrize(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length < 2) {
    await bot.sendMessage(
      chatId,
      `📝 Usage: /set_prize <prize_type> <prize_amount>\n\n` +
      `Example: /set_prize USDC 500\n\n` +
      `Prize types: ${PRIZE_TYPES.join(', ')}`
    );
    return;
  }

  const [prizeType, prizeAmount] = args;

  if (!PRIZE_TYPES.includes(prizeType as any)) {
    await bot.sendMessage(chatId, `❌ Invalid prize type. Must be one of: ${PRIZE_TYPES.join(', ')}`);
    return;
  }

  try {
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found.');
      return;
    }

    await prisma.raffle.update({
      where: { id: activeRaffle.id },
      data: {
        prizeType,
        prizeAmount,
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ Prize updated!\n\n` +
      `Raffle ID: ${activeRaffle.id}\n` +
      `Prize: ${prizeAmount} ${prizeType}`
    );
  } catch (error) {
    logger.error('Error setting prize:', error);
    await bot.sendMessage(chatId, '❌ Error setting prize. Please try again.');
  }
}

export async function handleSetMinimumPurchase(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length === 0) {
    await bot.sendMessage(
      chatId,
      `📝 **Set Minimum Purchase**\n\n` +
      `Usage: \`/set_minimum_purchase <amount>\`\n\n` +
      `Set the minimum token purchase amount to earn tickets.\n` +
      `Purchases below this amount will not earn tickets.\n\n` +
      `**Examples:**\n` +
      `• \`/set_minimum_purchase 10\` - Set minimum to 10 tokens\n` +
      `• \`/set_minimum_purchase 0.5\` - Set minimum to 0.5 tokens\n` +
      `• \`/set_minimum_purchase 0\` - Remove minimum\n\n` +
      `⚠️ **Note:** Amount should be in **token units** (not raw units)\n` +
      `For example, if your token has 9 decimals:\n` +
      `• 1 token = 1,000,000,000 raw units\n` +
      `• Use "1" not "1000000000"`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const minimumAmount = args[0];

  if (isNaN(parseFloat(minimumAmount)) || parseFloat(minimumAmount) < 0) {
    await bot.sendMessage(chatId, '❌ Invalid amount. Must be a number greater than or equal to 0.');
    return;
  }

  try {
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found.');
      return;
    }

    const minimumValue = parseFloat(minimumAmount) === 0 ? null : minimumAmount;

    await prisma.raffle.update({
      where: { id: activeRaffle.id },
      data: {
        minimumPurchase: minimumValue,
      },
    });

    const message = minimumValue
      ? `✅ **Minimum purchase updated!**\n\n` +
        `Raffle ID: \`${activeRaffle.id}\`\n` +
        `Minimum Purchase: **${minimumValue} tokens**\n\n` +
        `Purchases below this amount will not earn tickets.\n\n` +
        `To remove the minimum, use: \`/set_minimum_purchase 0\``
      : `✅ **Minimum purchase removed!**\n\n` +
        `Raffle ID: \`${activeRaffle.id}\`\n` +
        `All purchases will now earn tickets.\n\n` +
        `To set a minimum, use: \`/set_minimum_purchase <amount>\``;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error setting minimum purchase:', error);
    await bot.sendMessage(chatId, '❌ Error setting minimum purchase. Please try again.');
  }
}

export async function handleUploadMedia(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  let mediaFileId: string | undefined;
  let mediaType: string | undefined;

  // Check for photo
  if (msg.photo && msg.photo.length > 0) {
    const largestPhoto = msg.photo[msg.photo.length - 1];
    mediaFileId = largestPhoto.file_id;
    mediaType = MEDIA_TYPES.IMAGE;
  }
  // Check for video
  else if (msg.video) {
    mediaFileId = msg.video.file_id;
    mediaType = MEDIA_TYPES.VIDEO;
  }
  // Check for animation (GIF)
  else if (msg.animation) {
    mediaFileId = msg.animation.file_id;
    mediaType = MEDIA_TYPES.GIF;
  }
  else {
    await bot.sendMessage(
      chatId,
      '📸 Please send an image, video, or GIF to upload.\n\n' +
      'Reply to this message with the media file.'
    );
    return;
  }

  try {
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found.');
      return;
    }

    await prisma.raffle.update({
      where: { id: activeRaffle.id },
      data: {
        mediaUrl: mediaFileId,
        mediaType,
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ Media uploaded successfully!\n\n` +
      `Type: ${mediaType}\n` +
      `Raffle ID: ${activeRaffle.id}`
    );
  } catch (error) {
    logger.error('Error uploading media:', error);
    await bot.sendMessage(chatId, '❌ Error uploading media. Please try again.');
  }
}

export async function handleAwardPrize(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    // Parse command arguments: /award_prize <txhash or link>
    const args = msg.text?.split(' ').slice(1);
    const txInput = args?.[0];

    if (!txInput) {
      await bot.sendMessage(
        chatId,
        '❌ *Missing transaction hash*\n\n' +
        '*Usage:* `/award_prize <txhash>`\n\n' +
        '*Examples:*\n' +
        '`/award_prize A1B2C3...`\n' +
        '`/award_prize https://suiscan.xyz/mainnet/tx/A1B2C3...`\n\n' +
        'Please provide the transaction hash or SuiScan link for the prize transfer.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Extract transaction hash from URL or use as-is
    let txHash = txInput;
    if (txInput.includes('suiscan.xyz') || txInput.includes('suivision.xyz') || txInput.includes('explorer.sui.io')) {
      // Extract hash from URL
      const match = txInput.match(/\/tx\/([A-Za-z0-9]+)/);
      if (match) {
        txHash = match[1];
      }
    }

    const endedRaffle = await prisma.raffle.findFirst({
      where: {
        status: { in: [RAFFLE_STATUS.ENDED, RAFFLE_STATUS.WINNER_SELECTED] },
      },
      orderBy: { endTime: 'desc' },
      include: {
        winners: true,
      },
    });

    if (!endedRaffle) {
      await bot.sendMessage(chatId, '❌ No ended raffle found.');
      return;
    }

    if (endedRaffle.winners.length === 0) {
      await bot.sendMessage(chatId, '❌ No winner selected for this raffle yet.');
      return;
    }

    const winner = endedRaffle.winners[0];

    if (winner.prizeAwarded) {
      const txLink = winner.awardTxHash 
        ? `\n🔗 [View Transaction](https://suiscan.xyz/mainnet/tx/${winner.awardTxHash})`
        : '';
      
      await bot.sendMessage(
        chatId,
        `✅ *Prize already awarded!*\n\n` +
        `*Winner:* \`${winner.walletAddress}\`\n` +
        `*Tickets:* ${winner.ticketCount.toLocaleString()}\n` +
        `*Awarded:* ${formatDate(winner.awardedAt!)} UTC${txLink}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Update winner with transaction hash
    await prisma.winner.update({
      where: { id: winner.id },
      data: {
        prizeAwarded: true,
        awardedAt: new Date(),
        awardTxHash: txHash,
      },
    });

    // Format SuiScan link
    const suiscanLink = `https://suiscan.xyz/mainnet/tx/${txHash}`;

    await bot.sendMessage(
      chatId,
      `✅ *Prize Marked as Awarded!*\n\n` +
      `*Raffle Details:*\n` +
      `ID: \`${endedRaffle.id}\`\n` +
      `Prize: ${endedRaffle.prizeAmount} ${endedRaffle.prizeType}\n\n` +
      `*Winner:*\n` +
      `Wallet: \`${winner.walletAddress}\`\n` +
      `Tickets: ${winner.ticketCount.toLocaleString()}\n\n` +
      `*Transaction:*\n` +
      `🔗 [View on SuiScan](${suiscanLink})\n` +
      `Hash: \`${txHash}\`\n\n` +
      `Prize award recorded. Winner announcement sent to broadcast channel.`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );

    // AUDIT LOG: Prize awarded (non-blocking)
    auditService.logPrizeAwarded(
      BigInt(msg.from!.id),
      msg.from!.username,
      endedRaffle.id,
      winner.walletAddress
    ).catch(err =>
      logger.error('Audit log failed (non-blocking):', err)
    );

  } catch (error) {
    logger.error('Error awarding prize:', error);
    await bot.sendMessage(chatId, '❌ Error awarding prize. Please try again.');
  }
}

export async function handleShowWinner(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    logger.info('handleShowWinner called');

    // Get raffle ID from command or use most recent ended raffle
    const args = msg.text?.split(' ').slice(1);
    let raffleId = args?.[0];

    logger.info(`Looking for raffle: ${raffleId || 'most recent ended'}`);

    let raffle;
    if (raffleId) {
      raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
        include: {
          winners: true,
          _count: {
            select: { tickets: true }
          }
        },
      });

      if (!raffle) {
        await bot.sendMessage(chatId, '❌ Raffle not found.');
        return;
      }
    } else {
      // Get most recent ended raffle
      raffle = await prisma.raffle.findFirst({
        where: {
          status: { in: [RAFFLE_STATUS.ENDED, RAFFLE_STATUS.WINNER_SELECTED] },
        },
        orderBy: { endTime: 'desc' },
        include: {
          winners: true,
          _count: {
            select: { tickets: true }
          }
        },
      });

      if (!raffle) {
        logger.info('No ended raffle found');
        await bot.sendMessage(chatId, '❌ No ended raffle found. Create a raffle first using /create_raffle');
        return;
      }
    }

    logger.info(`Found raffle: ${raffle.id}, winners: ${raffle.winners.length}`);

    if (raffle.winners.length === 0) {
      await bot.sendMessage(
        chatId,
        `📊 Raffle Information\n\n` +
        `Raffle ID: ${raffle.id}\n` +
        `Status: ${raffle.status}\n` +
        `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
        `Ended: ${formatDate(raffle.endTime)} UTC\n\n` +
        `⏳ No winner selected yet. Use /select_winner to select a winner.`
      );
      return;
    }

    const winner = raffle.winners[0];
    logger.info(`Winner found: ${winner.walletAddress}`);

    // Get total tickets for the raffle
    const totalTicketsResult = await prisma.ticket.aggregate({
      where: { raffleId: raffle.id },
      _sum: { ticketCount: true },
      _count: true,
    });

    const totalTickets = totalTicketsResult._sum.ticketCount || 0;
    const totalParticipants = totalTicketsResult._count || 0;
    const winnerPercentage = totalTickets > 0 
      ? ((winner.ticketCount / totalTickets) * 100).toFixed(2)
      : '0';

    const statusEmoji = winner.prizeAwarded ? '✅' : '⏳';
    const awardedText = winner.prizeAwarded && winner.awardedAt
      ? `\n📅 Awarded: ${formatDate(winner.awardedAt)} UTC`
      : '\n⏳ Prize not yet awarded';

    // Build transaction link if available
    const txSection = winner.awardTxHash
      ? `\n🔗 [View Transaction](https://suiscan.xyz/mainnet/tx/${winner.awardTxHash})`
      : '';

    // Build randomness proof section
    let randomnessSection = '';
    if (winner.selectionMethod === 'on-chain' && winner.randomnessEpoch) {
      randomnessSection = `\n\n*🔐 Randomness Proof:*\n` +
        `Method: SUI On-Chain Randomness\n` +
        `Blockchain Epoch: ${winner.randomnessEpoch}\n` +
        `This winner was selected using verifiable on-chain randomness from the SUI blockchain.`;
    } else if (winner.selectionMethod === 'client-side') {
      randomnessSection = `\n\n*🔐 Selection Method:*\n` +
        `Weighted Random (Client-side)`;
    }

    logger.info('Sending winner message');

    await bot.sendMessage(
      chatId,
      `🏆 *Raffle Winner*\n\n` +
      `${statusEmoji} *Status:* ${winner.prizeAwarded ? 'Prize Awarded' : 'Pending Award'}\n\n` +
      `*Raffle Details:*\n` +
      `ID: \`${raffle.id}\`\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
      `Ended: ${formatDate(raffle.endTime)} UTC\n\n` +
      `*Winner Details:*\n` +
      `Wallet: \`${winner.walletAddress}\`\n` +
      `Tickets: ${winner.ticketCount.toLocaleString()} (${winnerPercentage}% of total)\n` +
      `Selected: ${formatDate(winner.selectedAt)} UTC${awardedText}${txSection}${randomnessSection}\n\n` +
      `*Raffle Stats:*\n` +
      `Total Participants: ${totalParticipants}\n` +
      `Total Tickets: ${totalTickets.toLocaleString()}\n\n` +
      `${!winner.prizeAwarded ? '💡 Use /award_prize <txhash> to mark as awarded' : ''}`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );

    logger.info('Winner message sent successfully');

  } catch (error) {
    logger.error('Error in handleShowWinner:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    try {
      await bot.sendMessage(
        chatId, 
        `❌ Error retrieving winner information.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check logs for details.`
      );
    } catch (sendError) {
      logger.error('Failed to send error message:', sendError);
    }
  }
}

export async function handleSelectWinner(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    logger.info('handleSelectWinner called');

    // Get raffle ID from command or use most recent ended raffle
    const args = msg.text?.split(' ').slice(1);
    let raffleId = args?.[0];

    logger.info(`Looking for raffle to select winner: ${raffleId || 'most recent ended'}`);

    let raffle;
    if (raffleId) {
      raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
        include: {
          winners: true,
        },
      });

      if (!raffle) {
        await bot.sendMessage(chatId, '❌ Raffle not found.');
        return;
      }
    } else {
      // Get most recent ended raffle without a winner
      raffle = await prisma.raffle.findFirst({
        where: {
          status: RAFFLE_STATUS.ENDED,
        },
        orderBy: { endTime: 'desc' },
        include: {
          winners: true,
        },
      });

      if (!raffle) {
        logger.info('No ended raffle without winner found');
        await bot.sendMessage(chatId, '❌ No ended raffle found that needs a winner.');
        return;
      }
    }

    logger.info(`Found raffle: ${raffle.id}, existing winners: ${raffle.winners.length}`);

    // Check if winner already selected
    if (raffle.winners.length > 0) {
      await bot.sendMessage(
        chatId,
        `❌ Winner already selected for this raffle!\n\n` +
        `Use /winner to view the winner details.`
      );
      return;
    }

    // Check if raffle has ended
    if (raffle.endTime > new Date() && raffle.status !== RAFFLE_STATUS.ENDED) {
      await bot.sendMessage(
        chatId,
        `❌ Cannot select winner - raffle has not ended yet.\n\n` +
        `Raffle ends: ${formatDate(raffle.endTime)} UTC\n` +
        `Current time: ${formatDate(new Date())} UTC`
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `🎲 Selecting winner for raffle...\n\n` +
      `Raffle ID: ${raffle.id}\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n\n` +
      `Please wait...`
    );

    logger.info('Importing selectWinner function');

    // Import selectWinner function
    const { selectWinner } = await import('../../services/winner-service');
    
    logger.info('Calling selectWinner');

    // Select the winner
    await selectWinner(raffle.id);

    logger.info('Winner selected, fetching winner record');

    // Get the selected winner
    const winner = await prisma.winner.findFirst({
      where: { raffleId: raffle.id },
      orderBy: { selectedAt: 'desc' },
    });

    if (winner) {
      logger.info(`Winner confirmation: ${winner.walletAddress}`);

      // Build randomness proof section
      let randomnessSection = '';
      if (winner.selectionMethod === 'on-chain' && winner.randomnessEpoch) {
        randomnessSection = `\n*🔐 Randomness Proof:*\n` +
          `Method: SUI On-Chain Randomness\n` +
          `Blockchain Epoch: ${winner.randomnessEpoch}\n\n`;
      } else if (winner.selectionMethod) {
        randomnessSection = `\n*Selection Method:* ${winner.selectionMethod}\n\n`;
      }

      await bot.sendMessage(
        chatId,
        `🎉 *Winner Selected!*\n\n` +
        `*Winner Details:*\n` +
        `Wallet: \`${winner.walletAddress}\`\n` +
        `Tickets: ${winner.ticketCount.toLocaleString()}\n` +
        randomnessSection +
        `*Raffle Details:*\n` +
        `ID: \`${raffle.id}\`\n` +
        `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n\n` +
        `The winner has been announced in the broadcast channel.\n\n` +
        `Use /award_prize <txhash> to mark the prize as awarded.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      logger.warn('No winner record found after selection');
      await bot.sendMessage(
        chatId,
        `⚠️ Winner selection completed, but no winner record found.\n\n` +
        `This may happen if there were no tickets for this raffle.\n` +
        `Use /winner to check the status.`
      );
    }

  } catch (error) {
    logger.error('Error in handleSelectWinner:', error);
    logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    try {
      await bot.sendMessage(
        chatId,
        `❌ Error selecting winner.\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check the logs and try again.`
      );
    } catch (sendError) {
      logger.error('Failed to send error message:', sendError);
    }
  }
}

export async function handleConfig(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            tickets: true,
            buyEvents: true,
          },
        },
      },
    }).catch((err) => {
      logger.error('Prisma query error in config:', err);
      throw new Error('Database query failed - schema might be out of sync');
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '📭 No active raffle found.');
      return;
    }

    const totalTickets = await prisma.ticket.aggregate({
      where: { raffleId: activeRaffle.id },
      _sum: { ticketCount: true },
    }).catch((err) => {
      logger.error('Prisma aggregate error in config:', err);
      return { _sum: { ticketCount: 0 } };
    });

    const minimumText = activeRaffle.minimumPurchase 
      ? `Minimum Purchase: ${activeRaffle.minimumPurchase} tokens` 
      : 'Minimum Purchase: None (all purchases earn tickets)';

    const configMessage = `⚙️ **Raffle Configuration**\n\n` +
      `**ID:** \`${activeRaffle.id}\`\n` +
      `**Contract Address:** \`${activeRaffle.ca}\`\n` +
      `**DEX:** ${activeRaffle.dex.toUpperCase()}\n` +
      `**Start Time:** ${activeRaffle.startTime.toLocaleString()}\n` +
      `**End Time:** ${activeRaffle.endTime.toLocaleString()}\n` +
      `**Prize:** ${activeRaffle.prizeAmount} ${activeRaffle.prizeType}\n` +
      `**${minimumText}**\n` +
      `**Status:** ${activeRaffle.status}\n\n` +
      `📊 **Statistics:**\n` +
      `• Total Buy Events: ${activeRaffle._count.buyEvents}\n` +
      `• Total Tickets: ${totalTickets._sum.ticketCount || 0}\n` +
      `• Unique Wallets: ${activeRaffle._count.tickets}\n\n` +
      `🔧 **Available Commands:**\n` +
      `• \`/set_prize <type> <amount>\` - Change prize\n` +
      `• \`/set_minimum_purchase <amount>\` - Change minimum (0 to remove)\n` +
      `• \`/upload_media\` - Add/change raffle media\n` +
      `• \`/reset_tickets\` - Reset all tickets (testing only)\n` +
      `• \`/award_prize\` - Mark prize as awarded`;

    await bot.sendMessage(chatId, configMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('Error fetching config:', error);
    
    // Provide more detailed error message
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await bot.sendMessage(
      chatId, 
      `❌ Error fetching configuration.\n\n` +
      `This usually means the database schema needs to be updated.\n` +
      `The bot is redeploying now - please try again in 2-3 minutes.\n\n` +
      `Error: ${errorMsg}`
    );
  }
}

export async function handleChatInfo(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    // Get chat information
    const chat = msg.chat;
    const chatType = chat.type;
    const chatTitle = chat.title || 'N/A';
    const chatUsername = (chat as any).username ? `@${(chat as any).username}` : 'N/A';
    
    // Log to server for easy copy-paste
    logger.info(`📍 CHAT INFO - ID: ${chatId}, Type: ${chatType}, Title: ${chatTitle}, Username: ${chatUsername}`);

    const infoMessage =
      `📍 **Chat Information** 📍\n\n` +
      `**Chat ID:** \`${chatId}\`\n` +
      `**Chat Type:** \`${chatType}\`\n` +
      `**Title:** \`${chatTitle}\`\n` +
      `**Username:** \`${chatUsername}\`\n\n` +
      `💡 **To use this chat for broadcast notifications:**\n` +
      `1. Add this variable to Railway:\n` +
      `   \`BROADCAST_CHANNEL_ID=${chatId}\`\n` +
      `2. Restart the service\n` +
      `3. Buy notifications will appear here!\n\n` +
      `_Note: Make sure the bot is an admin if this is a channel._`;

    await bot.sendMessage(chatId, infoMessage, { parse_mode: 'Markdown' });
    logger.info(`Admin requested chat info for ${chatId}`);
  } catch (error) {
    logger.error('Error fetching chat info:', error);
    await bot.sendMessage(chatId, '❌ Failed to fetch chat information. Please try again.');
  }
}

export async function handleResetTickets(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    // Find active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
      },
      include: {
        tickets: true,
        buyEvents: true,
      },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found to reset tickets.');
      return;
    }

    const ticketCount = activeRaffle.tickets.length;
    const buyEventCount = activeRaffle.buyEvents.length;

    // Delete all tickets for this raffle
    await prisma.ticket.deleteMany({
      where: { raffleId: activeRaffle.id },
    });

    // Delete all buy events for this raffle
    await prisma.buyEvent.deleteMany({
      where: { raffleId: activeRaffle.id },
    });

    await bot.sendMessage(
      chatId,
      `✅ *Tickets Reset Successfully!*\n\n` +
      `🎫 Deleted ${ticketCount} ticket records\n` +
      `📊 Deleted ${buyEventCount} buy events\n\n` +
      `Raffle ID: \`${activeRaffle.id}\`\n` +
      `Contract: \`${activeRaffle.ca.slice(0, 10)}...${activeRaffle.ca.slice(-6)}\`\n` +
      `DEX: ${activeRaffle.dex.toUpperCase()}\n\n` +
      `The raffle is still active and will continue to track new buys.`,
      { parse_mode: 'Markdown' }
    );

    logger.info(`Admin reset tickets for raffle: ${activeRaffle.id} (${ticketCount} tickets, ${buyEventCount} events)`);
  } catch (error) {
    logger.error('Error resetting tickets:', error);
    await bot.sendMessage(chatId, '❌ Failed to reset tickets. Please try again.');
  }
}

export async function handleAddTickets(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1);

  if (!args || args.length < 2) {
    await bot.sendMessage(
      chatId,
      '❌ *Invalid Command Format*\n\n' +
      '*Usage:* `/add_tickets <wallet_address> <ticket_count>`\n\n' +
      '*Example:* `/add_tickets 0x1234...abcd 500`\n\n' +
      'This will add tickets to the user for the active raffle.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const walletAddress = args[0].trim();
  const ticketCount = parseInt(args[1]);

  if (isNaN(ticketCount) || ticketCount <= 0) {
    await bot.sendMessage(chatId, '❌ Ticket count must be a positive number.');
    return;
  }

  try {
    // Find active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        startTime: { lte: new Date() },
        endTime: { gt: new Date() },
      },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found.');
      return;
    }

    // Find or create ticket record
    const existingTicket = await prisma.ticket.findUnique({
      where: {
        raffleId_walletAddress: {
          raffleId: activeRaffle.id,
          walletAddress: walletAddress,
        },
      },
    });

    if (existingTicket) {
      // Update existing tickets
      const updatedTicket = await prisma.ticket.update({
        where: { id: existingTicket.id },
        data: {
          ticketCount: existingTicket.ticketCount + ticketCount,
        },
      });

      await bot.sendMessage(
        chatId,
        `✅ *Tickets Added Successfully!*\n\n` +
        `👤 Wallet: \`${walletAddress}\`\n` +
        `➕ Added: *${ticketCount}* tickets\n` +
        `🎫 Previous: ${existingTicket.ticketCount} tickets\n` +
        `🎫 New Total: *${updatedTicket.ticketCount}* tickets\n\n` +
        `Raffle ID: \`${activeRaffle.id}\``,
        { parse_mode: 'Markdown' }
      );

      logger.info(`Admin added ${ticketCount} tickets to ${walletAddress} for raffle ${activeRaffle.id}. New total: ${updatedTicket.ticketCount}`);
    } else {
      // Create new ticket record
      const newTicket = await prisma.ticket.create({
        data: {
          raffleId: activeRaffle.id,
          walletAddress: walletAddress,
          ticketCount: ticketCount,
        },
      });

      await bot.sendMessage(
        chatId,
        `✅ *Tickets Added Successfully!*\n\n` +
        `👤 Wallet: \`${walletAddress}\`\n` +
        `🎫 Total Tickets: *${newTicket.ticketCount}*\n\n` +
        `Raffle ID: \`${activeRaffle.id}\`\n\n` +
        `_This is a new participant in the raffle._`,
        { parse_mode: 'Markdown' }
      );

      logger.info(`Admin created ticket record with ${ticketCount} tickets for ${walletAddress} in raffle ${activeRaffle.id}`);
    }
  } catch (error) {
    logger.error('Error adding tickets:', error);
    await bot.sendMessage(chatId, '❌ Failed to add tickets. Please check the wallet address format and try again.');
  }
}

export async function handleRemoveTickets(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1);

  if (!args || args.length < 2) {
    await bot.sendMessage(
      chatId,
      '❌ *Invalid Command Format*\n\n' +
      '*Usage:* `/remove_tickets <wallet_address> <ticket_count>`\n\n' +
      '*Example:* `/remove_tickets 0x1234...abcd 100`\n\n' +
      'This will remove tickets from the user for the active raffle.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const walletAddress = args[0].trim();
  const ticketCount = parseInt(args[1]);

  if (isNaN(ticketCount) || ticketCount <= 0) {
    await bot.sendMessage(chatId, '❌ Ticket count must be a positive number.');
    return;
  }

  try {
    // Find active raffle
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        startTime: { lte: new Date() },
        endTime: { gt: new Date() },
      },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found.');
      return;
    }

    // Find existing ticket record
    const existingTicket = await prisma.ticket.findUnique({
      where: {
        raffleId_walletAddress: {
          raffleId: activeRaffle.id,
          walletAddress: walletAddress,
        },
      },
    });

    if (!existingTicket) {
      await bot.sendMessage(
        chatId,
        `❌ No tickets found for wallet: \`${walletAddress}\` in the active raffle.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const newTicketCount = existingTicket.ticketCount - ticketCount;

    if (newTicketCount <= 0) {
      // Delete the ticket record entirely
      await prisma.ticket.delete({
        where: { id: existingTicket.id },
      });

      await bot.sendMessage(
        chatId,
        `✅ *Tickets Removed Successfully!*\n\n` +
        `👤 Wallet: \`${walletAddress}\`\n` +
        `➖ Removed: *${ticketCount}* tickets\n` +
        `🎫 Previous: ${existingTicket.ticketCount} tickets\n` +
        `🎫 New Total: *0* tickets\n\n` +
        `⚠️ User has been removed from the raffle (no tickets remaining).\n\n` +
        `Raffle ID: \`${activeRaffle.id}\``,
        { parse_mode: 'Markdown' }
      );

      logger.info(`Admin removed all tickets from ${walletAddress} for raffle ${activeRaffle.id}. Ticket record deleted.`);
    } else {
      // Update ticket count
      const updatedTicket = await prisma.ticket.update({
        where: { id: existingTicket.id },
        data: {
          ticketCount: newTicketCount,
        },
      });

      await bot.sendMessage(
        chatId,
        `✅ *Tickets Removed Successfully!*\n\n` +
        `👤 Wallet: \`${walletAddress}\`\n` +
        `➖ Removed: *${ticketCount}* tickets\n` +
        `🎫 Previous: ${existingTicket.ticketCount} tickets\n` +
        `🎫 New Total: *${updatedTicket.ticketCount}* tickets\n\n` +
        `Raffle ID: \`${activeRaffle.id}\``,
        { parse_mode: 'Markdown' }
      );

      logger.info(`Admin removed ${ticketCount} tickets from ${walletAddress} for raffle ${activeRaffle.id}. New total: ${updatedTicket.ticketCount}`);
    }
  } catch (error) {
    logger.error('Error removing tickets:', error);
    await bot.sendMessage(chatId, '❌ Failed to remove tickets. Please check the wallet address format and try again.');
  }
}
