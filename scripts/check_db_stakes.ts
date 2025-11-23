import { prisma } from '../src/utils/database';

async function checkStakeEvents() {
    const events = await prisma.stakeEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: 5,
        include: {
            raffle: true
        }
    });

    console.log('Recent Stake Events:');
    for (const event of events) {
        console.log(`\nID: ${event.id}`);
        console.log(`Tx: ${event.transactionHash}`);
        console.log(`Wallet: ${event.walletAddress}`);
        console.log(`Amount: ${event.tokenAmount}`);
        console.log(`Tickets Adjusted: ${event.ticketsAdjusted}`);
        console.log(`Processed: ${event.processed}`);
        console.log(`Raffle: ${event.raffleId}`);
    }
}

checkStakeEvents();
