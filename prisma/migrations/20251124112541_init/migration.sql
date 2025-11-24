-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "telegramGroupId" BIGINT NOT NULL,
    "telegramGroupName" TEXT,
    "broadcastChannelId" BIGINT,
    "contractAddress" TEXT NOT NULL,
    "tokenName" TEXT NOT NULL DEFAULT 'Token',
    "tokenSymbol" TEXT NOT NULL DEFAULT 'TKN',
    "dex" TEXT NOT NULL DEFAULT 'cetus',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAdmin" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ca" TEXT NOT NULL,
    "dex" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3) NOT NULL,
    "prizeType" TEXT NOT NULL,
    "prizeAmount" TEXT NOT NULL,
    "prizeDescription" TEXT,
    "minimumPurchase" TEXT,
    "ticketsPerToken" TEXT DEFAULT '100',
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "announcementMediaUrl" TEXT,
    "announcementMediaType" TEXT,
    "notificationMediaUrl" TEXT,
    "notificationMediaType" TEXT,
    "leaderboardMediaUrl" TEXT,
    "leaderboardMediaType" TEXT,
    "randomnessType" TEXT NOT NULL DEFAULT 'client-side',
    "stakingBonusPercent" INTEGER DEFAULT 25,
    "status" TEXT NOT NULL DEFAULT 'active',
    "started" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyEvent" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "BuyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellEvent" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "ticketsRemoved" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakeEvent" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "tokenAmount" TEXT NOT NULL,
    "stakeType" TEXT NOT NULL,
    "ticketsAdjusted" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "stakingPool" TEXT,
    "stakingAccount" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StakeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletUser" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Winner" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "ticketCount" BIGINT NOT NULL,
    "winningTicketNumber" BIGINT,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prizeAwarded" BOOLEAN NOT NULL DEFAULT false,
    "awardedAt" TIMESTAMP(3),
    "awardTxHash" TEXT,
    "selectionMethod" TEXT,
    "randomnessEpoch" TEXT,
    "randomnessProof" TEXT,
    "totalTickets" BIGINT,
    "totalParticipants" INTEGER,

    CONSTRAINT "Winner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "dailySummary" BOOLEAN NOT NULL DEFAULT true,
    "raffleReminders" BOOLEAN NOT NULL DEFAULT true,
    "ticketAllocations" BOOLEAN NOT NULL DEFAULT true,
    "winnerAnnouncements" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "preferredTime" TEXT NOT NULL DEFAULT '09:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledNotification" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT,
    "type" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "targetUserIds" TEXT[],
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAnalytics" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "totalTicketsAllocated" INTEGER NOT NULL DEFAULT 0,
    "totalBuyEvents" INTEGER NOT NULL DEFAULT 0,
    "totalTokenVolume" TEXT NOT NULL DEFAULT '0',
    "commandsExecuted" INTEGER NOT NULL DEFAULT 0,
    "uniqueWallets" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DexDailyStats" (
    "id" TEXT NOT NULL,
    "analyticsId" TEXT NOT NULL,
    "dex" TEXT NOT NULL,
    "buyEvents" INTEGER NOT NULL DEFAULT 0,
    "tokenVolume" TEXT NOT NULL DEFAULT '0',
    "uniqueWallets" INTEGER NOT NULL DEFAULT 0,
    "ticketsAllocated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DexDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleAnalytics" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "totalParticipants" INTEGER NOT NULL DEFAULT 0,
    "totalTickets" INTEGER NOT NULL DEFAULT 0,
    "totalBuyEvents" INTEGER NOT NULL DEFAULT 0,
    "totalTokenVolume" TEXT NOT NULL DEFAULT '0',
    "uniqueWallets" INTEGER NOT NULL DEFAULT 0,
    "averageTicketsPerUser" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medianTicketsPerUser" INTEGER NOT NULL DEFAULT 0,
    "topWalletTickets" INTEGER NOT NULL DEFAULT 0,
    "participationRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaffleAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivity" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "activityType" TEXT NOT NULL,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" BIGINT,
    "performedByUsername" TEXT,
    "targetEntity" TEXT,
    "entityType" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_telegramGroupId_key" ON "Project"("telegramGroupId");

-- CreateIndex
CREATE INDEX "Project_telegramGroupId_idx" ON "Project"("telegramGroupId");

-- CreateIndex
CREATE INDEX "ProjectAdmin_projectId_idx" ON "ProjectAdmin"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAdmin_telegramUserId_idx" ON "ProjectAdmin"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAdmin_projectId_telegramUserId_key" ON "ProjectAdmin"("projectId", "telegramUserId");

-- CreateIndex
CREATE INDEX "Raffle_projectId_idx" ON "Raffle"("projectId");

-- CreateIndex
CREATE INDEX "Raffle_projectId_status_idx" ON "Raffle"("projectId", "status");

-- CreateIndex
CREATE INDEX "Raffle_status_idx" ON "Raffle"("status");

-- CreateIndex
CREATE INDEX "Raffle_endTime_idx" ON "Raffle"("endTime");

-- CreateIndex
CREATE INDEX "Raffle_startTime_idx" ON "Raffle"("startTime");

-- CreateIndex
CREATE INDEX "Raffle_dex_idx" ON "Raffle"("dex");

-- CreateIndex
CREATE INDEX "Ticket_raffleId_ticketCount_idx" ON "Ticket"("raffleId", "ticketCount");

