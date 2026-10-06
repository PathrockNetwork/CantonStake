CREATE TABLE "RewardPayout" (
    "id" TEXT NOT NULL,
    "recipientKind" TEXT NOT NULL,
    "recipientParty" TEXT NOT NULL,
    "userId" TEXT,
    "amount" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "commandId" TEXT NOT NULL,
    "transferKind" TEXT,
    "updateId" TEXT,
    "transferInstructionCid" TEXT,
    "executeBefore" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "RewardPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardPayout_commandId_key" ON "RewardPayout"("commandId");
CREATE INDEX "RewardPayout_status_idx" ON "RewardPayout"("status");

ALTER TABLE "RewardEvent" ADD COLUMN "userPayoutId" TEXT;
ALTER TABLE "RewardEvent" ADD COLUMN "treasuryPayoutId" TEXT;
CREATE INDEX "RewardEvent_userPayoutId_idx" ON "RewardEvent"("userPayoutId");
CREATE INDEX "RewardEvent_treasuryPayoutId_idx" ON "RewardEvent"("treasuryPayoutId");
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_userPayoutId_fkey" FOREIGN KEY ("userPayoutId") REFERENCES "RewardPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RewardEvent" ADD CONSTRAINT "RewardEvent_treasuryPayoutId_fkey" FOREIGN KEY ("treasuryPayoutId") REFERENCES "RewardPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
