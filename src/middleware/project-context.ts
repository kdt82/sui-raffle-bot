import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import TelegramBot from 'node-telegram-bot-api';

export interface ProjectContext {
    id: string;
    telegramGroupId: bigint;
    telegramGroupName: string | null;
    contractAddress: string;
    tokenName: string;
    tokenSymbol: string;
    dex: string;
}

/**
 * Get project context from a Telegram message
 * If the message is from a group, it tries to find the project associated with that group.
 */
export async function getProjectContext(msg: TelegramBot.Message): Promise<ProjectContext | null> {
    // If it's a private chat, we can't determine the project from the chat ID alone
    // unless we have some state or the user is an admin of only one project.
    // For now, we'll return null for private chats unless we implement a selection mechanism.
    if (msg.chat.type === 'private') {
        return null;
    }

    const groupId = BigInt(msg.chat.id);

    try {
        const project = await prisma.project.findUnique({
            where: { telegramGroupId: groupId },
        });

        if (!project) {
            return null;
        }

        return {
            id: project.id,
            telegramGroupId: project.telegramGroupId,
            telegramGroupName: project.telegramGroupName,
            contractAddress: project.contractAddress,
            tokenName: project.tokenName,
            tokenSymbol: project.tokenSymbol,
            dex: project.dex,
        };
    } catch (error) {
        logger.error(`Error getting project context for group ${groupId}:`, error);
        return null;
    }
}

/**
 * Ensure a project exists for the given group.
 * This is typically called on /start in a group.
 */
export async function ensureProjectExists(msg: TelegramBot.Message): Promise<ProjectContext> {
    if (msg.chat.type === 'private') {
        throw new Error('Cannot create project from private chat');
    }

    const groupId = BigInt(msg.chat.id);
    const groupName = msg.chat.title || 'Unknown Group';

    try {
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

        return {
            id: project.id,
            telegramGroupId: project.telegramGroupId,
            telegramGroupName: project.telegramGroupName,
            contractAddress: project.contractAddress,
            tokenName: project.tokenName,
            tokenSymbol: project.tokenSymbol,
            dex: project.dex,
        };
    } catch (error) {
        logger.error(`Error ensuring project exists for group ${groupId}:`, error);
        throw error;
    }
}

/**
 * Get project context for an admin user.
 * - If in a group, returns that group's project.
 * - If in private chat, checks if user is admin of exactly one project.
 * - If user manages multiple projects, returns null (caller must handle selection).
 */
export async function getAdminProjectContext(msg: TelegramBot.Message): Promise<ProjectContext | null> {
    // 1. Try to get context from message (group chat)
    const context = await getProjectContext(msg);
    if (context) return context;

    // 2. If private chat, check user's projects
    if (msg.chat.type === 'private') {
        const userId = BigInt(msg.from!.id);

        const projectAdmins = await prisma.projectAdmin.findMany({
            where: { telegramUserId: userId },
            include: { project: true }
        });

        if (projectAdmins.length === 1) {
            const project = projectAdmins[0].project;
            return {
                id: project.id,
                telegramGroupId: project.telegramGroupId,
                telegramGroupName: project.telegramGroupName,
                contractAddress: project.contractAddress,
                tokenName: project.tokenName,
                tokenSymbol: project.tokenSymbol,
                dex: project.dex,
            };
        }
    }

    return null;
}
