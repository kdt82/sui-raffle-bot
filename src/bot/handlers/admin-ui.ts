import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';
import { PRIZE_TYPES, RAFFLE_STATUS, MEDIA_TYPES, DEFAULT_DEX, getDexDisplayName, DexType, MAIN_CHAT_ID } from '../../utils/constants';
import { conversationManager } from '../conversation';

// Helper function to extract token symbol from contract address
// Example: 0xab954d078dab0a6727ce58388931850be4bdb6f72703ea3cad3d6eb0c12a0283::aqua::AQUA -> AQUA
function extractTokenSymbolFromCA(ca: string): string {
  try {
    // Split by :: and get the last part (the token symbol)
    const parts = ca.split('::');
    if (parts.length >= 3) {
      const symbol = parts[parts.length - 1].toUpperCase();
      return symbol;
    }
    // If format doesn't match, return 'TOKEN' as fallback
    return 'TOKEN';
  } catch (error) {
    logger.warn('Failed to extract token symbol from CA:', ca);
    return 'TOKEN';
  }
}

// UI Mode: Interactive wizard with buttons
export async function handleCreateRaffleUI(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);

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

  // Start conversation
  conversationManager.createConversation(userId, chatId, 'create_raffle_contract');

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `🎰 **Create New Raffle**\n\n` +
    `Step 1/11: Contract Address\n\n` +
    `Please send the contract address (CA) of the token to monitor.\n\n` +
    `Example: \`0x1234567890abcdef...\``,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// Command Mode: Direct command with arguments (kept for compatibility)
export async function handleCreateRaffle(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  const args = msg.text?.split(' ').slice(1) || [];

  // If no args, use UI mode
  if (args.length === 0) {
    await handleCreateRaffleUI(msg);
    return;
  }

  // Otherwise, use command mode with args
  if (args.length < 4) {
    await bot.sendMessage(
      chatId,
      `?? Usage: /create_raffle <contract_address> <end_time> <prize_type> <prize_amount>\n\n` +
      `Example: /create_raffle 0x123... 2024-12-31T23:59:59 SUI 1000\n\n` +
      `Or use /create_raffle without arguments for interactive mode.\n\n` +
      `Prize types: ${PRIZE_TYPES.join(', ')}\n` +
      `End time format: YYYY-MM-DDTHH:mm:ss`
    );
    return;
  }

  const [ca, endTimeStr, prizeType, prizeAmount] = args;

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
        dex: DEFAULT_DEX,
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
      `DEX: ${DEFAULT_DEX.toUpperCase()}\n` +
      `Ends: ${endTime.toLocaleString()}\n` +
      `Prize: ${prizeAmount} ${prizeType}`
    );
  } catch (error) {
    logger.error('Error creating raffle:', error);
    await bot.sendMessage(chatId, '❌ Error creating raffle. Please try again.');
  }
}

// Handle conversation steps
export async function handleCreateRaffleStep(
  msg: TelegramBot.Message,
  step: string,
  data: Record<string, any>
): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);

  switch (step) {
    case 'create_raffle_contract':
      await handleContractAddressStep(msg, data);
      break;
    case 'create_raffle_start_time':
      await handleStartTimeStep(msg, data);
      break;
    case 'create_raffle_end_time':
      await handleEndTimeStep(msg, data);
      break;
    case 'create_raffle_prize_type':
      await handlePrizeTypeStep(msg, data);
      break;
    case 'create_raffle_prize_amount':
      await handlePrizeAmountStep(msg, data);
      break;
    case 'create_raffle_ticket_ratio':
      await handleTicketRatioStep(msg, data);
      break;
    case 'create_raffle_minimum_purchase':
      await handleMinimumPurchaseStep(msg, data);
      break;
    case 'create_raffle_announcement_media':
      await handleAnnouncementMediaStep(msg, data);
      break;
    case 'create_raffle_notification_media':
      await handleNotificationMediaStep(msg, data);
      break;
    case 'create_raffle_leaderboard_media':
      await handleLeaderboardMediaStep(msg, data);
      break;
    case 'create_raffle_review':
      await handleReviewStep(msg, data);
      break;
  }
}

