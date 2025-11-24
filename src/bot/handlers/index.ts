import { bot } from '../index';
import { logger } from '../../utils/logger';
import { handleStartCommand, handleLeaderboardCommand, handleMyTicketsCommand, handleLinkWalletCommand, handleWalletStatusCommand, handleUnlinkWalletCommand, handleMyIdCommand } from './user';
import { handleCreateRaffle, handleSetPrize, handleSetMinimumPurchase, handleUploadMedia, handleAwardPrize, handleShowWinner, handleSelectWinner, handleConfig, handleCancelRaffle, handleResetTickets, handleAddTickets, handleRemoveTickets, handleBackfillTicketNumber, handleStartRaffle, handleEndRaffle, handleVerifyStakeCommand, handleVerifySellCommand } from './admin';
import { handleCreateRaffleCallback, handleCreateRaffleStep } from './admin-ui';
import { handleNotificationsCommand, handleNotificationsToggle, handleNotificationsTime } from './notifications';
import { handleAnalyticsCommand, handleAnalyticsRafflesCommand, handleAnalyticsExportCommand, handleAnalyticsLiveCommand } from './analytics';
import { handleBackupCommand, handleBackupListCommand, handleBackupDownloadCommand, handleBackupRestoreCommand, handleBackupRaffleCommand, handleBackupCleanupCommand } from './backup';
import { handleAuditLogsCommand, handleAuditLogsRaffleCommand, handleAuditFailuresCommand } from './audit';
import { handleAdminHelpCommand, handleWalletListCommand } from './help';
import { requireAdmin, requireAdminCallback, requireAdminPrivate, requireAdminPrivateCallback } from '../middleware';
import { conversationManager } from '../conversation';
import { withCallbackRateLimit } from '../rate-limit-middleware';
import { handleBotAddedToGroup, handleBotStatusChange } from './group-events';

