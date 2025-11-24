import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRedisClient } from '../utils/redis';

export interface BackupMetadata {
  id: string;
  timestamp: Date;
  type: 'full' | 'raffle' | 'manual';
  size: number;
  status: 'success' | 'failed';
  error?: string;
}

export class BackupService {
  private backupDir: string;

  constructor() {
    this.backupDir = process.env.BACKUP_DIR || './backups';
  }

  /**
   * Initialize backup directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      logger.info(`Backup directory initialized: ${this.backupDir}`);
    } catch (error) {
      logger.error('Failed to initialize backup directory:', error);
      throw error;
    }
  }

  /**
   * Create a full database backup
   */
  async createFullBackup(): Promise<BackupMetadata> {
    const backupId = `full_${Date.now()}`;
    const timestamp = new Date();

    try {
      logger.info('Starting full database backup...');

      // Fetch all data
      const [
        raffles,
        tickets,
        buyEvents,
        walletUsers,
        admins,
        winners,
        notificationPreferences,
        scheduledNotifications,
        dailyAnalytics,
        dexDailyStats,
        raffleAnalytics,
        userActivities,
      ] = await Promise.all([
        prisma.raffle.findMany(),
        prisma.ticket.findMany(),
        prisma.buyEvent.findMany(),
        prisma.walletUser.findMany(),
        prisma.admin.findMany(),
        prisma.winner.findMany(),
        prisma.notificationPreference.findMany(),
        prisma.scheduledNotification.findMany(),
        prisma.dailyAnalytics.findMany({ include: { dexStats: true } }),
        prisma.dexDailyStats.findMany(),
        prisma.raffleAnalytics.findMany(),
        prisma.userActivity.findMany({
          where: {
            timestamp: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
            },
          },
        }),
      ]);

      // Get Redis data (conversation states)
      const redis = getRedisClient();
      const conversationKeys = await redis.keys('conversation:*');
      const conversations: Record<string, string> = {};
      for (const key of conversationKeys) {
        const value = await redis.get(key);
        if (value) conversations[key] = value;
      }

      // Create backup object
      const backup = {
        metadata: {
          id: backupId,
          timestamp: timestamp.toISOString(),
          type: 'full' as const,
          version: '1.0',
        },
        data: {
          raffles,
          tickets,
          buyEvents,
          walletUsers,
          admins,
          winners,
          notificationPreferences,
          scheduledNotifications,
          dailyAnalytics,
          dexDailyStats,
          raffleAnalytics,
          userActivities,
        },
        redis: {
          conversations,
        },
      };

      // Write to file
      const filename = `${backupId}.json`;
      const filepath = path.join(this.backupDir, filename);
      const content = JSON.stringify(backup, null, 2);
      await fs.writeFile(filepath, content, 'utf-8');

      const size = Buffer.byteLength(content, 'utf-8');

      logger.info(`Full backup created: ${filename} (${this.formatSize(size)})`);

      return {
        id: backupId,
        timestamp,
        type: 'full',
        size,
        status: 'success',
      };
    } catch (error) {
      logger.error('Failed to create full backup:', error);
      return {
        id: backupId,
        timestamp,
        type: 'full',
        size: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a raffle-specific backup
   */
  async createRaffleBackup(raffleId: string): Promise<BackupMetadata> {
    const backupId = `raffle_${raffleId}_${Date.now()}`;
    const timestamp = new Date();

    try {
      logger.info(`Creating backup for raffle ${raffleId}...`);

      // Fetch raffle and related data
      const raffle = await prisma.raffle.findUnique({
        where: { id: raffleId },
        include: {
          tickets: true,
          buyEvents: true,
          winners: true,
        },
      });

      if (!raffle) {
        throw new Error(`Raffle ${raffleId} not found`);
      }

      // Get raffle analytics if exists
      const analytics = await prisma.raffleAnalytics.findUnique({
        where: { raffleId },
      });

      // Create backup object
      const backup = {
        metadata: {
          id: backupId,
          timestamp: timestamp.toISOString(),
          type: 'raffle' as const,
          raffleId,
          version: '1.0',
        },
        data: {
          raffle,
          analytics,
        },
      };

      // Write to file
      const filename = `${backupId}.json`;
      const filepath = path.join(this.backupDir, filename);
      const content = JSON.stringify(backup, null, 2);
      await fs.writeFile(filepath, content, 'utf-8');

      const size = Buffer.byteLength(content, 'utf-8');

      logger.info(`Raffle backup created: ${filename} (${this.formatSize(size)})`);

      return {
        id: backupId,
        timestamp,
        type: 'raffle',
        size,
        status: 'success',
      };
    } catch (error) {
      logger.error(`Failed to create raffle backup for ${raffleId}:`, error);
      return {
        id: backupId,
        timestamp,
        type: 'raffle',
        size: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List all backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups: BackupMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filepath = path.join(this.backupDir, file);
        const stats = await fs.stat(filepath);

        // Parse backup ID and type from filename
        const match = file.match(/^(full|raffle|manual)_(.+)\.json$/);
        if (!match) continue;

        const type = match[1] as 'full' | 'raffle' | 'manual';
        const id = file.replace('.json', '');

        backups.push({
          id,
          timestamp: stats.mtime,
          type,
          size: stats.size,
          status: 'success',
        });
      }

      // Sort by timestamp (newest first)
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return backups;
    } catch (error) {
      logger.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Get backup file path
   */
  getBackupPath(backupId: string): string {
    return path.join(this.backupDir, `${backupId}.json`);
  }

  /**
   * Delete old backups
   */
  async cleanupOldBackups(retentionDays: number = 30): Promise<number> {
    try {
      const backups = await this.listBackups();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      let deletedCount = 0;

      for (const backup of backups) {
        if (backup.timestamp < cutoffDate) {
          const filepath = this.getBackupPath(backup.id);
          await fs.unlink(filepath);
          deletedCount++;
          logger.info(`Deleted old backup: ${backup.id}`);
        }
      }

      logger.info(`Cleaned up ${deletedCount} old backups (retention: ${retentionDays} days)`);
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old backups:', error);
      return 0;
    }
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupId: string, options: {
    skipRaffles?: boolean;
    skipAnalytics?: boolean;
    skipUsers?: boolean;
  } = {}): Promise<void> {
    try {
      logger.info(`Starting restore from backup: ${backupId}`);

      const filepath = this.getBackupPath(backupId);
      const content = await fs.readFile(filepath, 'utf-8');
      const backup = JSON.parse(content);

      if (backup.metadata.type === 'full') {
        // Restore full backup
        const data = backup.data;

        if (!options.skipUsers) {
          // Restore admins
          for (const admin of data.admins) {
            await prisma.admin.upsert({
              where: { telegramUserId: admin.telegramUserId },
              create: admin,
              update: admin,
            });
          }

          // Restore wallet users
          for (const user of data.walletUsers) {
            await prisma.walletUser.upsert({
              where: {
                projectId_walletAddress: {
                  projectId: user.projectId,
                  walletAddress: user.walletAddress
                }
              },
              create: user,
              update: user,
            });
          }

          // Restore notification preferences
          for (const pref of data.notificationPreferences) {
            await prisma.notificationPreference.upsert({
              where: { telegramUserId: pref.telegramUserId },
              create: pref,
              update: pref,
            });
          }
        }

        if (!options.skipRaffles) {
          // Restore raffles and related data
          for (const raffle of data.raffles) {
            await prisma.raffle.upsert({
              where: { id: raffle.id },
              create: raffle,
              update: raffle,
            });
          }

          for (const ticket of data.tickets) {
            await prisma.ticket.upsert({
              where: {
                raffleId_walletAddress: {
                  raffleId: ticket.raffleId,
                  walletAddress: ticket.walletAddress,
                },
              },
              create: ticket,
              update: ticket,
            });
          }

          for (const buyEvent of data.buyEvents) {
            await prisma.buyEvent.upsert({
              where: { transactionHash: buyEvent.transactionHash },
              create: buyEvent,
              update: buyEvent,
            });
          }

          for (const winner of data.winners) {
            await prisma.winner.upsert({
              where: { raffleId: winner.raffleId },
              create: winner,
              update: winner,
            });
          }
        }

        if (!options.skipAnalytics) {
          // Restore analytics (create only, don't update)
          for (const analytics of data.dailyAnalytics) {
            await prisma.dailyAnalytics.upsert({
              where: { date: analytics.date },
              create: analytics,
              update: analytics,
            });
          }

          for (const raffleAnalytics of data.raffleAnalytics) {
            await prisma.raffleAnalytics.upsert({
              where: { raffleId: raffleAnalytics.raffleId },
              create: raffleAnalytics,
              update: raffleAnalytics,
            });
          }
        }

        // Restore Redis conversations
        if (backup.redis && backup.redis.conversations) {
          const redis = getRedisClient();
          for (const [key, value] of Object.entries(backup.redis.conversations)) {
            await redis.set(key, value as string);
            await redis.expire(key, 3600); // 1 hour expiry
          }
        }
      } else if (backup.metadata.type === 'raffle') {
        // Restore raffle backup
        const raffle = backup.data.raffle;

        await prisma.raffle.upsert({
          where: { id: raffle.id },
          create: raffle,
          update: raffle,
        });

        for (const ticket of raffle.tickets || []) {
          await prisma.ticket.upsert({
            where: {
              raffleId_walletAddress: {
                raffleId: ticket.raffleId,
                walletAddress: ticket.walletAddress,
              },
            },
            create: ticket,
            update: ticket,
          });
        }

        for (const buyEvent of raffle.buyEvents || []) {
          await prisma.buyEvent.upsert({
            where: { transactionHash: buyEvent.transactionHash },
            create: buyEvent,
            update: buyEvent,
          });
        }

        if (raffle.winners && raffle.winners.length > 0) {
          for (const winner of raffle.winners) {
            await prisma.winner.upsert({
              where: { raffleId: winner.raffleId },
              create: winner,
              update: winner,
            });
          }
        }

        if (backup.data.analytics) {
          await prisma.raffleAnalytics.upsert({
            where: { raffleId: backup.data.analytics.raffleId },
            create: backup.data.analytics,
            update: backup.data.analytics,
          });
        }
      }

      logger.info(`Successfully restored from backup: ${backupId}`);
    } catch (error) {
      logger.error(`Failed to restore from backup ${backupId}:`, error);
      throw error;
    }
  }

  /**
   * Export backup as downloadable file
   */
  async getBackupFile(backupId: string): Promise<Buffer> {
    try {
      const filepath = this.getBackupPath(backupId);
      return await fs.readFile(filepath);
    } catch (error) {
      logger.error(`Failed to read backup file ${backupId}:`, error);
      throw error;
    }
  }

  /**
   * Format file size for display
   */
  private formatSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  }
}

// Singleton instance
export const backupService = new BackupService();

