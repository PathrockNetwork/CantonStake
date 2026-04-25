-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "cantonPartyId" TEXT NOT NULL,
    "displayName" TEXT,
    "evmAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakingPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "cantonTxId" TEXT,
    "evmAddress" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'polygon-amoy',
    "evmTxHash" TEXT,
    "amountPol" TEXT NOT NULL,
    "amountShares" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "markersEmitted" INTEGER NOT NULL DEFAULT 0,
    "totalCcEarned" TEXT NOT NULL DEFAULT '0',
    "unbondingStartedAt" TIMESTAMP(3),
    "unbondingReadyAt" TIMESTAMP(3),
    "unbondingPeriod" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StakingPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRound" (
    "id" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "totalCcMinted" TEXT NOT NULL DEFAULT '0',
    "totalTxns" INTEGER NOT NULL DEFAULT 0,
    "networkTotalTxns" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,

    CONSTRAINT "RewardRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "ccAmount" TEXT NOT NULL,
    "userShare" TEXT NOT NULL,
    "treasuryShare" TEXT NOT NULL,
    "userWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "treasuryWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "cantonTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_cantonPartyId_key" ON "User"("cantonPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_evmAddress_key" ON "User"("evmAddress");

-- CreateIndex
CREATE UNIQUE INDEX "StakingPosition_contractId_key" ON "StakingPosition"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRound_roundNumber_key" ON "RewardRound"("roundNumber");

-- AddForeignKey
ALTER TABLE "StakingPosition" ADD CONSTRAINT "StakingPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "StakingPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "RewardRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;