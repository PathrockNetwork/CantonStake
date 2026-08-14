-- Phase 2 (T2.2): the ValidatorShare contract address is per-VALIDATOR on
-- Polygon PoS, so it has to be persisted per position instead of read from a
-- single global config value. Unbond nonce + withdraw epoch are the
-- authoritative, checkpoint-based claim condition.
ALTER TABLE "StakingPosition" ADD COLUMN "validatorAddress" TEXT;
ALTER TABLE "StakingPosition" ADD COLUMN "validatorShare" TEXT;
ALTER TABLE "StakingPosition" ADD COLUMN "validatorId" INTEGER;
ALTER TABLE "StakingPosition" ADD COLUMN "unbondNonce" TEXT;
ALTER TABLE "StakingPosition" ADD COLUMN "unbondWithdrawEpoch" TEXT;
