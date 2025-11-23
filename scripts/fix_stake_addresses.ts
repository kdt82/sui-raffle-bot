import { prisma } from '../src/utils/database';
import { getRedisClient } from '../src/utils/redis';
import { Queue } from 'bullmq';
import { STAKE_EVENTS_QUEUE } from '../src/blockchain/stake-detector';

async function fixStakeAddresses() {
    console.log('Checking for stake events with invalid wallet addresses...');

    const events = await prisma.stakeEvent.findMany({
        where: {
            walletAddress: {
                not: {
                    startsWith: '0x'
                }
            }
        }
    });

    console.log(`Found ${events.length} events to fix.`);

    const queue = new Queue(STAKE_EVENTS_QUEUE, {
        connection: getRedisClient(),
    });

    for (const event of events) {
        const fixedAddress = '0x' + event.walletAddress;
        console.log(`Fixing event ${event.id}: ${event.walletAddress} -> ${fixedAddress}`);

        // Update DB
        await prisma.stakeEvent.update({
            where: { id: event.id },
            data: {
                walletAddress: fixedAddress,
                processed: false
            }
        });

        // Re-queue job
        await queue.add('adjust-tickets', {
            stakeEventId: event.id,
            raffleId: event.raffleId,
            walletAddress: fixedAddress,
            tokenAmount: event.tokenAmount,
            ticketsAdjusted: event.ticketsAdjusted,
            stakeType: event.stakeType,
        });

        console.log(`Re-queued job for event ${event.id}`);
    }

    console.log('Done.');
    process.exit(0);
}

fixStakeAddresses();
