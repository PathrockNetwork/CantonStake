CREATE TABLE "StakingIntent" (
    "requestContractId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "validatorAddress" TEXT,
    "evmAddress" TEXT NOT NULL,
    "amountPol" TEXT NOT NULL,
    "acceptedTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    CONSTRAINT "StakingIntent_pkey" PRIMARY KEY ("requestContractId")
);

CREATE INDEX "StakingIntent_chain_evmAddress_amountPol_idx" ON "StakingIntent"("chain", "evmAddress", "amountPol");

ALTER TABLE "StakingPosition" ADD COLUMN "unbondAmountBaseUnits" TEXT;
ALTER TABLE "StakingPosition" ADD COLUMN "suiStakedObjectId" TEXT;

CREATE TABLE "WatcherCursor" (
    "key" TEXT NOT NULL,
    "lastScannedBlock" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WatcherCursor_pkey" PRIMARY KEY ("key")
);
