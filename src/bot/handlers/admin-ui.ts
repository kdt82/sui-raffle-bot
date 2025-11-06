import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';
import { PRIZE_TYPES, RAFFLE_STATUS, MEDIA_TYPES, DEFAULT_DEX, getDexDisplayName, DexType } from '../../utils/constants';
import { conversationManager } from '../conversation';

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
    `Step 1/5: Contract Address\n\n` +
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
    case 'create_raffle_end_time':
      await handleEndTimeStep(msg, data);
      break;
    case 'create_raffle_prize_type':
      await handlePrizeTypeStep(msg, data);
      break;
    case 'create_raffle_prize_amount':
      await handlePrizeAmountStep(msg, data);
      break;
    case 'create_raffle_minimum_purchase':
      await handleMinimumPurchaseStep(msg, data);
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
    step: 'create_raffle_end_time',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '🔙 Back', callback_data: 'back_to_contract' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ Contract Address: \`${contractAddress}\`\n\n` +
    `Step 2/5: End Time\n\n` +
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

  if (endTime <= new Date()) {
    await bot.sendMessage(chatId, `❌ End time must be in the future.\n\nCurrent time: ${new Date().toISOString()}\nYour time: ${endTime.toISOString()}`);
    return;
  }

  data.endTime = endTime.toISOString();
  conversationManager.updateConversation(userId, chatId, {
    step: 'create_raffle_prize_type',
    data,
  });

  // Create prize type selection keyboard
  const prizeButtons = PRIZE_TYPES.map(type => ({
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
    `✅ End Time: ${endTime.toLocaleString()}\n\n` +
    `Step 3/5: Prize Type\n\n` +
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
    step: 'create_raffle_minimum_purchase',
    data,
  });

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: '⏭️ Skip (No Minimum)', callback_data: 'skip_minimum_purchase' }],
      [{ text: '🔙 Back', callback_data: 'back_to_prize_type' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  await bot.sendMessage(
    chatId,
    `✅ Prize Amount: ${prizeAmount}\n\n` +
    `Step 5/5: Minimum Purchase (Optional)\n\n` +
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
      [{ text: '🔙 Back', callback_data: 'back_to_minimum_purchase' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
    ],
  };

  const dexValue = typeof data.dex === 'string' && data.dex.length > 0 ? data.dex : DEFAULT_DEX;
  const dexDisplay = getDexDisplayName(dexValue as DexType).toUpperCase();
  
  const minimumText = data.minimumPurchase 
    ? `\nMinimum Purchase: ${data.minimumPurchase} tokens` 
    : '\nMinimum Purchase: None';

  await bot.sendMessage(
    chatId,
    `📋 **Review Raffle Details**\n\n` +
    `Contract Address: \`${data.contractAddress}\`\n` +
    `Data: ${dexDisplay}\n` +
    `Prize Type: ${data.prizeType}\n` +
    `Prize Amount: ${data.prizeAmount}${minimumText}\n\n` +
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
        `Step 4/5: Prize Amount\n\n` +
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

    if (callbackData === 'skip_minimum_purchase') {
      conversation.data.minimumPurchase = null;
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_review',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id, { text: 'Skipped minimum purchase' });
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
        `Step 1/4: Contract Address\n\n` +
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

    if (callbackData === 'back_to_end_time') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_end_time',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(
        `? Contract Address: \`${conversation.data.contractAddress}\`\n\n` +
        `Step 2/4: End Time\n\n` +
        `Please send the raffle end time in format: DD/MM/YYYY HH:mm:ss (UTC)\n\n` +
        `Example: 31/12/2024 23:59:59`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '?? Back', callback_data: 'back_to_contract' }, { text: '? Cancel', callback_data: 'cancel_create_raffle' }],
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
      const prizeButtons = PRIZE_TYPES.map(type => ({
        text: type,
        callback_data: `select_prize_type_${type}`,
      }));
      await bot.editMessageText(
        `✅ End Time: ${new Date(conversation.data.endTime).toLocaleString()}\n\n` +
        `Step 3/4: Prize Type\n\n` +
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
        `Step 4/5: Prize Amount\n\n` +
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

    if (callbackData === 'back_to_minimum_purchase') {
      conversationManager.updateConversation(userId, chatId, {
        step: 'create_raffle_minimum_purchase',
        data: conversation.data,
      });
      await bot.answerCallbackQuery(query.id);
      await bot.editMessageText(
        `✅ Prize Amount: ${conversation.data.prizeAmount}\n\n` +
        `Step 5/5: Minimum Purchase (Optional)\n\n` +
        `Set a minimum token purchase amount to earn tickets.\n` +
        `Purchases below this amount will not earn tickets.\n\n` +
        `⚠️ **Important:** Enter amount in **token units** (not raw units)\n` +
        `Example: Enter "10" for 10 tokens, not "10000000000"\n\n` +
        `Send the minimum amount, or click "Skip" for no minimum:`,
        {
          chat_id: chatId,
          message_id: query.message!.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '⏭️ Skip (No Minimum)', callback_data: 'skip_minimum_purchase' }],
              [{ text: '🔙 Back', callback_data: 'back_to_prize_amount' }, { text: '❌ Cancel', callback_data: 'cancel_create_raffle' }],
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
        startTime: new Date(),
        endTime: new Date(data.endTime),
        prizeType: data.prizeType,
        prizeAmount: data.prizeAmount,
        status: RAFFLE_STATUS.ACTIVE,
      },
    });

    await bot.sendMessage(
      chatId,
      `✅ **Raffle Created Successfully!**\n\n` +
      `Raffle ID: ${raffle.id}\n` +
      `Contract Address: \`${raffle.ca}\`\n` +
      `DEX: ${DEFAULT_DEX.toUpperCase()}\n` +
      `Ends: ${raffle.endTime.toLocaleString()}\n` +
      `Prize: ${raffle.prizeAmount} ${raffle.prizeType}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error('Error creating raffle:', error);
    await bot.sendMessage(chatId, '❌ Error creating raffle. Please try again.');
  }
}






