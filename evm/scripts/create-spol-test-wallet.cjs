// Creates a dedicated Amoy test wallet. Prints the PUBLIC address only.
const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");

const directory = path.resolve(__dirname, "../../.test-wallets");
const destination = path.join(directory, "spol-amoy.json");
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) {
  throw new Error("Wallet directory must be a real directory");
}
fs.chmodSync(directory, 0o700);
if (fs.existsSync(destination)) throw new Error("Wallet already exists; refusing to overwrite");
const wallet = Wallet.createRandom();
fs.writeFileSync(destination, JSON.stringify({
  purpose: "CantonStake sPOL Amoy testing ONLY; never fund with real assets",
  chainId: 80002,
  address: wallet.address,
  privateKey: wallet.privateKey,
  createdAt: new Date().toISOString(),
}, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ address: wallet.address, chainId: 80002,
  secretSavedLocally: true, permissions: "0600", testnetOnly: true }));
