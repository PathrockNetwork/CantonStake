import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

function findAddressArg(): string | undefined {
  return process.argv.find((arg) => /^0x[a-fA-F0-9]{40}$/.test(arg));
}

function targetAddress(): string {
  const fromArg = findAddressArg();
  if (fromArg) return fromArg;

  const deploymentPath = path.join(__dirname, "..", "deployments", "amoy.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      "No contract address provided and evm/deployments/amoy.json does not exist."
    );
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as {
    mockValidatorShare?: string;
  };
  if (!deployment.mockValidatorShare) {
    throw new Error("evm/deployments/amoy.json is missing mockValidatorShare.");
  }
  return deployment.mockValidatorShare;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY in evm/.env before funding.");
  }

  const target = targetAddress();
  const amount = ethers.parseEther(process.env.FUND_AMOUNT_POL || "0.05");
  const tx = await deployer.sendTransaction({ to: target, value: amount });
  console.log(`Funding ${target} with ${ethers.formatEther(amount)} POL...`);
  await tx.wait();
  console.log(`Funded: ${tx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
