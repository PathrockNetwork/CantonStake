-- CreateTable
CREATE TABLE "TvlSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "evmAddress" TEXT,
    "totalUsd" DOUBLE PRECISION NOT NULL,
    "perChain" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TvlSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TvlSnapshot_userId_idx" ON "TvlSnapshot"("userId");

-- CreateIndex
CREATE INDEX "TvlSnapshot_snapshotAt_idx" ON "TvlSnapshot"("snapshotAt");

-- AddForeignKey
ALTER TABLE "TvlSnapshot" ADD CONSTRAINT "TvlSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AutoCompoundPermit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "validator" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'compound',
    "signature" TEXT,
    "signaturePayload" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxPerRun" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoCompoundPermit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoCompoundPermit_userId_idx" ON "AutoCompoundPermit"("userId");

-- CreateIndex
CREATE INDEX "AutoCompoundPermit_chain_enabled_expiresAt_idx" ON "AutoCompoundPermit"("chain", "enabled", "expiresAt");

-- AddForeignKey
ALTER TABLE "AutoCompoundPermit" ADD CONSTRAINT "AutoCompoundPermit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AutoCompoundRun" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "amountClaimed" TEXT,
    "amountRestaked" TEXT,
    "txHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AutoCompoundRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoCompoundRun_permitId_idx" ON "AutoCompoundRun"("permitId");

-- CreateIndex
CREATE INDEX "AutoCompoundRun_status_idx" ON "AutoCompoundRun"("status");

-- AddForeignKey
ALTER TABLE "AutoCompoundRun" ADD CONSTRAINT "AutoCompoundRun_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "AutoCompoundPermit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