-- CreateIndex
CREATE INDEX "Ticket_walletAddress_idx" ON "Ticket"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_raffleId_walletAddress_key" ON "Ticket"("raffleId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "BuyEvent_transactionHash_key" ON "BuyEvent"("transactionHash");

-- CreateIndex
CREATE INDEX "BuyEvent_raffleId_idx" ON "BuyEvent"("raffleId");

-- CreateIndex
CREATE INDEX "BuyEvent_walletAddress_idx" ON "BuyEvent"("walletAddress");

-- CreateIndex
CREATE INDEX "BuyEvent_transactionHash_idx" ON "BuyEvent"("transactionHash");

-- CreateIndex
CREATE INDEX "BuyEvent_processed_idx" ON "BuyEvent"("processed");

-- CreateIndex
CREATE UNIQUE INDEX "SellEvent_transactionHash_key" ON "SellEvent"("transactionHash");

-- CreateIndex
CREATE INDEX "SellEvent_raffleId_idx" ON "SellEvent"("raffleId");

-- CreateIndex
CREATE INDEX "SellEvent_walletAddress_idx" ON "SellEvent"("walletAddress");

-- CreateIndex
CREATE INDEX "SellEvent_transactionHash_idx" ON "SellEvent"("transactionHash");

-- CreateIndex
CREATE INDEX "SellEvent_processed_idx" ON "SellEvent"("processed");

-- CreateIndex
CREATE UNIQUE INDEX "StakeEvent_transactionHash_key" ON "StakeEvent"("transactionHash");

-- CreateIndex
CREATE INDEX "StakeEvent_raffleId_idx" ON "StakeEvent"("raffleId");

-- CreateIndex
CREATE INDEX "StakeEvent_walletAddress_idx" ON "StakeEvent"("walletAddress");

-- CreateIndex
CREATE INDEX "StakeEvent_transactionHash_idx" ON "StakeEvent"("transactionHash");

-- CreateIndex
CREATE INDEX "StakeEvent_processed_idx" ON "StakeEvent"("processed");

-- CreateIndex
CREATE INDEX "StakeEvent_stakeType_idx" ON "StakeEvent"("stakeType");

-- CreateIndex
CREATE INDEX "WalletUser_projectId_telegramUserId_idx" ON "WalletUser"("projectId", "telegramUserId");

-- CreateIndex
CREATE INDEX "WalletUser_telegramUserId_idx" ON "WalletUser"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletUser_projectId_walletAddress_key" ON "WalletUser"("projectId", "walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_telegramUserId_key" ON "Admin"("telegramUserId");

-- CreateIndex
CREATE INDEX "Admin_telegramUserId_idx" ON "Admin"("telegramUserId");

-- CreateIndex
CREATE INDEX "Winner_raffleId_idx" ON "Winner"("raffleId");

-- CreateIndex
CREATE INDEX "Winner_walletAddress_idx" ON "Winner"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Winner_raffleId_key" ON "Winner"("raffleId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_telegramUserId_key" ON "NotificationPreference"("telegramUserId");

-- CreateIndex
CREATE INDEX "NotificationPreference_telegramUserId_idx" ON "NotificationPreference"("telegramUserId");

-- CreateIndex
CREATE INDEX "ScheduledNotification_type_idx" ON "ScheduledNotification"("type");

-- CreateIndex
CREATE INDEX "ScheduledNotification_scheduledFor_sent_idx" ON "ScheduledNotification"("scheduledFor", "sent");

-- CreateIndex
CREATE INDEX "ScheduledNotification_raffleId_idx" ON "ScheduledNotification"("raffleId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnalytics_date_key" ON "DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "DailyAnalytics_date_idx" ON "DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "DexDailyStats_analyticsId_idx" ON "DexDailyStats"("analyticsId");

-- CreateIndex
CREATE INDEX "DexDailyStats_dex_idx" ON "DexDailyStats"("dex");

-- CreateIndex
CREATE UNIQUE INDEX "DexDailyStats_analyticsId_dex_key" ON "DexDailyStats"("analyticsId", "dex");

-- CreateIndex
CREATE UNIQUE INDEX "RaffleAnalytics_raffleId_key" ON "RaffleAnalytics"("raffleId");

-- CreateIndex
CREATE INDEX "RaffleAnalytics_raffleId_idx" ON "RaffleAnalytics"("raffleId");

-- CreateIndex
CREATE INDEX "UserActivity_telegramUserId_idx" ON "UserActivity"("telegramUserId");

-- CreateIndex
CREATE INDEX "UserActivity_activityType_idx" ON "UserActivity"("activityType");

-- CreateIndex
CREATE INDEX "UserActivity_timestamp_idx" ON "UserActivity"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_performedBy_idx" ON "AuditLog"("performedBy");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_targetEntity_idx" ON "AuditLog"("targetEntity");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_success_idx" ON "AuditLog"("success");

-- AddForeignKey
ALTER TABLE "ProjectAdmin" ADD CONSTRAINT "ProjectAdmin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Raffle" ADD CONSTRAINT "Raffle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyEvent" ADD CONSTRAINT "BuyEvent_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellEvent" ADD CONSTRAINT "SellEvent_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StakeEvent" ADD CONSTRAINT "StakeEvent_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletUser" ADD CONSTRAINT "WalletUser_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Winner" ADD CONSTRAINT "Winner_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DexDailyStats" ADD CONSTRAINT "DexDailyStats_analyticsId_fkey" FOREIGN KEY ("analyticsId") REFERENCES "DailyAnalytics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
