import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillWinningTicketNumber() {
  try {
    console.log('Finding winners without ticket numbers...');
    
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

    console.log(`Found ${winners.length} winners to update`);

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

      console.log(`Winner ${winner.walletAddress}:`);
      console.log(`  Ticket range: ${winnerTicketStart} - ${winnerTicketEnd}`);
      console.log(`  Random winning ticket: ${winningTicketNumber}`);

      // Update the winner record
      await prisma.winner.update({
        where: { id: winner.id },
        data: {
          winningTicketNumber: winningTicketNumber,
        },
      });

      console.log(`✅ Updated winner ${winner.id}`);
    }

    console.log(`\n✅ Backfill complete! Updated ${winners.length} winners.`);
  } catch (error) {
    console.error('Error backfilling winning ticket numbers:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

backfillWinningTicketNumber();
