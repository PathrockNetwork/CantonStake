ALTER TABLE "User" ADD COLUMN "identityVerifiedAt" TIMESTAMP(3);

CREATE TABLE "UserWalletVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserWalletVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserWalletVerification_userId_walletAddress_key" ON "UserWalletVerification"("userId", "walletAddress");
ALTER TABLE "UserWalletVerification" ADD CONSTRAINT "UserWalletVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
