import { prisma } from '../src/utils/database';

async function deleteBadStakeEvents() {
    console.log('Deleting stake events with invalid wallet addresses...');

    const result = await prisma.stakeEvent.deleteMany({
        where: {
            walletAddress: {
                not: {
                    startsWith: '0x'
                }
            }
        }
    });

    console.log(`Deleted ${result.count} events.`);
}

deleteBadStakeEvents();
