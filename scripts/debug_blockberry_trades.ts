import { getBlockberryClient } from '../src/blockchain/blockberry-client';
import { prisma } from '../src/utils/database';
import { RAFFLE_STATUS } from '../src/utils/constants';
import * as fs from 'fs';

async function main() {
    // Get active raffle
    const raffle = await prisma.raffle.findFirst({
        where: {
            status: RAFFLE_STATUS.ACTIVE,
            started: true,
            endTime: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
    });

    if (!raffle) {
        console.log('No active raffle found');
        return;
    }

    console.log(`Active raffle: ${raffle.id}`);
    console.log(`Token CA: ${raffle.ca}`);

    const client = getBlockberryClient();

    if (!client.isConfigured()) {
        console.log('Blockberry is not configured (no API key)');
        return;
    }

    console.log('\nFetching trades from Blockberry...');

    try {
        const response = await client.fetchTrades(raffle.ca, {
            limit: 20,
            sortOrder: 'desc',
        });

        console.log(`\nFound ${response.data.length} transactions`);

        // Write to file for inspection
        fs.writeFileSync(
            'debug_blockberry_trades.json',
            JSON.stringify(response.data, null, 2)
        );

        console.log('\nSample of first transaction:');
        if (response.data.length > 0) {
            console.log(JSON.stringify(response.data[0], null, 2));
        }

        console.log('\n✅ Full data written to debug_blockberry_trades.json');

        // Look for the specific transaction
        const targetTx = 'QWca5tDWPd697TYKyPM1nm6U4SUxsEjwKjRNYCTVygJ';
        const found = response.data.find((trade: any) =>
            trade.txDigest === targetTx ||
            trade.transactionDigest === targetTx ||
            trade.digest === targetTx ||
            trade.tx_hash === targetTx ||
            trade.txHash === targetTx
        );

        if (found) {
            console.log(`\n✅ Found target transaction ${targetTx}:`);
            console.log(JSON.stringify(found, null, 2));
        } else {
            console.log(`\n❌ Target transaction ${targetTx} not found in recent trades`);
        }

    } catch (error: any) {
        console.error('Error fetching from Blockberry:', error.message);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
