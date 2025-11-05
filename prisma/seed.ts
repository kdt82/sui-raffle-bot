import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed admin users (replace with actual Telegram user IDs)
  const adminIds = process.env.TELEGRAM_ADMIN_USER_IDS?.split(',') || [];
  
  for (const userId of adminIds) {
    await prisma.admin.upsert({
      where: { telegramUserId: BigInt(userId.trim()) },
      update: {},
      create: {
        telegramUserId: BigInt(userId.trim()),
        permissions: 'super_admin',
      },
    });
  }

  console.log('Database seeded successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

