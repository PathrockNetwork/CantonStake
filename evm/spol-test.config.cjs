// Isolated, local-only fork configuration. Never loads deployment keys.
require("@nomicfoundation/hardhat-ethers");

module.exports = {
  networks: { hardhat: {
    chainId: 31337,
    hardfork: "cancun",
    // EDR has no built-in Amoy history. These tests fork post-Cancun state only.
    chains: { 80002: { hardforkHistory: { cancun: 0 } } },
    forking: { url: process.env.SPOL_AMOY_RPC_URL ||
      "https://testnet.cantonstake.pathrocknetwork.org/api/rpc/testnet/polygon" },
  } },
};
