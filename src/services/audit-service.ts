import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export interface AuditLogEntry {
  action: string;
  performedBy?: bigint | number;
  performedByUsername?: string;
  targetEntity?: string;
  entityType?: string;
  oldValue?: any;
  newValue?: any;
  metadata?: any;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Audit Service - Comprehensive logging of all system actions
 * This is a non-blocking service that logs in background
 */
class AuditService {
  /**
   * Log an audit entry
   * Non-blocking - errors are logged but don't interrupt the main flow
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const userId = entry.performedBy ? BigInt(entry.performedBy) : null;

      await prisma.auditLog.create({
        data: {
          action: entry.action,
          performedBy: userId,
          performedByUsername: entry.performedByUsername || null,
          targetEntity: entry.targetEntity || null,
          entityType: entry.entityType || null,
          oldValue: entry.oldValue ? JSON.stringify(entry.oldValue) : null,
          newValue: entry.newValue ? JSON.stringify(entry.newValue) : null,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          success: entry.success !== undefined ? entry.success : true,
          errorMessage: entry.errorMessage || null,
        },
      });

      logger.debug(`Audit log created: ${entry.action}`, {
        performedBy: userId?.toString(),
        targetEntity: entry.targetEntity,
      });
    } catch (error) {
      // Never throw - audit logging should not break main functionality
      logger.error('Failed to create audit log (non-blocking):', error);
    }
  }

  /**
   * Log raffle creation
   */
  async logRaffleCreated(
    adminId: bigint,
    adminUsername: string | undefined,
    raffle: any
  ): Promise<void> {
    await this.log({
      action: 'raffle_created',
      performedBy: adminId,
      performedByUsername: adminUsername,
      targetEntity: raffle.id,
      entityType: 'raffle',
      newValue: {
        ca: raffle.ca,
        startTime: raffle.startTime,
        endTime: raffle.endTime,
        prizeType: raffle.prizeType,
        prizeAmount: raffle.prizeAmount,
        ticketsPerToken: raffle.ticketsPerToken,
        minimumPurchase: raffle.minimumPurchase,
      },
    });
  }

  /**
   * Log raffle started (automated announcement)
   */
  async logRaffleStarted(raffleId: string): Promise<void> {
    await this.log({
      action: 'raffle_started',
      performedBy: undefined, // System action
      targetEntity: raffleId,
      entityType: 'raffle',
      metadata: { automated: true },
    });
  }

  /**
   * Log raffle ended
   */
  async logRaffleEnded(raffleId: string, raffle: any): Promise<void> {
    await this.log({
      action: 'raffle_ended',
      performedBy: undefined, // System action
      targetEntity: raffleId,
      entityType: 'raffle',
      oldValue: { status: 'active' },
      newValue: { status: 'ended' },
      metadata: {
        endTime: raffle.endTime,
        automated: true,
      },
    });
  }

  /**
   * Log winner selection
   */
  async logWinnerSelected(
    raffleId: string,
    winner: any,
    totalTickets: number,
    participants: number
  ): Promise<void> {
    await this.log({
      action: 'winner_selected',
      performedBy: undefined, // System action
      targetEntity: raffleId,
      entityType: 'raffle',
      newValue: {
        winnerWallet: winner.walletAddress,
        winnerTickets: winner.ticketCount,
      },
      metadata: {
        totalTickets,
        totalParticipants: participants,
        automated: true,
      },
    });
  }

  /**
   * Log prize awarded
   */
  async logPrizeAwarded(
    adminId: bigint,
    adminUsername: string | undefined,
    raffleId: string,
    winnerWallet: string
  ): Promise<void> {
    await this.log({
      action: 'prize_awarded',
      performedBy: adminId,
      performedByUsername: adminUsername,
      targetEntity: raffleId,
      entityType: 'raffle',
      metadata: { winnerWallet },
    });
  }

  /**
   * Log wallet linking
   */
  async logWalletLinked(
    userId: bigint,
    username: string | undefined,
    walletAddress: string,
    isNew: boolean
  ): Promise<void> {
    await this.log({
      action: isNew ? 'wallet_linked' : 'wallet_relinked',
      performedBy: userId,
      performedByUsername: username,
      targetEntity: walletAddress,
      entityType: 'wallet',
      newValue: { walletAddress },
    });
  }

  /**
   * Log wallet unlinking
   */
  async logWalletUnlinked(
    userId: bigint,
    username: string | undefined,
    walletAddress: string
  ): Promise<void> {
    await this.log({
      action: 'wallet_unlinked',
      performedBy: userId,
      performedByUsername: username,
      targetEntity: walletAddress,
      entityType: 'wallet',
      oldValue: { walletAddress },
    });
  }

  /**
   * Log manual ticket addition
   */
  async logTicketsAdded(
    adminId: bigint,
    adminUsername: string | undefined,
    raffleId: string,
    walletAddress: string,
    oldTickets: number,
    newTickets: number,
    addedAmount: number
  ): Promise<void> {
    await this.log({
      action: 'tickets_added',
      performedBy: adminId,
      performedByUsername: adminUsername,
      targetEntity: raffleId,
      entityType: 'ticket',
      oldValue: { ticketCount: oldTickets },
      newValue: { ticketCount: newTickets },
      metadata: {
        walletAddress,
        addedAmount,
      },
    });
  }

  /**
   * Log manual ticket removal
   */
  async logTicketsRemoved(
    adminId: bigint,
    adminUsername: string | undefined,
    raffleId: string,
    walletAddress: string,
    oldTickets: number,
    newTickets: number,
    removedAmount: number
  ): Promise<void> {
    await this.log({
      action: 'tickets_removed',
      performedBy: adminId,
      performedByUsername: adminUsername,
      targetEntity: raffleId,
      entityType: 'ticket',
      oldValue: { ticketCount: oldTickets },
      newValue: { ticketCount: newTickets },
      metadata: {
        walletAddress,
        removedAmount,
      },
    });
  }

  /**
   * Log ticket reset
   */
  async logTicketsReset(
    adminId: bigint,
    adminUsername: string | undefined,
    raffleId: string,
    totalTicketsReset: number,
    walletsAffected: number
  ): Promise<void> {
    await this.log({
      action: 'tickets_reset',
      performedBy: adminId,
      performedByUsername: adminUsername,
      targetEntity: raffleId,
      entityType: 'ticket',
      metadata: {
        totalTicketsReset,
        walletsAffected,
      },
    });
  }

  /**
   * Log raffle cancellation
   */
  async logRaffleCancelled(
    adminId: bigint,
    adminUsername: string | undefined,
    raffleId: string
  ): Promise<void> {
    await this.log({
      action: 'raffle_cancelled',
      performedBy: adminId,
      performedByUsername: adminUsername,
      targetEntity: raffleId,
      entityType: 'raffle',
      oldValue: { status: 'active' },
      newValue: { status: 'ended' },
    });
  }

  /**
   * Log buy event detected
   */
  async logBuyEventDetected(
    raffleId: string,
    walletAddress: string,
    tokenAmount: string,
    ticketCount: number,
    txHash: string
  ): Promise<void> {
    await this.log({
      action: 'buy_event_detected',
      performedBy: undefined, // Blockchain event
      targetEntity: raffleId,
      entityType: 'buy_event',
      metadata: {
        walletAddress,
        tokenAmount,
        ticketCount,
        transactionHash: txHash,
      },
    });
  }

  /**
   * Log failed action
   */
  async logFailure(
    action: string,
    userId: bigint | undefined,
    username: string | undefined,
    errorMessage: string,
    metadata?: any
  ): Promise<void> {
    await this.log({
      action,
      performedBy: userId,
      performedByUsername: username,
      success: false,
      errorMessage,
      metadata,
    });
  }

  /**
   * Query audit logs with filters
   */
  async queryLogs(filters: {
    action?: string;
    performedBy?: bigint;
    targetEntity?: string;
    entityType?: string;
    success?: boolean;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    try {
      const where: any = {};

      if (filters.action) where.action = filters.action;
      if (filters.performedBy) where.performedBy = filters.performedBy;
      if (filters.targetEntity) where.targetEntity = filters.targetEntity;
      if (filters.entityType) where.entityType = filters.entityType;
      if (filters.success !== undefined) where.success = filters.success;

      if (filters.startDate || filters.endDate) {
        where.timestamp = {};
        if (filters.startDate) where.timestamp.gte = filters.startDate;
        if (filters.endDate) where.timestamp.lte = filters.endDate;
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: filters.limit || 100,
      });

      return logs;
    } catch (error) {
      logger.error('Failed to query audit logs:', error);
      return [];
    }
  }

  /**
   * Get recent logs for a specific raffle
   */
  async getRaffleLogs(raffleId: string, limit: number = 50): Promise<any[]> {
    return this.queryLogs({
      targetEntity: raffleId,
      limit,
    });
  }

  /**
   * Get recent logs for a specific user
   */
  async getUserLogs(userId: bigint, limit: number = 50): Promise<any[]> {
    return this.queryLogs({
      performedBy: userId,
      limit,
    });
  }

  /**
   * Get all failed actions in time range
   */
  async getFailedActions(startDate: Date, endDate: Date): Promise<any[]> {
    return this.queryLogs({
      success: false,
      startDate,
      endDate,
      limit: 500,
    });
  }
}

export const auditService = new AuditService();
