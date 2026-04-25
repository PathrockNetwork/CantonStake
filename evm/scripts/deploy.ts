import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer signer available for network 'amoy'. " +
      "Set DEPLOYER_PRIVATE_KEY in evm/.env to a 0x-prefixed private key."
    );
  }
  console.log("Deploying with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "POL");

  if (balance < ethers.parseEther("0.1")) {
    throw new Error(
      "Need at least 0.1 POL for deploy + reward funding. " +
      "Get POL from https://faucets.chain.link/polygon-amoy"
    );
  }

  console.log("\n1. Deploying MockValidatorShare...");
  const Factory = await ethers.getContractFactory("MockValidatorShare");
  const validator = await Factory.deploy();
  await validator.waitForDeployment();
  const address = await validator.getAddress();
  console.log("   MockValidatorShare deployed at:", address);

  console.log("\n2. Funding reward pool (0.05 POL)...");
  const fundTx = await deployer.sendTransaction({
    to: address,
    value: ethers.parseEther("0.05"),
  });
  await fundTx.wait();
  console.log("   Funded:", fundTx.hash);

  // Write address to file for frontend/backend consumption.
  const outPath = path.join(__dirname, "..", "deployments", "amoy.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        network: "amoy",
        chainId: 80002,
        mockValidatorShare: address,
        deployedAt: new Date().toISOString(),
        deployer: deployer.address,
      },
      null,
      2
    )
  );
  console.log("\n   Wrote address to:", outPath);

  console.log("\n3. Done. Verify with:");
  console.log(`   npx hardhat verify --network amoy ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
