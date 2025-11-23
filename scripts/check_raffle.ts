import { prisma } from '../src/utils/database';
import { RAFFLE_STATUS } from '../src/utils/constants';

async function checkActiveRaffle() {
    const raffle = await prisma.raffle.findFirst({
        where: {
            status: RAFFLE_STATUS.ACTIVE,
            endTime: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
    });

    if (raffle) {
        console.log('Active Raffle Found:');
        console.log(`ID: ${raffle.id}`);
        console.log(`CA: ${raffle.ca}`);
        console.log(`Staking Bonus: ${raffle.stakingBonusPercent}%`);
        console.log(`Tickets Per Token: ${raffle.ticketsPerToken}`);
    } else {
        console.log('No active raffle found.');
    }
}

checkActiveRaffle();