export function registerUserHandlers(): void {
  bot.onText(/\/start/, async (msg) => {
    try {
      await handleStartCommand(msg);
    } catch (error) {
      logger.error('Error handling /start command:', error);
    }
  });

  bot.onText(/\/myid/, async (msg) => {
    try {
      await handleMyIdCommand(msg);
    } catch (error) {
      logger.error('Error handling /myid command:', error);
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

  bot.onText(/\/walletstatus/, async (msg) => {
    try {
      await handleWalletStatusCommand(msg);
    } catch (error) {
      logger.error('Error handling /walletstatus command:', error);
    }
  });

  bot.onText(/\/unlinkwallet/, async (msg) => {
    try {
      await handleUnlinkWalletCommand(msg);
    } catch (error) {
      logger.error('Error handling /unlinkwallet command:', error);
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

  // Handle bot being added to a group
  bot.on('new_chat_members', async (msg) => {
    try {
      await handleBotAddedToGroup(msg);
    } catch (error) {
      logger.error('Error handling new_chat_members event:', error);
    }
  });

  // Handle bot status changes (e.g., promoted to admin)
  bot.on('my_chat_member', async (msg) => {
    try {
      await handleBotStatusChange(msg);
    } catch (error) {
      logger.error('Error handling my_chat_member event:', error);
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
      if (callbackData.startsWith('select_prize_type_') ||
        callbackData === 'confirm_create_raffle' ||
        callbackData === 'cancel_create_raffle' ||
        callbackData === 'start_now' ||
        callbackData === 'ratio_default' ||
        callbackData === 'skip_minimum_purchase' ||
        callbackData === 'skip_media' ||
        callbackData === 'skip_announcement_media' ||
        callbackData === 'skip_notification_media' ||
        callbackData === 'skip_leaderboard_media' ||
        callbackData.startsWith('staking_bonus_') ||
        callbackData === 'skip_staking_bonus' ||
        callbackData.startsWith('back_to_')) {
        await withCallbackRateLimit(query, 'callback_ui', async () => {
          await requireAdminPrivateCallback(query, async () => {
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
    // Skip commands but allow media and regular text messages
    if (msg.text && msg.text.startsWith('/')) return;

    try {
      const userId = BigInt(msg.from!.id);
      const conversation = conversationManager.getConversation(userId, msg.chat.id);

      if (conversation && conversation.step.startsWith('create_raffle')) {
        await requireAdminPrivate(msg, async () => {
          await handleCreateRaffleStep(msg, conversation.step, conversation.data);
        });
      }
    } catch (error) {
      logger.error('Error handling conversation message:', error);
    }
  });

  bot.onText(/\/create_raffle/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleCreateRaffle(msg);
      } catch (error) {
        logger.error('Error handling /create_raffle command:', error);
      }
    });
  });

  bot.onText(/\/cancel_raffle/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleCancelRaffle(msg);
      } catch (error) {
        logger.error('Error handling /cancel_raffle command:', error);
      }
    });
  });

  bot.onText(/\/verify_stake/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleVerifyStakeCommand(msg);
      } catch (error) {
        logger.error('Error handling /verify_stake command:', error);
      }
    });
  });

  bot.onText(/\/verify_sell/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleVerifySellCommand(msg);
      } catch (error) {
        logger.error('Error handling /verify_sell command:', error);
      }
    });
  });

  bot.onText(/\/reset_tickets/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleResetTickets(msg);
      } catch (error) {
        logger.error('Error handling /reset_tickets command:', error);
      }
    });
  });

  bot.onText(/\/set_prize/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleSetPrize(msg);
      } catch (error) {
        logger.error('Error handling /set_prize command:', error);
      }
    });
  });

  bot.onText(/\/set_minimum_purchase/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleSetMinimumPurchase(msg);
      } catch (error) {
        logger.error('Error handling /set_minimum_purchase command:', error);
      }
    });
  });

  bot.onText(/\/upload_media/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        const userId = BigInt(msg.from!.id);
        const conversation = conversationManager.getConversation(userId, msg.chat.id);

        // Don't allow /upload_media during raffle creation
        if (conversation && conversation.step.startsWith('create_raffle')) {
          await bot.sendMessage(
            msg.chat.id,
            '⚠️ You are currently creating a raffle.\n\n' +
            'Please complete or cancel the raffle creation process first.\n\n' +
            'Use the buttons provided or send /cancel_raffle to cancel.'
          );
          return;
        }

        await handleUploadMedia(msg);
      } catch (error) {
        logger.error('Error handling /upload_media command:', error);
      }
    });
  });

  bot.onText(/\/award_prize/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAwardPrize(msg);
      } catch (error) {
        logger.error('Error handling /award_prize command:', error);
      }
    });
  });

  bot.onText(/\/winner/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleShowWinner(msg);
      } catch (error) {
        logger.error('Error handling /winner command:', error);
      }
    });
  });

  bot.onText(/\/select_winner/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleSelectWinner(msg);
      } catch (error) {
        logger.error('Error handling /select_winner command:', error);
      }
    });
  });

  bot.onText(/\/config/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleConfig(msg);
      } catch (error) {
        logger.error('Error handling /config command:', error);
      }
    });
  });

  // bot.onText(/\/chatinfo/, async (msg) => {
  //   await requireAdmin(msg, async () => {
  //     try {
  //       await handleChatInfo(msg);
  //     } catch (error) {
  //       logger.error('Error handling /chatinfo command:', error);
  //     }
  //   });
  // });

  bot.onText(/\/analytics$/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAnalyticsCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics command:', error);
      }
    });
  });

  bot.onText(/\/analytics_raffles/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAnalyticsRafflesCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics_raffles command:', error);
      }
    });
  });

  bot.onText(/\/analytics_export/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAnalyticsExportCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics_export command:', error);
      }
    });
  });

  bot.onText(/\/analytics_live/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAnalyticsLiveCommand(msg);
      } catch (error) {
        logger.error('Error handling /analytics_live command:', error);
      }
    });
  });

  bot.onText(/\/backup$/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackupCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup command:', error);
      }
    });
  });

  bot.onText(/\/backup_list/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackupListCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_list command:', error);
      }
    });
  });

  bot.onText(/\/backup_download/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackupDownloadCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_download command:', error);
      }
    });
  });

  bot.onText(/\/backup_restore/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackupRestoreCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_restore command:', error);
      }
    });
  });

  bot.onText(/\/backup_raffle/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackupRaffleCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_raffle command:', error);
      }
    });
  });

  bot.onText(/\/backup_cleanup/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackupCleanupCommand(msg);
      } catch (error) {
        logger.error('Error handling /backup_cleanup command:', error);
      }
    });
  });

  bot.onText(/\/add_tickets/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAddTickets(msg);
      } catch (error) {
        logger.error('Error handling /add_tickets command:', error);
      }
    });
  });

  bot.onText(/\/remove_tickets/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleRemoveTickets(msg);
      } catch (error) {
        logger.error('Error handling /remove_tickets command:', error);
      }
    });
  });

  // Audit log commands
  bot.onText(/\/auditlogs$/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAuditLogsCommand(msg);
      } catch (error) {
        logger.error('Error handling /auditlogs command:', error);
      }
    });
  });

  bot.onText(/\/auditlogs_raffle/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAuditLogsRaffleCommand(msg);
      } catch (error) {
        logger.error('Error handling /auditlogs_raffle command:', error);
      }
    });
  });

  bot.onText(/\/auditfailures/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAuditFailuresCommand(msg);
      } catch (error) {
        logger.error('Error handling /auditfailures command:', error);
      }
    });
  });

  // Help and utility commands
  bot.onText(/\/adminhelp/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleAdminHelpCommand(msg);
      } catch (error) {
        logger.error('Error handling /adminhelp command:', error);
      }
    });
  });

  bot.onText(/\/walletlist/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleWalletListCommand(msg);
      } catch (error) {
        logger.error('Error handling /walletlist command:', error);
      }
    });
  });

  bot.onText(/\/backfill_ticket_number/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleBackfillTicketNumber(msg);
      } catch (error) {
        logger.error('Error handling /backfill_ticket_number command:', error);
      }
    });
  });

  bot.onText(/\/start_raffle/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleStartRaffle(msg);
      } catch (error) {
        logger.error('Error handling /start_raffle command:', error);
      }
    });
  });

  bot.onText(/\/end_raffle/, async (msg) => {
    await requireAdminPrivate(msg, async () => {
      try {
        await handleEndRaffle(msg);
      } catch (error) {
        logger.error('Error handling /end_raffle command:', error);
      }
    });
  });
}
