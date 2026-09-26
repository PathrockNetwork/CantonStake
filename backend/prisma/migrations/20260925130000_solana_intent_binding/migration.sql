ALTER TABLE "StakingIntent" ADD COLUMN "stakeAccountAddress" TEXT;
ALTER TABLE "StakingIntent" ADD COLUMN "stakeRentLamports" TEXT;
ALTER TABLE "StakingIntent" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "StakingIntent_stakeAccountAddress_key" ON "StakingIntent"("stakeAccountAddress");
