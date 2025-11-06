const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRaffle() {
  try {
    const raffle = await prisma.raffle.findUnique({
      where: { id: 'cmho281660000p30ccjwygiif' },
      include: {
        buyEvents: {
          take: 10,
          orderBy: { timestamp: 'desc' }
        },
        tickets: {
          take: 10,
          orderBy: { ticketCount: 'desc' }
        }
      }
    });
    
    console.log('=== RAFFLE DETAILS ===');
    console.log(JSON.stringify(raffle, null, 2));
    
    if (raffle) {
      console.log('\n=== SUMMARY ===');
      console.log(`Status: ${raffle.status}`);
      console.log(`CA: ${raffle.ca}`);
      console.log(`DEX: ${raffle.dex}`);
      console.log(`Start: ${raffle.startTime}`);
      console.log(`End: ${raffle.endTime}`);
      console.log(`Tickets Per Token: ${raffle.ticketsPerToken}`);
      console.log(`Minimum Purchase: ${raffle.minimumPurchase}`);
      console.log(`Buy Events: ${raffle.buyEvents.length}`);
      console.log(`Tickets: ${raffle.tickets.length}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRaffle();