async function handleContractAddressStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const contractAddress = msg.text?.trim();

  if (!contractAddress || !contractAddress.startsWith('0x') || contractAddress.length < 20) {
    await bot.sendMessage(chatId, '❌ Invalid contract address. Please send a valid SUI address starting with 0x.');
    return;
  }

  data.contractAddress = contractAddress;
  data.dex = DEFAULT_DEX;
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_start_time',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '▶️ Start Now', callback_data: 'start_now' }],
      [{ text: '🔙 Back', callback_data: 'back_to_contract' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  // Get current UTC time (to nearest minute)
  const now = new Date();
  const currentUtc = now.toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false
  });

  await bot.sendMessage(
    chatId,
    `✅ Contract Address: \`${contractAddress}\`\n\n` +
    `Step 2/11: Start Time\n\n` +
    `🕐 Current UTC Time: \`${currentUtc}\`\n\n` +
    `Please send the raffle start time in format: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
    `Example: 10/11/2024 12:00:00\n\n` +
    `Or click "Start Now" to start the raffle immediately.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

async function handleStartTimeStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const startTimeStr = msg.text?.trim();

  logger.info(`Received start date input: "${startTimeStr}"`);

  if (!startTimeStr) {
    await bot.sendMessage(chatId, '❌ Please send a valid start time or click "Start Now".');
    return;
  }

  // Parse DD/MM/YYYY HH:mm:ss format
  const dateTimeRegex = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
  const match = startTimeStr.match(dateTimeRegex);
  
  logger.info(`Start time regex match result: ${match ? 'SUCCESS' : 'FAILED'}`);
  
  if (!match) {
    await bot.sendMessage(
      chatId,
      `❌ Invalid format. Please use: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
      `Example: 10/11/2024 12:00:00\n\n` +
      `You sent: "${startTimeStr}"\n\n` +
      `Or click "Start Now" to start immediately.`
    );
    return;
  }

  const [, day, month, year, hours, minutes, seconds] = match;
  logger.info(`Parsed start time values - Day: ${day}, Month: ${month}, Year: ${year}, Time: ${hours}:${minutes}:${seconds}`);
  
  const startTime = new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds)
  ));

  logger.info(`Parsed start date: ${startTime.toISOString()}, Valid: ${!isNaN(startTime.getTime())}`);

  if (isNaN(startTime.getTime())) {
    await bot.sendMessage(chatId, '❌ Invalid date. Please check your input.');
    return;
  }

  // Start time can be in past or future (for scheduling)
  data.startTime = startTime.toISOString();
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_end_time',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '🔙 Back', callback_data: 'back_to_start_time' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  // Get current UTC time (to nearest minute)
  const now = new Date();
  const currentUtc = now.toLocaleString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false
  });

  await bot.sendMessage(
    chatId,
    `✅ Start Time: ${startTime.toLocaleString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short'
    })}\n\n` +
    `Step 3/11: End Time\n\n` +
    `🕐 Current UTC Time: \`${currentUtc}\`\n\n` +
    `Please send the raffle end time in format: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
    `Example: 31/12/2024 23:59:59`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

async function handleEndTimeStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const endTimeStr = msg.text?.trim();

  logger.info(`Received date input: "${endTimeStr}"`);

  if (!endTimeStr) {
    await bot.sendMessage(chatId, '❌ Please send a valid end time.');
    return;
  }

  // Parse DD/MM/YYYY HH:mm:ss format
  const dateTimeRegex = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;
  const match = endTimeStr.match(dateTimeRegex);
  
  logger.info(`Regex match result: ${match ? 'SUCCESS' : 'FAILED'}`);
  
  if (!match) {
    await bot.sendMessage(
      chatId,
      `❌ Invalid format. Please use: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
      `Example: 31/12/2024 23:59:59\n\n` +
      `You sent: "${endTimeStr}"`
    );
    return;
  }

  const [, day, month, year, hours, minutes, seconds] = match;
  logger.info(`Parsed values - Day: ${day}, Month: ${month}, Year: ${year}, Time: ${hours}:${minutes}:${seconds}`);
  
  const endTime = new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1, // Month is 0-indexed
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds)
  ));

  logger.info(`Parsed date: ${endTime.toISOString()}, Valid: ${!isNaN(endTime.getTime())}, Future: ${endTime > new Date()}`);

  if (isNaN(endTime.getTime())) {
    await bot.sendMessage(chatId, '❌ Invalid date. Please check your input.');
    return;
  }

  // Validate end time is after start time
  const startTime = data.startTime ? new Date(data.startTime) : new Date();
  if (endTime <= startTime) {
    await bot.sendMessage(
      chatId, 
      `❌ End time must be after start time.\n\n` +
      `Start time: ${startTime.toLocaleString()} UTC\n` +
      `Your end time: ${endTime.toLocaleString()} UTC`
    );
    return;
  }

  if (endTime <= new Date()) {
    await bot.sendMessage(chatId, `❌ End time must be in the future.\n\nCurrent time: ${new Date().toISOString()}\nYour time: ${endTime.toISOString()}`);
    return;
  }

  data.endTime = endTime.toISOString();
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_prize_type',
    data,
  });

  // Extract token symbol from contract address
  const extractedToken = extractTokenSymbolFromCA(data.contractAddress);
  
  // Create prize type selection keyboard with extracted token, USDC, and SUI
  const prizeTypes = [extractedToken, 'USDC', 'SUI'];
  const prizeButtons = prizeTypes.map(type => ({
    text: type,
    callback_data: `select_prize_type_${type}`,
  }));

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      prizeButtons,
      [{ text: '🔙 Back', callback_data: 'back_to_end_time' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ End Time: ${endTime.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short'
    })}\n\n` +
    `Step 4/11: Prize Type\n\n` +
    `Select the prize type:`,
    {
      reply_markup: keyboard,
    }
  );
}

async function handlePrizeTypeStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  // This is handled via callback query, not text message
}

async function handlePrizeAmountStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const prizeAmount = msg.text?.trim();

  if (!prizeAmount || isNaN(parseFloat(prizeAmount)) || parseFloat(prizeAmount) <= 0) {
    await bot.sendMessage(chatId, '❌ Please send a valid prize amount (number greater than 0).');
    return;
  }

  data.prizeAmount = prizeAmount;
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_ticket_ratio',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '🎯 100 tickets per token (Default)', callback_data: 'ratio_default' }],
      [{ text: '🔙 Back', callback_data: 'back_to_prize_type' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ Prize Amount: ${prizeAmount}\n\n` +
    `Step 6/11: Ticket Ratio\n\n` +
    `Set how many tickets are earned per token purchased.\n\n` +
    `**Format Options:**\n` +
    `• Enter "100" = 100 tickets per token\n` +
    `• Enter "0.0002" = 1 ticket per 5,000 tokens\n` +
    `• Enter "0.001" = 1 ticket per 1,000 tokens\n\n` +
    `💡 Tip: Smaller ratios (like 0.0002) are good for high-volume/low-value tokens.\n\n` +
    `Send the ratio, or click "Default" for 100 tickets per token:`,
    {
      reply_markup: keyboard,
    }
  );
}

