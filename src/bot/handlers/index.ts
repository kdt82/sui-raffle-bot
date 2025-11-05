import { bot } from '../index';
import { logger } from '../../utils/logger';
import { handleStartCommand, handleLeaderboardCommand, handleMyTicketsCommand, handleLinkWalletCommand } from './user';
import { handleCreateRaffle, handleSetPrize, handleUploadMedia, handleAwardPrize, handleConfig } from './admin';
import { handleCreateRaffleCallback, handleCreateRaffleStep } from './admin-ui';
import { handleNotificationsCommand, handleNotificationsToggle, handleNotificationsTime } from './notifications';
import { handleAnalyticsCommand, handleAnalyticsRafflesCommand, handleAnalyticsExportCommand, handleAnalyticsLiveCommand } from './analytics';
import { handleBackupCommand, handleBackupListCommand, handleBackupDownloadCommand, handleBackupRestoreCommand, handleBackupRaffleCommand, handleBackupCleanupCommand } from './backup';
import { requireAdmin } from '../middleware';
import { conversationManager } from '../conversation';
import { withCallbackRateLimit } from '../rate-limit-middleware';

export function registerUserHandlers(): void {
  bot.onText(/\/start/, async (msg) => {
    try {
      await handleStartCommand(msg);
    } catch (error) {
      logger.error('Error handling /start command:', error);
    }
  });

  bot.onText(/\/leaderboard/, async (msg) => {
    try {
      await handleLeaderboardCommand(msg);
    } catch (error) {
      logger.error('Error handling /leaderboard command:', error);
    }
  });

  bot.onText(/\/mytickets/, async (msg) => {
    try {
      await handleMyTicketsCommand(msg);
    } catch (error) {
      logger.error('Error handling /mytickets command:', error);
    }
  });

  bot.onText(/\/linkwallet/, async (msg) => {
    try {
      await handleLinkWalletCommand(msg);
    } catch (error) {
      logger.error('Error handling /linkwallet command:', error);
    }
  });

  bot.onText(/\/notifications$/, async (msg) => {
    try {
      await handleNotificationsCommand(msg);
    } catch (error) {
      logger.error('Error handling /notifications command:', error);
    }
  });

  bot.onText(/\/notifications_toggle/, async (msg) => {
    try {
      await handleNotificationsToggle(msg);
    } catch (error) {
      logger.error('Error handling /notifications_toggle command:', error);
    }
  });

  bot.onText(/\/notifications_time/, async (msg) => {
    try {
      await handleNotificationsTime(msg);
    } catch (error) {
      logger.error('Error handling /notifications_time command:', error);
    }
  });
}

export function registerAdminHandlers(): void {
  // Handle callback queries for interactive UI
  bot.on('callback_query', async (query) => {
    try {
      const callbackData = query.data;
      if (!callbackData) return;

      // Check if it's a create_raffle callback
      if (callbackData.startsWith('select_dex_') ||
          callbackData.startsWith('select_prize_type_') ||
          callbackData === 'confirm_create_raffle' ||
          callbackData === 'cancel_create_raffle' ||
          callbackData.startsWith('back_to_')) {
        await withCallbackRateLimit(query, 'callback_ui', async () => {
          await requireAdmin(query.message!, async () => {
            await handleCreateRaffleCallback(query);
          });
        });
      }
    } catch (error) {
      logger.error('Error handling callback query:', error);
    }
  });

  // Handle text messages that might be part of a conversation
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return; // Skip commands

    try {
      const userId = BigInt(msg.from!.id);
      const conversation = conversationManager.getConversation(userId, msg.chat.id);
      
      if (conversation && conversation.step.startsWith('create_raffle')) {
        await requireAdmin(msg, async () => {
          await handleCreateRaffleStep(msg, conversation.step, conversation.data);
        });
      }
    } catch (error) {
      logger.error('Error handling conversation message:', error);
    }
  });

  bot.onText(/\/create_raffle/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleCreateRaffle(msg);
      } catch (error) {
        logger.error('Error handling /create_raffle command:', error);
      }
    });
  });

  bot.onText(/\/set_prize/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleSetPrize(msg);
      } catch (error) {
        logger.error('Error handling /set_prize command:', error);
      }
    });
  });

  bot.onText(/\/upload_media/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleUploadMedia(msg);
      } catch (error) {
        logger.error('Error handling /upload_media command:', error);
      }
    });
  });

  bot.onText(/\/award_prize/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleAwardPrize(msg);
      } catch (error) {
        logger.error('Error handling /award_prize command:', error);
      }
    });
  });

  bot.onText(/\/config/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleConfig(msg);
      } catch (error) {
        logger.error('Error handling /config command:', error);
      }
    });
  });

  bot.onText(/\/analytics$/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleAnalyticsCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics command:', error);
      }
    });
  });

  bot.onText(/\/analytics_raffles/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleAnalyticsRafflesCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics_raffles command:', error);
      }
    });
  });

  bot.onText(/\/analytics_export/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleAnalyticsExportCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics_export command:', error);
      }
    });
  });

  bot.onText(/\/analytics_live/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleAnalyticsLiveCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics_live command:', error);
      }
    });
  });

  bot.onText(/\/backup$/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleBackupCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup command:', error);
      }
    });
  });

  bot.onText(/\/backup_list/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleBackupListCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_list command:', error);
      }
    });
  });

  bot.onText(/\/backup_download/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleBackupDownloadCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_download command:', error);
      }
    });
  });

  bot.onText(/\/backup_restore/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleBackupRestoreCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_restore command:', error);
      }
    });
  });

  bot.onText(/\/backup_raffle/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleBackupRaffleCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_raffle command:', error);
      }
    });
  });

  bot.onText(/\/backup_cleanup/, async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleBackupCleanupCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_cleanup command:', error);
      }
    });
  });

  // Handle media uploads
  bot.on('photo', async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleUploadMedia(msg);
      } catch (error) {
        logger.error('Error handling photo upload:', error);
      }
    });
  });

  bot.on('video', async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleUploadMedia(msg);
      } catch (error) {
        logger.error('Error handling video upload:', error);
      }
    });
  });

  bot.on('animation', async (msg) => {
    await requireAdmin(msg, async () => {
      try {
        await handleUploadMedia(msg);
      } catch (error) {
        logger.error('Error handling GIF upload:', error);
      }
    });
  });
}

