import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

function findAddressArg(): string | undefined {
  return process.argv.find((arg) => /^0x[a-fA-F0-9]{40}$/.test(arg));
}

function deployedAddress(): string {
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
  const address = deployedAddress();
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`No contract bytecode found at ${address} on this network.`);
  }

  console.log(`Verifying MockValidatorShare at ${address}...`);
  try {
    await run("verify:verify", {
      address,
      constructorArguments: [],
      contract: "contracts/MockValidatorShare.sol:MockValidatorShare",
    });
    console.log("Verification submitted.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("already verified")) {
      console.log("Contract is already verified.");
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