async function handleTicketRatioStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const ratioInput = msg.text?.trim();

  if (!ratioInput || isNaN(parseFloat(ratioInput)) || parseFloat(ratioInput) <= 0) {
    await bot.sendMessage(chatId, '❌ Please send a valid ratio (number greater than 0), or click "Default".');
    return;
  }

  const ratio = parseFloat(ratioInput);
  data.ticketsPerToken = ratioInput;

  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_minimum_purchase',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '⏭️ Skip (No Minimum)', callback_data: 'skip_minimum_purchase' }],
      [{ text: '🔙 Back', callback_data: 'back_to_prize_amount' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  // Display a human-readable explanation
  let ratioExplanation;
  if (ratio >= 1) {
    ratioExplanation = `${ratio} tickets per token`;
  } else {
    const tokensPerTicket = Math.round(1 / ratio);
    ratioExplanation = `1 ticket per ${tokensPerTicket.toLocaleString()} tokens`;
  }

  await bot.sendMessage(
    chatId,
    `✅ Ticket Ratio: ${ratioExplanation}\n\n` +
    `Step 7/11: Minimum Purchase (Optional)\n\n` +
    `Set a minimum token purchase amount to earn tickets.\n` +
    `Purchases below this amount will not earn tickets.\n\n` +
    `⚠️ **Important:** Enter amount in **token units** (not raw units)\n` +
    `Example: Enter "10" for 10 tokens, not "10000000000"\n\n` +
    `Send the minimum amount, or click "Skip" for no minimum:`,
    {
      reply_markup: keyboard,
    }
  );
}

async function handleMinimumPurchaseStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  const minimumPurchase = msg.text?.trim();

  if (!minimumPurchase || isNaN(parseFloat(minimumPurchase)) || parseFloat(minimumPurchase) <= 0) {
    await bot.sendMessage(chatId, '❌ Please send a valid minimum purchase amount (number greater than 0), or click "Skip".');
    return;
  }

  data.minimumPurchase = minimumPurchase;
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_announcement_media',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '⏭️ Skip Media', callback_data: 'skip_media' }],
      [{ text: '🔙 Back', callback_data: 'back_to_minimum_purchase' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ Minimum Purchase: ${minimumPurchase} tokens\n\n` +
    `Step 8/11: Announcement Media (Optional)\n\n` +
    `� Send an image, video, or GIF for your raffle announcement.\n\n` +
    `This media will be shown when announcing the raffle in the main chat.\n\n` +
    `Or click "Skip" to continue without announcement media.`,
    {
      reply_markup: keyboard,
    }
  );
}

async function handleAnnouncementMediaStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  
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
  // Check for document (images sent as files)
  else if (msg.document) {
    const mimeType = msg.document.mime_type;
    if (mimeType?.startsWith('image/')) {
      mediaFileId = msg.document.file_id;
      mediaType = MEDIA_TYPES.IMAGE;
    } else if (mimeType?.startsWith('video/')) {
      mediaFileId = msg.document.file_id;
      mediaType = MEDIA_TYPES.VIDEO;
    } else {
      await bot.sendMessage(
        chatId,
        '❌ Please send a valid image, video, or GIF.\n\n' +
        'Or click "Skip" to continue without announcement media.'
      );
      return;
    }
  }
  else {
    await bot.sendMessage(
      chatId,
      '❌ Please send a valid image, video, or GIF.\n\n' +
      'Or click "Skip" to continue without announcement media.'
    );
    return;
  }

  data.announcementMediaUrl = mediaFileId;
  data.announcementMediaType = mediaType;
  
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_notification_media',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '⏭️ Skip', callback_data: 'skip_notification_media' }],
      [{ text: '🔙 Back', callback_data: 'back_to_announcement_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ Announcement Media: ${mediaType} attached\n\n` +
    `Step 9/11: Notification Media (Optional)\n\n` +
    `🎫 Send an image, video, or GIF for ticket notifications.\n\n` +
    `This media will be shown when users receive tickets.\n\n` +
    `Or click "Skip" to continue without notification media.`,
    {
      reply_markup: keyboard,
    }
  );
}

async function handleNotificationMediaStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  
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
  // Check for document (images sent as files)
  else if (msg.document) {
    const mimeType = msg.document.mime_type;
    if (mimeType?.startsWith('image/')) {
      mediaFileId = msg.document.file_id;
      mediaType = MEDIA_TYPES.IMAGE;
    } else if (mimeType?.startsWith('video/')) {
      mediaFileId = msg.document.file_id;
      mediaType = MEDIA_TYPES.VIDEO;
    } else {
      await bot.sendMessage(
        chatId,
        '❌ Please send a valid image, video, or GIF.\n\n' +
        'Or click "Skip" to continue without notification media.'
      );
      return;
    }
  }
  else {
    await bot.sendMessage(
      chatId,
      '❌ Please send a valid image, video, or GIF.\n\n' +
      'Or click "Skip" to continue without notification media.'
    );
    return;
  }

  data.notificationMediaUrl = mediaFileId;
  data.notificationMediaType = mediaType;
  
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_leaderboard_media',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '⏭️ Skip', callback_data: 'skip_leaderboard_media' }],
      [{ text: '🔙 Back', callback_data: 'back_to_notification_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ Notification Media: ${mediaType} attached\n\n` +
    `Step 10/11: Leaderboard Media (Optional)\n\n` +
    `🏆 Send an image, video, or GIF for the leaderboard.\n\n` +
    `This media will be shown in leaderboard displays.\n\n` +
    `Or click "Skip" to continue without leaderboard media.`,
    {
      reply_markup: keyboard,
    }
  );
}

async function handleLeaderboardMediaStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  const chatId = msg.chat.id;
  const userId = BigInt(msg.from!.id);
  
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
  // Check for document (images sent as files)
  else if (msg.document) {
    const mimeType = msg.document.mime_type;
    if (mimeType?.startsWith('image/')) {
      mediaFileId = msg.document.file_id;
      mediaType = MEDIA_TYPES.IMAGE;
    } else if (mimeType?.startsWith('video/')) {
      mediaFileId = msg.document.file_id;
      mediaType = MEDIA_TYPES.VIDEO;
    } else {
      await bot.sendMessage(
        chatId,
        '❌ Please send a valid image, video, or GIF.\n\n' +
        'Or click "Skip" to continue without leaderboard media.'
      );
      return;
    }
  }
  else {
    await bot.sendMessage(
      chatId,
      '❌ Please send a valid image, video, or GIF.\n\n' +
      'Or click "Skip" to continue without leaderboard media.'
    );
    return;
  }

  data.leaderboardMediaUrl = mediaFileId;
  data.leaderboardMediaType = mediaType;
  
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_review',
    data,
  });

  await showReviewStep(chatId, data);
}

