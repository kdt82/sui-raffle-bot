import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { RAFFLE_STATUS } from '../utils/constants';
import { notificationService } from './notification-service';
import { trackRaffleEvent } from '../utils/metrics';
import { getSuiClient } from '../blockchain/sui-client';
import { bot } from '../bot';
import { suiRandomnessService, clientSideWeightedRandom } from '../blockchain/sui-randomness';

export async function selectWinner(raffleId: string): Promise<void> {
  try {
    logger.info(`Selecting winner for raffle: ${raffleId}`);

    // Get all tickets for this raffle
    const tickets = await prisma.ticket.findMany({
      where: {
        raffleId,
        ticketCount: { gt: 0 },
      },
    });

    if (tickets.length === 0) {
      logger.warn(`No tickets found for raffle ${raffleId}`);
      await prisma.raffle.update({
        where: { id: raffleId },
        data: { status: RAFFLE_STATUS.WINNER_SELECTED },
      });
      return;
    }

    // Calculate total tickets
    const totalTickets = tickets.reduce((sum, ticket) => sum + ticket.ticketCount, 0);

    // Use SUI's on-chain randomness if configured, otherwise fall back to client-side
    const winner = await selectWinnerWithRandomness(raffleId, tickets);

    // Create winner record
    const winnerRecord = await prisma.winner.create({
      data: {
        raffleId,
        walletAddress: winner.walletAddress,
        ticketCount: winner.ticketCount,
      },
    });

    // Update raffle status
    await prisma.raffle.update({
      where: { id: raffleId },
      data: { status: RAFFLE_STATUS.WINNER_SELECTED },
    });

    logger.info(`Winner selected: ${winner.walletAddress} with ${winner.ticketCount} tickets (Method: ${winner.selectionMethod})`);

    // Track metrics
    trackRaffleEvent('winner_selected');

    // Broadcast winner announcement
    await notificationService.broadcastWinnerAnnouncement(raffleId);

    // Send admin alert
    await notificationService.sendAdminAlert(
      `🎉 Winner selected!\n\n` +
      `Winner: \`${winner.walletAddress.slice(0, 8)}...${winner.walletAddress.slice(-6)}\`\n` +
      `Tickets: ${winner.ticketCount.toLocaleString()}\n` +
      `Method: ${winner.selectionMethod}\n\n` +
      `Award the prize using /award_prize`
    );

    // Notify winner if wallet is linked
    const walletUser = await prisma.walletUser.findUnique({
      where: { walletAddress: winner.walletAddress },
    });

    if (walletUser) {
      try {
        const raffle = await prisma.raffle.findUnique({
          where: { id: raffleId },
        });

        await bot.sendMessage(
          walletUser.telegramUserId.toString(),
          `🎉 Congratulations! You won the raffle!\n\n` +
          `Prize: ${raffle?.prizeAmount} ${raffle?.prizeType}\n` +
          `Your tickets: ${winner.ticketCount.toLocaleString()}\n` +
          `Wallet: ${winner.walletAddress}\n\n` +
          `The prize will be awarded manually by an admin.`
        );
      } catch (error) {
        logger.warn(`Could not notify winner ${walletUser.telegramUserId}:`, error);
      }
    }
  } catch (error) {
    logger.error('Error selecting winner:', error);
    throw error;
  }
}

interface TicketWithWeight {
  walletAddress: string;
  ticketCount: number;
}

interface WinnerResult extends TicketWithWeight {
  selectionMethod: 'on-chain' | 'client-side';
  randomnessProof?: any;
}

/**
 * Select winner using SUI on-chain randomness with fallback
 */
async function selectWinnerWithRandomness(
  raffleId: string,
  tickets: TicketWithWeight[]
): Promise<WinnerResult> {
  try {
    // Try to use on-chain randomness if configured
    if (suiRandomnessService.isConfigured()) {
      logger.info(`Using SUI on-chain randomness for raffle ${raffleId}`);
      
      const weights = tickets.map(t => t.ticketCount);
      const selectedIndex = await suiRandomnessService.generateWeightedRandom(
        weights,
        raffleId
      );
      
      // Get verifiable proof
      const totalTickets = weights.reduce((sum, w) => sum + w, 0);
      const proof = await suiRandomnessService.generateVerifiableRandom(
        totalTickets,
        raffleId
      );
      
      return {
        ...tickets[selectedIndex],
        selectionMethod: 'on-chain',
        randomnessProof: proof,
      };
    } else {
      logger.info(`Using client-side randomness for raffle ${raffleId} (on-chain not configured)`);
      
      const weights = tickets.map(t => t.ticketCount);
      const selectedIndex = clientSideWeightedRandom(weights);
      
      return {
        ...tickets[selectedIndex],
        selectionMethod: 'client-side',
      };
    }
  } catch (error) {
    logger.error('Error with on-chain randomness, falling back to client-side:', error);
    
    // Fallback to client-side randomness
    const weights = tickets.map(t => t.ticketCount);
    const selectedIndex = clientSideWeightedRandom(weights);
    
    return {
      ...tickets[selectedIndex],
      selectionMethod: 'client-side',
    };
  }
}

