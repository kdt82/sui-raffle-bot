-- AlterTable
ALTER TABLE "Winner" ADD COLUMN     "selectionMethod" TEXT,
ADD COLUMN     "randomnessEpoch" TEXT,
ADD COLUMN     "randomnessProof" TEXT,
ADD COLUMN     "totalTickets" INTEGER,
ADD COLUMN     "totalParticipants" INTEGER;
