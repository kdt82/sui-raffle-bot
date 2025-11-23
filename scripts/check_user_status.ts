import { prisma } from '../src/utils/database';

async function checkUserStatus() {
    const wallet = '0xdf358ad3258ea732f705b6e6d0f652f21b5878a388c427affff622f0d137f6c2';

    console.log(`Checking status for wallet: ${wallet}`);

    // Check Ticket
    const tickets = await prisma.ticket.findMany({
        where: { walletAddress: wallet }
    });
    console.log('\nTickets:', tickets);

    // Check Stake Events
    const stakes = await prisma.stakeEvent.findMany({
        where: { walletAddress: wallet }
    });
    console.log('\nStake Events:', stakes);
}

checkUserStatus();
