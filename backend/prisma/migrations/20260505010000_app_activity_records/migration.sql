-- CreateTable
CREATE TABLE "AppActivityRecord" (
    "id" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "party" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "trafficShare" DOUBLE PRECISION NOT NULL,
    "ccAttributed" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "onchainEventCid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppActivityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppActivityRecord_roundNumber_idx" ON "AppActivityRecord"("roundNumber");

-- CreateIndex
CREATE INDEX "AppActivityRecord_party_idx" ON "AppActivityRecord"("party");

-- CreateIndex
CREATE UNIQUE INDEX "AppActivityRecord_roundNumber_party_eventId_key" ON "AppActivityRecord"("roundNumber", "party", "eventId");
