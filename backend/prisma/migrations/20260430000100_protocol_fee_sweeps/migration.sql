-- AlterTable
ALTER TABLE "StakingPosition" ADD COLUMN "protocolFeeBps" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN "swept" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastSweepAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RewardRound" ADD COLUMN "totalMarkers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "markerToTxRatio" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RewardSweep" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "nativeRewardWei" TEXT NOT NULL,
    "protocolFeeWei" TEXT NOT NULL,
    "userPayoutWei" TEXT NOT NULL,
    "protocolFeeBps" INTEGER NOT NULL DEFAULT 500,
    "evmTxHash" TEXT,
    "sweptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardSweep_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RewardSweep" ADD CONSTRAINT "RewardSweep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardSweep" ADD CONSTRAINT "RewardSweep_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "StakingPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
