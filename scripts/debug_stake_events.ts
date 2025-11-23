import { SuiClient } from '@mysten/sui.js/client';
import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

async function checkEvents() {
    const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });

    const eventType = '0x8f70ad5db84e1a99b542f86ccfb1a932ca7ba010a2fa12a1504d839ff4c111c6::moonbags_stake::StakeEvent';
    console.log(`Querying events for type: ${eventType}`);

    try {
        const events = await client.queryEvents({
            query: {
                MoveEventType: eventType
            },
            limit: 5
        });

        fs.writeFileSync('debug_events.json', JSON.stringify(events.data, null, 2));
        console.log('Events written to debug_events.json');

    } catch (error) {
        console.error('Error querying events:', error);
    }
}

checkEvents();