async function handleReviewStep(msg: TelegramBot.Message, data: Record<string, any>): Promise<void> {
  // This is handled via callback query for confirmation
}

async function showReviewStep(chatId: number, data: Record<string, any>): Promise<void> {
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '✅ Confirm & Create', callback_data: 'confirm_create_raffle' }],
      [{ text: '🔙 Back', callback_data: 'back_to_leaderboard_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  const dexValue = typeof data.dex === 'string' && data.dex.length > 0 ? data.dex : DEFAULT_DEX;
  const dexDisplay = getDexDisplayName(dexValue as DexType).toUpperCase();
  
  // Format ticket ratio for display
  const ratio = parseFloat(data.ticketsPerToken || '100');
  let ratioDisplay;
  if (ratio >= 1) {
    ratioDisplay = `${ratio} tickets per token`;
  } else {
    const tokensPerTicket = Math.round(1 / ratio);
    ratioDisplay = `1 ticket per ${tokensPerTicket.toLocaleString()} tokens`;
  }
  
  const minimumText = data.minimumPurchase 
    ? `\nMinimum Purchase: ${data.minimumPurchase} tokens` 
    : '\nMinimum Purchase: None';
    
  const announcementMediaText = data.announcementMediaUrl && data.announcementMediaType
    ? `\nAnnouncement Media: ${data.announcementMediaType} attached`
    : '\nAnnouncement Media: None';
    
  const notificationMediaText = data.notificationMediaUrl && data.notificationMediaType
    ? `\nNotification Media: ${data.notificationMediaType} attached`
    : '\nNotification Media: None';
    
  const leaderboardMediaText = data.leaderboardMediaUrl && data.leaderboardMediaType
    ? `\nLeaderboard Media: ${data.leaderboardMediaType} attached`
    : '\nLeaderboard Media: None';

  await bot.sendMessage(
    chatId,
    `📋 **Review Raffle Details**\n\n` +
    `Contract Address: \`${data.contractAddress}\`\n` +
    `DEX: ${dexDisplay}\n` +
    `Prize Type: ${data.prizeType}\n` +
    `Prize Amount: ${data.prizeAmount}\n` +
    `Ticket Ratio: ${ratioDisplay}${minimumText}${announcementMediaText}${notificationMediaText}${leaderboardMediaText}\n\n` +
    `Please review and confirm:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// Callback query handlers
export async function handleCreateRaffleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
  const chatId = query.message!.chat.id;
  const userId = BigInt(query.from.id);
  const callbackData = query.data!;

  const conversation = conversationManager.getConversation(userId, chatId);
  if (!conversation || !conversation.step.startsWith('create_raffle')) {
    await bot.answerCallbackQuery(query.id, { text: 'Conversation expired or invalid' });
    return;
  }

  try {
    if (callbackData === 'cancel_create_raffle') {
      conversationManager.deleteConversation(userId, chatId);
      await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
      await bot.editMessageText('❌ Raffle creation cancelled.', {
        chat_id: chatId,
        message_id: query.message!.message_id,
      });
      return;
    }

    if (callbackData.startsWith('select_prize_type_')) {
      const prizeType = callbackData.replace('select_prize_type_', '');
      conversation.data.prizeType = prizeType;
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_prize_amount',
        data: conversation.data,
      });

      await bot.answerCallbackQuery(query.id, { text: `Selected ${prizeType}` });
      await bot.editMessageText(
        `✅ Prize Type: ${prizeType}\n\n` +
        `Step 5/11: Prize Amount\n\n` +
        `Please send the prize amount:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back', callback_data: 'back_to_prize_type' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'start_now') {
      const now = new Date();
      conversation.data.startTime = now.toISOString();
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_end_time',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Starting now' });
      
      // Format UTC time for display
      const formattedNow = now.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short'
      });
      
      await bot.editMessageText(
        `✅ Start Time: ${formattedNow}\n\n` +
        `Step 3/7: End Time\n\n` +
        `Please send the raffle end time in format: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
        `Example: 31/12/2024 23:59:59`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back', callback_data: 'back_to_start_time' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'ratio_default') {
      conversation.data.ticketsPerToken = '100';
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_minimum_purchase',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Set to 100 tickets per token' });
      await bot.editMessageText(
        `✅ Ticket Ratio: 100 tickets per token\n\n` +
        `Step 7/11: Minimum Purchase (Optional)\n\n` +
        `Set a minimum token purchase amount to earn tickets.\n` +
        `Purchases below this amount will not earn tickets.\n\n` +
        `⚠️ **Important:** Enter amount in **token units** (not raw units)\n` +
        `Example: Enter "10" for 10 tokens, not "10000000000"\n\n` +
        `Send the minimum amount, or click "Skip" for no minimum:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip (No Minimum)', callback_data: 'skip_minimum_purchase' }],
              [{ text: '🔙 Back', callback_data: 'back_to_ticket_ratio' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'skip_minimum_purchase') {
      conversation.data.minimumPurchase = null;
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_announcement_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Skipped minimum purchase' });
      await bot.editMessageText(
        `✅ Minimum Purchase: None\n\n` +
        `Step 8/11: Announcement Media (Optional)\n\n` +
        `📸 Send an image, video, or GIF for your raffle announcement.\n\n` +
        `This media will be shown when users view the raffle details.\n\n` +
        `Or click "Skip" to continue without media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip', callback_data: 'skip_announcement_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_minimum_purchase' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'skip_announcement_media') {
      conversation.data.announcementMediaUrl = null;
      conversation.data.announcementMediaType = null;
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_notification_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Skipped announcement media' });
      await bot.editMessageText(
        `✅ Announcement Media: None\n\n` +
        `Step 9/11: Notification Media (Optional)\n\n` +
        `🎫 Send an image, video, or GIF for ticket notifications.\n\n` +
        `This media will be shown when users receive tickets.\n\n` +
        `Or click "Skip" to continue without notification media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip', callback_data: 'skip_notification_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_announcement_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'skip_notification_media') {
      conversation.data.notificationMediaUrl = null;
      conversation.data.notificationMediaType = null;
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_leaderboard_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Skipped notification media' });
      await bot.editMessageText(
        `✅ Notification Media: None\n\n` +
        `Step 10/11: Leaderboard Media (Optional)\n\n` +
        `🏆 Send an image, video, or GIF for the leaderboard.\n\n` +
        `This media will be shown in leaderboard displays.\n\n` +
        `Or click "Skip" to continue without leaderboard media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip', callback_data: 'skip_leaderboard_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_notification_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'skip_leaderboard_media') {
      conversation.data.leaderboardMediaUrl = null;
      conversation.data.leaderboardMediaType = null;
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_review',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Skipped leaderboard media' });
      await showReviewStep(chatId, conversation.data);
      return;
    }

    if (callbackData === 'confirm_create_raffle') {
      await createRaffleFromData(chatId, conversation.data);
      conversationManager.deleteConversation(userId, chatId);
      await bot.answerCallbackQuery(query.id, { text: 'Raffle created!' });
      return;
    }

    // Handle back navigation
    if (callbackData === 'back_to_contract') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_contract',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(
        `Step 1/11: Contract Address\n\n` +
        `Please send the contract address (CA) of the token to monitor.\n\n` +
        `Example: \`0x1234567890abcdef...\``,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_start_time') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_start_time',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      // Get current UTC time (to nearest minute)
      const now = new Date();
      const currentUtc = now.toLocaleString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false
      });
      
      await bot.editMessageText(
        `✅ Contract Address: \`${conversation.data.contractAddress}\`\n\n` +
        `Step 2/11: Start Time\n\n` +
        `🕐 Current UTC Time: \`${currentUtc}\`\n\n` +
        `Please send the raffle start time in format: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
        `Example: 10/11/2024 12:00:00\n\n` +
        `Or click "Start Now" to start the raffle immediately.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '▶️ Start Now', callback_data: 'start_now' }],
              [{ text: '🔙 Back', callback_data: 'back_to_contract' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_end_time') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_end_time',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      const startTimeDisplay = conversation.data.startTime 
        ? new Date(conversation.data.startTime).toLocaleString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'UTC',
            timeZoneName: 'short'
          })
        : 'Now';
      
      // Get current UTC time (to nearest minute)
      const now = new Date();
      const currentUtc = now.toLocaleString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false
      });
      
      await bot.editMessageText(
        `✅ Start Time: ${startTimeDisplay}\n\n` +
        `Step 3/11: End Time\n\n` +
        `🕐 Current UTC Time: \`${currentUtc}\`\n\n` +
        `Please send the raffle end time in format: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
        `Example: 31/12/2024 23:59:59`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back', callback_data: 'back_to_start_time' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_prize_type') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_prize_type',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      // Extract token symbol from contract address
      const extractedToken = extractTokenSymbolFromCA(conversation.data.contractAddress);
      const prizeTypes = [extractedToken, 'USDC', 'SUI'];
      const prizeButtons = prizeTypes.map(type => ({
        text: type,
        callback_data: `select_prize_type_${type}`,
      }));
      
      await bot.editMessageText(
        `✅ End Time: ${new Date(conversation.data.endTime).toLocaleString('en-US', {
          weekday: 'short',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'UTC',
          timeZoneName: 'short'
        })}\n\n` +
        `Step 4/11: Prize Type\n\n` +
        `Select the prize type:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              prizeButtons,
              [{ text: '🔙 Back', callback_data: 'back_to_end_time' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_prize_amount') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_prize_amount',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(
        `✅ Prize Type: ${conversation.data.prizeType}\n\n` +
        `Step 5/11: Prize Amount\n\n` +
        `Please send the prize amount:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back', callback_data: 'back_to_prize_type' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_ticket_ratio') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_ticket_ratio',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(
        `✅ Prize Amount: ${conversation.data.prizeAmount} ${conversation.data.prizeType}\n\n` +
        `Step 6/11: Ticket Ratio\n\n` +
        `Set how many tickets users get per token purchased.\n\n` +
        `💡 Two formats:\n` +
        `• Enter "100" for 100 tickets per token\n` +
        `• Enter "0.0002" for 1 ticket per 5,000 tokens\n\n` +
        `Send the ratio number:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎯 100 tickets per token (Default)', callback_data: 'ratio_default' }],
              [{ text: '🔙 Back', callback_data: 'back_to_prize_amount' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_minimum_purchase') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_minimum_purchase',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      // Format ticket ratio for display
      const ratio = parseFloat(conversation.data.ticketsPerToken || '100');
      let ratioDisplay;
      if (ratio >= 1) {
        ratioDisplay = `${ratio} tickets per token`;
      } else {
        const tokensPerTicket = Math.round(1 / ratio);
        ratioDisplay = `1 ticket per ${tokensPerTicket.toLocaleString()} tokens`;
      }
      
      await bot.editMessageText(
        `✅ Ticket Ratio: ${ratioDisplay}\n\n` +
        `Step 7/11: Minimum Purchase (Optional)\n\n` +
        `Set a minimum token purchase amount to earn tickets.\n` +
        `Purchases below this amount will not earn tickets.\n\n` +
        `⚠️ **Important:** Enter amount in **token units** (not raw units)\n` +
        `Example: Enter "10" for 10 tokens, not "10000000000"\n\n` +
        `Send the minimum amount, or click "Skip" for no minimum:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip (No Minimum)', callback_data: 'skip_minimum_purchase' }],
              [{ text: '🔙 Back', callback_data: 'back_to_ticket_ratio' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_media') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_announcement_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      const minimumText = conversation.data.minimumPurchase
        ? `${conversation.data.minimumPurchase} tokens`
        : 'None';
      
      await bot.editMessageText(
        `✅ Minimum Purchase: ${minimumText}\n\n` +
        `Step 8/11: Announcement Media (Optional)\n\n` +
        `📸 Send an image, video, or GIF for the main chat announcement.\n\n` +
        `This media will be shown when the raffle is announced to the group.\n\n` +
        `Or click "Skip" to continue without announcement media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip Announcement Media', callback_data: 'skip_announcement_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_minimum_purchase' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_announcement_media') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_announcement_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      const minimumText = conversation.data.minimumPurchase
        ? `${conversation.data.minimumPurchase} tokens`
        : 'None';
      
      await bot.editMessageText(
        `✅ Minimum Purchase: ${minimumText}\n\n` +
        `Step 8/11: Announcement Media (Optional)\n\n` +
        `📸 Send an image, video, or GIF for the main chat announcement.\n\n` +
        `This media will be shown when the raffle is announced to the group.\n\n` +
        `Or click "Skip" to continue without announcement media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip Announcement Media', callback_data: 'skip_announcement_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_minimum_purchase' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_notification_media') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_notification_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      const announcementMediaText = conversation.data.announcementMediaUrl
        ? `${conversation.data.announcementMediaType} attached`
        : 'None';
      
      await bot.editMessageText(
        `✅ Announcement Media: ${announcementMediaText}\n\n` +
        `Step 9/11: Notification Media (Optional)\n\n` +
        `📸 Send an image, video, or GIF for user notifications.\n\n` +
        `This media will be shown when users are notified about ticket allocations.\n\n` +
        `Or click "Skip" to continue without notification media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip Notification Media', callback_data: 'skip_notification_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_announcement_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }

    if (callbackData === 'back_to_leaderboard_media') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_leaderboard_media',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      
      const notificationMediaText = conversation.data.notificationMediaUrl
        ? `${conversation.data.notificationMediaType} attached`
        : 'None';
      
      await bot.editMessageText(
        `✅ Notification Media: ${notificationMediaText}\n\n` +
        `Step 10/11: Leaderboard Media (Optional)\n\n` +
        `📸 Send an image, video, or GIF for leaderboard displays.\n\n` +
        `This media will be shown when the leaderboard is displayed.\n\n` +
        `Or click "Skip" to continue without leaderboard media.`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip Leaderboard Media', callback_data: 'skip_leaderboard_media' }],
              [{ text: '🔙 Back', callback_data: 'back_to_notification_media' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
            ],
          },
        }
      );
      return;
    }
  } catch (error) {
    logger.error('Error handling callback query:', error);
    await bot.answerCallbackQuery(query.id, { text: 'Error processing request' });
  }
}

async function createRaffleFromData(chatId: number, data: Record<string, any>): Promise<void> {
  try {
    const raffle = await prisma.raffle.create({
      data: {
        ca: data.contractAddress,
        dex: DEFAULT_DEX,
        startTime: data.startTime ? new Date(data.startTime) : new Date(),
        endTime: new Date(data.endTime),
        prizeType: data.prizeType,
        prizeAmount: data.prizeAmount,
        ticketsPerToken: data.ticketsPerToken || '100',
        minimumPurchase: data.minimumPurchase || null,
        mediaUrl: data.mediaUrl || null,  // Deprecated, kept for backwards compatibility
        mediaType: data.mediaType || null,  // Deprecated, kept for backwards compatibility
        announcementMediaUrl: data.announcementMediaUrl || null,
        announcementMediaType: data.announcementMediaType || null,
        notificationMediaUrl: data.notificationMediaUrl || null,
        notificationMediaType: data.notificationMediaType || null,
        leaderboardMediaUrl: data.leaderboardMediaUrl || null,
        leaderboardMediaType: data.leaderboardMediaType || null,
        status: RAFFLE_STATUS.ACTIVE,
      },
    });

    // Format ticket ratio for display
    const ratio = parseFloat(raffle.ticketsPerToken || '100');
    let ratioDisplay;
    if (ratio >= 1) {
      ratioDisplay = `${ratio} tickets per token`;
    } else {
      const tokensPerTicket = Math.round(1 / ratio);
      ratioDisplay = `1 ticket per ${tokensPerTicket.toLocaleString()} tokens`;
    }

    const minimumText = raffle.minimumPurchase 
      ? `\nMinimum Purchase: ${raffle.minimumPurchase} tokens` 
      : '';

    // Send confirmation to admin
    await bot.sendMessage(
      chatId,
      `✅ **Raffle Created Successfully!**\n\n` +
      `Raffle ID: ${raffle.id}\n` +
      `Contract Address: \`${raffle.ca}\`\n` +
      `DEX: ${DEFAULT_DEX.toUpperCase()}\n` +
      `Start: ${raffle.startTime.toLocaleString()} UTC\n` +
      `Ends: ${raffle.endTime.toLocaleString()} UTC\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}\n` +
      `Ticket Ratio: ${ratioDisplay}${minimumText}`,
      { parse_mode: 'Markdown' }
    );

    // Send announcement to main chat
    if (MAIN_CHAT_ID) {
      try {
        const minimumPurchaseText = raffle.minimumPurchase
          ? `\n\n🎫 **Minimum Purchase for Eligibility:** ${raffle.minimumPurchase} tokens`
          : '';

        const ticketExplanation = ratio >= 1
          ? `For every token you purchase, you'll receive **${ratio} raffle tickets**!`
          : `For every **${Math.round(1 / ratio).toLocaleString()} tokens** you purchase, you'll receive **1 raffle ticket**!`;

        const announcementMessage =
          `🎉 **A New Raffle Has Been Scheduled!** 🎉\n\n` +
          `💰 **Prize:** ${raffle.prizeAmount} ${raffle.prizeType}\n\n` +
          `📅 **Start:** ${raffle.startTime.toLocaleString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'UTC'
          })} UTC\n` +
          `📅 **End:** ${raffle.endTime.toLocaleString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit',
            timeZone: 'UTC'
          })} UTC\n\n` +
          `📝 **Contract Address:**\n\`${raffle.ca}\`${minimumPurchaseText}\n\n` +
          `🎟️ **Ticket Allocation:**\n${ticketExplanation}\n\n` +
          `🔗 **How to Enter:**\n` +
          `1. Link your wallet using /linkwallet <your_wallet_address>\n` +
          `2. Purchase tokens during the raffle period\n` +
          `3. Tickets are automatically allocated based on your purchases\n\n` +
          `⚠️ **Important:** You must link your wallet to receive tickets. You only need to do this once!\n\n` +
          `Good luck! 🍀`;

        // Send with media if available
        if (raffle.announcementMediaUrl && raffle.announcementMediaType) {
          if (raffle.announcementMediaType === 'image') {
            await bot.sendPhoto(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
              caption: announcementMessage,
              parse_mode: 'Markdown',
            });
          } else if (raffle.announcementMediaType === 'video') {
            await bot.sendVideo(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
              caption: announcementMessage,
              parse_mode: 'Markdown',
            });
          } else if (raffle.announcementMediaType === 'gif') {
            await bot.sendAnimation(MAIN_CHAT_ID, raffle.announcementMediaUrl, {
              caption: announcementMessage,
              parse_mode: 'Markdown',
            });
          }
        } else {
          await bot.sendMessage(MAIN_CHAT_ID, announcementMessage, { parse_mode: 'Markdown' });
        }
        logger.info(`Raffle announcement sent to main chat: ${raffle.id}`);
      } catch (error) {
        logger.error('Error sending raffle announcement to main chat:', error);
      }
    }
  } catch (error) {
    logger.error('Error creating raffle:', error);
    await bot.sendMessage(chatId, '❌ Error creating raffle. Please try again.');
  }
}






