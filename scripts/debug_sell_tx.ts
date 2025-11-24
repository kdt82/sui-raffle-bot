import { SuiClient } from '@mysten/sui.js/client';
import * as fs from 'fs';

async function debugSellTx() {
    const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });
    const txHash = 'BwJeT5QWRXzLLFiEWyxoSNhEnjRs6sxxzKb42cn5rAWA';

    console.log(`Inspecting transaction: ${txHash}`);

    try {
        const tx = await client.getTransactionBlock({
            digest: txHash,
            options: {
                showEvents: true,
                showEffects: true,
                showBalanceChanges: true,
                showInput: true
            }
        });

        fs.writeFileSync('debug_sell_tx.json', JSON.stringify(tx, null, 2));
        console.log('Transaction details written to debug_sell_tx.json');

        // Analyze for TransferEvents
        if (tx.events) {
            console.log('\nEvents found:');
            for (const event of tx.events) {
                console.log(`  Type: ${event.type}`);
                if (event.type.includes('TransferEvent')) {
                    console.log('  -> TransferEvent found!');
                }
            }
        }

        // Analyze balance changes
        if (tx.balanceChanges) {
            console.log('\nBalance Changes:');
            for (const change of tx.balanceChanges) {
                console.log(`  Owner: ${change.owner}`);
                console.log(`  Coin: ${change.coinType}`);
                console.log(`  Amount: ${change.amount}`);
            }
        }

    } catch (error) {
        console.error('Error fetching transaction:', error);
    }
}

debugSellTx();
