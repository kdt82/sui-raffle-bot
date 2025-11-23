import { SuiClient } from '@mysten/sui.js/client';

async function checkDecimals() {
    const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });
    const coinType = '0xab954d078dab0a6727ce58388931850be4bdb6f72703ea3cad3d6eb0c12a0283::aqua::AQUA';

    try {
        const metadata = await client.getCoinMetadata({ coinType });
        console.log('Metadata:', metadata);
    } catch (error) {
        console.error('Error:', error);
    }
}

checkDecimals();
