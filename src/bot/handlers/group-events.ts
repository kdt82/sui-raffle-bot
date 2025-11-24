import TelegramBot from 'node-telegram-bot-api';
import { bot } from '../index';
import { prisma } from '../../utils/database';
import { logger } from '../../utils/logger';

/**
 * Handle when the bot is added to a group.
 * This automatically creates a Project and promotes the user who added the bot as admin.
 */
export async function handleBotAddedToGroup(msg: TelegramBot.Message): Promise<void> {
    try {
        // Check if this is a "new_chat_members" event and the bot was added
        if (!msg.new_chat_members) {
            return;
        }

        const botInfo = await bot.getMe();
        const botWasAdded = msg.new_chat_members.some(member => member.id === botInfo.id);

        if (!botWasAdded) {
            return; // Bot wasn't added, ignore
        }

        // The user who added the bot
        const addedBy = msg.from;
        if (!addedBy) {
            logger.warn('Bot was added to group but no user info available');
            return;
        }

        const groupId = BigInt(msg.chat.id);
        const groupName = msg.chat.title || 'Unknown Group';
        const userId = BigInt(addedBy.id);
        const username = addedBy.username;

        logger.info(`Bot added to group "${groupName}" (${groupId}) by user ${userId} (${username})`);

        // Create or get the project
        let project = await prisma.project.findUnique({
            where: { telegramGroupId: groupId },
        });

        if (!project) {
            logger.info(`Creating new project for group ${groupName} (${groupId})`);
            project = await prisma.project.create({
                data: {
                    telegramGroupId: groupId,
                    telegramGroupName: groupName,
                    contractAddress: '', // To be configured
                    tokenName: 'Token',
                    tokenSymbol: 'TKN',
                    dex: 'cetus',
                    broadcastChannelId: groupId, // Default to same group
                },
            });
        }

        // Check if user is already an admin
        const existingAdmin = await prisma.projectAdmin.findUnique({
            where: {
                projectId_telegramUserId: {
                    projectId: project.id,
                    telegramUserId: userId,
                },
            },
        });

        if (!existingAdmin) {
            // Promote the user who added the bot as super_admin
            await prisma.projectAdmin.create({
                data: {
                    projectId: project.id,
                    telegramUserId: userId,
                    permissions: 'super_admin',
                },
            });
            logger.info(`Auto-promoted user ${userId} (${username}) as super_admin of project ${project.id}`);

            // Send a welcome message to the group
            await bot.sendMessage(
                msg.chat.id,
                `🎉 Welcome to SUI Raffle Bot!\n\n` +
                `✅ Project created for "${groupName}"\n` +
                `🔐 <a href="tg://user?id=${userId}">${username || 'Admin'}</a> has been promoted to super admin\n\n` +
                `You can now use admin commands in your private chat with the bot:\n` +
                `• /create_raffle - Create a new raffle\n` +
                `• /adminhelp - See all admin commands\n\n` +
                `Users can:\n` +
                `• /start - Get started\n` +
                `• /leaderboard - View raffle standings\n` +
                `• /mytickets - Check ticket count\n` +
                `• /linkwallet - Link wallet address`,
                { parse_mode: 'HTML' }
            );
        } else {
            logger.info(`User ${userId} is already an admin of project ${project.id}`);
        }
    } catch (error) {
        logger.error('Error handling bot added to group:', error);
    }
}

/**
 * Handle when the bot's status changes in a group (e.g., promoted to admin).
 */
export async function handleBotStatusChange(update: TelegramBot.ChatMemberUpdated): Promise<void> {
    try {
        const botInfo = await bot.getMe();

        // Check if this update is about the bot
        if (update.new_chat_member.user.id !== botInfo.id) {
            return; // Not about the bot
        }

        const oldStatus = update.old_chat_member.status;
        const newStatus = update.new_chat_member.status;

        // Check if bot was promoted to admin
        if (oldStatus !== 'administrator' && newStatus === 'administrator') {
            logger.info(`Bot promoted to admin in group ${update.chat.id} (${update.chat.title})`);

            // Optionally send a message
            await bot.sendMessage(
                update.chat.id,
                `✅ Bot has been promoted to administrator!\n\n` +
                `The bot now has the necessary permissions to manage raffles.`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        logger.error('Error handling bot status change:', error);
    }
}
