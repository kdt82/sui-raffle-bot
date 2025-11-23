import { prisma } from '../src/utils/database';

async function deleteSpecificStake() {
    const txHash = 'FsrSLnmWduUfXUXbU2iyENcbFYNZ7tZR4A8Aj4JZYLka:0';
    console.log(`Deleting stake event with hash: ${txHash}`);

    const result = await prisma.stakeEvent.deleteMany({
        where: {
            transactionHash: txHash
        }
    });

    console.log(`Deleted ${result.count} events.`);
}

deleteSpecificStake();
