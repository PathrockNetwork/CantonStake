CREATE TABLE "ProviderRewardCoupon" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "synchronizerId" TEXT NOT NULL,
    "providerParty" TEXT NOT NULL,
    "networkRound" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "createdOffset" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedOffset" TEXT,
    "archivedAt" TIMESTAMP(3),
    "roundId" TEXT,
    CONSTRAINT "ProviderRewardCoupon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderRewardCoupon_contractId_key" ON "ProviderRewardCoupon"("contractId");
CREATE INDEX "ProviderRewardCoupon_roundId_idx" ON "ProviderRewardCoupon"("roundId");

ALTER TABLE "ProviderRewardCoupon" ADD CONSTRAINT "ProviderRewardCoupon_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "RewardRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
