import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase, prisma } from '../src/utils/database';
import { getRedisClient, closeRedis } from '../src/utils/redis';
import { getSellEventsQueue } from '../src/blockchain/sell-detector';
import { startSellWorker, stopSellWorker } from '../src/workers/sell-worker';
import { logger } from '../src/utils/logger';

dotenv.config();

async function testSellWorker() {
    try {
        await connectDatabase();
        getRedisClient();

        // 1. Create a dummy raffle
        const raffle = await prisma.raffle.create({
            data: {
                ca: '0xTEST_COIN',
                dex: 'test',
                endTime: new Date(Date.now() + 1000000),
                prizeType: 'SUI',
                prizeAmount: '100',
                status: 'active',
            },
        });

        // 2. Create a dummy ticket for a user
        const walletAddress = '0xUSER_WALLET';
        await prisma.ticket.create({
            data: {
                raffleId: raffle.id,
                walletAddress,
                ticketCount: 100,
            },
        });

        console.log('Created raffle and initial tickets (100)');

        // 3. Start the worker
        startSellWorker();

        // 4. Create a dummy sell event
        const sellEvent = await prisma.sellEvent.create({
            data: {
                raffleId: raffle.id,
                walletAddress,
                tokenAmount: '50',
                ticketsRemoved: 50,
                transactionHash: '0xTX_HASH_' + Date.now(),
                processed: false,
            },
        });

        // 5. Add to queue
        const queue = getSellEventsQueue();
        await queue.add('remove-tickets', {
            sellEventId: sellEvent.id,
            raffleId: raffle.id,
            walletAddress,
            ticketsRemoved: 50,
        });

        console.log('Added sell event to queue (remove 50 tickets)');

        // 6. Wait for processing
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // 7. Verify result
        const updatedTicket = await prisma.ticket.findUnique({
            where: {
                raffleId_walletAddress: {
                    raffleId: raffle.id,
                    walletAddress,
                },
            },
        });

        console.log(`Updated ticket count: ${updatedTicket?.ticketCount}`);

        if (updatedTicket?.ticketCount === 50) {
            console.log('✅ TEST PASSED: Tickets correctly removed.');
        } else {
            console.error('❌ TEST FAILED: Ticket count incorrect.');
        }

        // Cleanup
        await prisma.sellEvent.deleteMany({ where: { raffleId: raffle.id } });
        await prisma.ticket.deleteMany({ where: { raffleId: raffle.id } });
        await prisma.raffle.delete({ where: { id: raffle.id } });

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await stopSellWorker();
        await closeRedis();
        await disconnectDatabase();
    }
}

testSellWorker();
