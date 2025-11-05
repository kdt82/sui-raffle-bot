// Example: How to use metrics in your handlers

import { incrementCommand, recordBuyEvent, incrementTickets, withTelegramMetrics } from '../utils/metrics';
import { bot } from '../bot';

// Example 1: Track command usage
export async function handleStartCommand(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id;
  
  // Track this command
  incrementCommand('start', false); // false = not admin
  
  // Wrap Telegram API calls with metrics
  await withTelegramMetrics('sendMessage', async () => {
    await bot.sendMessage(chatId, 'Welcome!');
  });
}

// Example 2: Track buy events
export async function processBuyEvent(data: BuyEventData): Promise<void> {
  try {
    // ... process buy event ...
    
    // Record successful buy event
    recordBuyEvent('cetus', 'success');
    
    // Track tickets allocated
    incrementTickets(ticketCount);
  } catch (error) {
    // Record failed buy event
    recordBuyEvent('cetus', 'failed');
  }
}

// Example 3: Track database queries
import { withDbMetrics } from '../utils/metrics';

export async function getActiveRaffle() {
  return withDbMetrics('get_active_raffle', async () => {
    return await prisma.raffle.findFirst({
      where: { status: 'active' },
    });
  });
}

// Example 4: Update gauges periodically
import { setActiveRaffles, setWalletLinks } from '../utils/metrics';

export async function updateMetrics() {
  const activeCount = await prisma.raffle.count({ where: { status: 'active' } });
  setActiveRaffles(activeCount);
  
  const walletCount = await prisma.walletUser.count();
  setWalletLinks(walletCount);
}

// Call this every minute
setInterval(updateMetrics, 60000);

