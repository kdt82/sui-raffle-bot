import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';
import { RAFFLE_STATUS, MEDIA_TYPES, DEX_OPTIONS, formatDate } from '../../utils/constants';
import { handleCreateRaffleUI, handleCreateRaffleStep } from './admin-ui';
import { conversationManager } from '../conversation';
import { auditService } from '../../services/audit-service';
import { notificationService } from '../../services/notification-service';
import { getAdminProjectContext } from '../../middleware/project-context';

// Re-export UI handler
export { handleCreateRaffleUI, handleCreateRaffleStep } from './admin-ui';
import { stakeDetector } from '../../blockchain/stake-detector';
import { sellDetector } from '../../blockchain/sell-detector';
import { MAIN_CHAT_ID } from '../../utils/constants';

export async function handleVerifyStakeCommand(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length === 0) {
    await bot.sendMessage(chatId, '📝 Usage: /verify_stake <tx_hash>');
    return;
  }

  const txHash = args[0].trim();
  await bot.sendMessage(chatId, `🔍 Verifying stake transaction: ${txHash}...`);

  try {
    const result = await stakeDetector.verifyAndBackfillStake(txHash);

    if (result.success) {
      await bot.sendMessage(chatId, `✅ Success: ${result.message}`);

      if (result.ticketsAdded && result.ticketsAdded > 0 && result.wallet) {
        // Send announcement to main chat
        if (MAIN_CHAT_ID) {
          const shortWallet = `${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}`;
          await bot.sendMessage(
            MAIN_CHAT_ID,
            `📢 **Staking Bonus Verified!**\n\n` +
            `Wallet \`${shortWallet}\` has staked tokens on Moonbags.io!\n` +
            `🎟️ They have been awarded an additional **${result.ticketsAdded}** tickets in the raffle!`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } else {
      await bot.sendMessage(chatId, `❌ Verification Failed: ${result.message}`);
    }
  } catch (error: any) {
    logger.error('Error verifying stake:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

export async function handleVerifySellCommand(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length === 0) {
    await bot.sendMessage(chatId, '📝 Usage: /verify_sell <tx_hash>');
    return;
  }

  const txHash = args[0].trim();
  await bot.sendMessage(chatId, `🔍 Verifying sell transaction: ${txHash}...`);

  try {
    const result = await sellDetector.verifyAndProcessSell(txHash);

    if (result.success) {
      await bot.sendMessage(chatId, `✅ Success: ${result.message}`);
    } else {
      await bot.sendMessage(chatId, `❌ Verification Failed: ${result.message}`);
    }
  } catch (error: any) {
    logger.error('Error verifying sell:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

export async function handleCancelRaffle(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);

  const projectContext = await getAdminProjectContext(msg);
  if (!projectContext) {
    await bot.sendMessage(chatId, '❌ Could not determine project context. Please use this command in the group chat or ensure you are an admin of a single project.');
    return;
  }

  try {
    // First check if there's an active conversation (raffle creation in progress)
    const conversation = conversationManager.getConversation(userId, chatId);
    if (conversation && conversation.step.startsWith('create_raffle')) {
      conversationManager.deleteConversation(userId, chatId);
      await bot.sendMessage(
        chatId,
        '❌ Raffle creation cancelled.\n\n' +
        'Your raffle creation session has been terminated.'
      );
      logger.info(`Raffle creation conversation cancelled for user ${userId}`);
      return;
    }

    // If no conversation, check for active raffle in database
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        projectId: projectContext.id,
        status: RAFFLE_STATUS.ACTIVE,
      },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ There is no active raffle to cancel.');
      return;
    }

    // Update raffle status to cancelled
    await prisma.raffle.update({
      where: { id: activeRaffle.id },
      data: {
        status: 'cancelled',
        updatedAt: new Date(),
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ Active raffle cancelled successfully!\n\n` +
      `Raffle ID: ${activeRaffle.id}\n` +
      `Contract: ${activeRaffle.ca.slice(0, 10)}...${activeRaffle.ca.slice(-6)}\n` +
      `DEX: ${activeRaffle.dex.toUpperCase()}\n` +
      `Prize: ${activeRaffle.prizeAmount} ${activeRaffle.prizeType}\n\n` +
      `The raffle has been cancelled and buy detection has stopped.`
    );

    logger.info(`Active raffle cancelled: ${activeRaffle.id}`);
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
      `End time format: YYYY-MM-DDTHH:mm:ss`
    );
    return;
  }

  const [ca, dex, endTimeStr, prizeType, prizeAmount] = args;

  if (!DEX_OPTIONS.includes(dex.toLowerCase() as any)) {
    await bot.sendMessage(chatId, `❌ Invalid DEX. Must be one of: ${DEX_OPTIONS.join(', ')}`);
    return;
  }

  const projectContext = await getAdminProjectContext(msg);
  if (!projectContext) {
    await bot.sendMessage(chatId, '❌ Could not determine project context. Please use this command in the group chat or ensure you are an admin of a single project.');
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
        projectId: projectContext.id,
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
        projectId: projectContext.id,
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
      `Example: /set_prize USDC 500`
    );
    return;
  }

  const [prizeType, prizeAmount] = args;

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

    // Broadcast winner announcement with transaction link
    await notificationService.broadcastWinnerAnnouncement(endedRaffle.id, txHash);

    await bot.sendMessage(
      chatId,
      `✅ PRIZE MARKED AS AWARDED!\n\n` +
      `RAFFLE DETAILS:\n` +
      `ID: ${endedRaffle.id}\n` +
      `Prize: ${endedRaffle.prizeAmount} ${endedRaffle.prizeType}\n\n` +
      `WINNER:\n` +
      `Wallet: ${winner.walletAddress}\n` +
      `Tickets: ${winner.ticketCount.toString()}\n\n` +
      `TRANSACTION:\n` +
      `🔗 ${suiscanLink}\n` +
      `Hash: ${txHash}\n\n` +
      `Prize awarded and winner announced to broadcast channel!`,
      { disable_web_page_preview: true }
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
      ? ((Number(winner.ticketCount) / totalTickets) * 100).toFixed(2)
      : '0';

    // Convert BigInt to string for display
    const ticketCountStr = winner.ticketCount.toString();

    const statusEmoji = winner.prizeAwarded ? '✅' : '⏳';
    const awardedText = winner.prizeAwarded && winner.awardedAt
      ? `\n📅 Awarded: ${formatDate(winner.awardedAt)} UTC`
      : '\n⏳ Prize not yet awarded';

    // Build transaction link if available
    const txSection = winner.awardTxHash
      ? `\n🔗 Transaction: https://suiscan.xyz/mainnet/tx/${winner.awardTxHash}`
      : '';

    // Build randomness proof section
    let randomnessSection = '';
    if (winner.selectionMethod === 'on-chain' && winner.randomnessEpoch) {
      randomnessSection = `\n\n🔐 RANDOMNESS PROOF:\n` +
        `Method: SUI On-Chain Randomness\n` +
        `Blockchain Epoch: ${winner.randomnessEpoch}\n` +
        `This winner was selected using verifiable on-chain randomness from the SUI blockchain.`;
    } else if (winner.selectionMethod === 'client-side') {
      randomnessSection = `\n\n🔐 SELECTION METHOD:\n` +
        `Weighted Random`;
    }

    logger.info('Sending winner message');

    // Format winning ticket number if available
    const winningTicketText = winner.winningTicketNumber !== null && winner.winningTicketNumber !== undefined
      ? `\nWinning Ticket #: ${winner.winningTicketNumber.toString()}`
      : '';

    await bot.sendMessage(
      chatId,
      `🏆 RAFFLE WINNER\n\n` +
      `${statusEmoji} Status: ${winner.prizeAwarded ? 'Prize Awarded' : 'Pending Award'}\n\n` +
      `RAFFLE DETAILS:\n` +
      `ID: ${raffle.id}\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
      `Ended: ${formatDate(raffle.endTime)} UTC\n\n` +
      `WINNER DETAILS:\n` +
      `Wallet: ${winner.walletAddress}\n` +
      `Tickets: ${ticketCountStr} (${winnerPercentage}% of total)${winningTicketText}\n` +
      `Selected: ${formatDate(winner.selectedAt)} UTC${awardedText}${txSection}${randomnessSection}\n\n` +
      `RAFFLE STATS:\n` +
      `Total Participants: ${totalParticipants}\n` +
      `Total Tickets: ${totalTickets.toLocaleString()}\n\n` +
      `${!winner.prizeAwarded ? '💡 Use /award_prize <txhash> to mark as awarded' : ''}`,
      { disable_web_page_preview: true }
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
        randomnessSection = `\n🔐 Randomness Proof:\n` +
          `Method: SUI On-Chain Randomness\n` +
          `Blockchain Epoch: ${winner.randomnessEpoch}\n\n`;
      } else if (winner.selectionMethod === 'client-side') {
        randomnessSection = `\nSelection Method: Weighted Random\n\n`;
      }

      // Convert BigInt to string for display
      const ticketCountStr = winner.ticketCount.toString();

      await bot.sendMessage(
        chatId,
        `🎉 WINNER SELECTED!\n\n` +
        `WINNER DETAILS:\n` +
        `Wallet: ${winner.walletAddress}\n` +
        `Tickets: ${ticketCountStr}\n` +
        randomnessSection +
        `RAFFLE DETAILS:\n` +
        `ID: ${raffle.id}\n` +
        `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n\n` +
        `Winner selected privately. Use /award_prize <txhash> to award the prize and announce publicly.`
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
          select: { tickets: true }
        }
      }
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, 'ℹ️ No active raffle found.');
      return;
    }

    const ticketCount = await prisma.ticket.aggregate({
      where: { raffleId: activeRaffle.id },
      _sum: { ticketCount: true },
    });

    const totalTickets = ticketCount._sum.ticketCount || 0;

    await bot.sendMessage(
      chatId,
      `⚙️ **Current Raffle Configuration**\n\n` +
      `ID: \`${activeRaffle.id}\`\n` +
      `Contract: \`${activeRaffle.ca}\`\n` +
      `DEX: ${activeRaffle.dex.toUpperCase()}\n` +
      `Status: ${activeRaffle.status}\n` +
      `Prize: ${activeRaffle.prizeAmount} ${activeRaffle.prizeType}\n` +
      `Start: ${formatDate(activeRaffle.startTime)}\n` +
      `End: ${formatDate(activeRaffle.endTime)}\n` +
      `Participants: ${activeRaffle._count.tickets}\n` +
      `Total Tickets: ${totalTickets.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error('Error fetching config:', error);
    await bot.sendMessage(chatId, '❌ Error fetching configuration.');
  }
}

export async function handleResetTickets(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    const activeRaffle = await prisma.raffle.findFirst({
      where: {
        status: RAFFLE_STATUS.ACTIVE,
        endTime: { gt: new Date() },
      },
      include: {
        tickets: true,
        buyEvents: true,
      },
    });

    if (!activeRaffle) {
      await bot.sendMessage(chatId, '❌ No active raffle found.');
      return;
    }

    const ticketCount = activeRaffle.tickets?.length || 0;
    const buyEventCount = activeRaffle.buyEvents?.length || 0;

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
      `🎫 Deleted tickets\n` +
      `📊 Deleted buy events\n\n` +
      `Raffle ID: \`${activeRaffle.id}\`\n` +
      `Contract: \`${activeRaffle.ca.slice(0, 10)}...${activeRaffle.ca.slice(-6)}\`\n` +
      `DEX: ${activeRaffle.dex.toUpperCase()}\n\n` +
      `The raffle is still active and will continue to track new buys.`,
      { parse_mode: 'Markdown' }
    );

    logger.info(`Admin reset tickets for raffle: ${activeRaffle.id}`);
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

/**
 * Backfill winning ticket number for existing winner (admin only)
 */
export async function handleBackfillTicketNumber(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;

  try {
    // Find winners without ticket numbers
    const winners = await prisma.winner.findMany({
      where: {
        winningTicketNumber: null,
      },
      include: {
        raffle: {
          include: {
            tickets: true,
          },
        },
      },
    });

    if (winners.length === 0) {
      await bot.sendMessage(chatId, '✅ All winners already have ticket numbers!');
      return;
    }

    await bot.sendMessage(chatId, `🔄 Backfilling ${winners.length} winner(s)...`);

    for (const winner of winners) {
      // Find the winner's ticket range
      let cumulativeTickets = BigInt(0);
      let winnerTicketStart = BigInt(0);
      let winnerTicketEnd = BigInt(0);

      // Sort tickets to ensure consistent ordering
      const sortedTickets = winner.raffle.tickets.sort((a, b) =>
        a.walletAddress.localeCompare(b.walletAddress)
      );

      for (const ticket of sortedTickets) {
        const ticketCount = BigInt(ticket.ticketCount);
        if (ticket.walletAddress === winner.walletAddress) {
          winnerTicketStart = cumulativeTickets;
          winnerTicketEnd = cumulativeTickets + ticketCount - BigInt(1);
          break;
        }
        cumulativeTickets += ticketCount;
      }

      // Generate a random ticket number within the winner's range
      const rangeSize = Number(winnerTicketEnd - winnerTicketStart + BigInt(1));
      const randomOffset = Math.floor(Math.random() * rangeSize);
      const winningTicketNumber = winnerTicketStart + BigInt(randomOffset);

      // Update the winner record
      await prisma.winner.update({
        where: { id: winner.id },
        data: {
          winningTicketNumber: winningTicketNumber,
        },
      });

      logger.info(`Backfilled ticket number ${winningTicketNumber} for winner ${winner.walletAddress}`);
    }

    await bot.sendMessage(
      chatId,
      `✅ Backfill complete!\n\nUpdated ${winners.length} winner(s) with ticket numbers in their respective ranges.`
    );
  } catch (error) {
    logger.error('Error backfilling ticket numbers:', error);
    await bot.sendMessage(chatId, '❌ Error backfilling ticket numbers. Check logs.');
  }
}
export async function handleStartRaffle(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length < 1) {
    await bot.sendMessage(
      chatId,
      `📝 Usage: /start_raffle <raffle_id>\n\n` +
      `Manually start a raffle and send the announcement.`
    );
    return;
  }

  const raffleId = args[0];

  try {
    // Import dynamically to avoid circular dependencies if any
    const { startRaffle } = await import('../../services/raffle-service');

    await bot.sendMessage(chatId, `🚀 Starting raffle ${raffleId}...`);

    await startRaffle(raffleId);

    await bot.sendMessage(chatId, `✅ Raffle ${raffleId} started successfully!`);
  } catch (error) {
    logger.error('Error starting raffle:', error);
    await bot.sendMessage(chatId, `❌ Failed to start raffle: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function handleEndRaffle(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  if (args.length < 1) {
    await bot.sendMessage(
      chatId,
      `📝 Usage: /end_raffle <raffle_id>\n\n` +
      `Manually end a raffle and select a winner.`
    );
    return;
  }

  const raffleId = args[0];

  try {
    // Import dynamically to avoid circular dependencies if any
    const { endRaffle } = await import('../../services/raffle-service');

    await bot.sendMessage(chatId, `🏁 Ending raffle ${raffleId}...`);

    await endRaffle(raffleId);

    await bot.sendMessage(chatId, `✅ Raffle ${raffleId} ended successfully!`);
  } catch (error) {
    logger.error('Error ending raffle:', error);
    await bot.sendMessage(chatId, `❌ Failed to end raffle: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
