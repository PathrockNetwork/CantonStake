import { networkMode } from "../network";

export const suiNetwork = networkMode === "mainnet"
  ? {
      name: "mainnet" as const,
      graphql: process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL || "https://graphql.mainnet.sui.io/graphql",
      identifier: "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S",
    }
  : {
      name: "testnet" as const,
      graphql: process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL || "https://graphql.testnet.sui.io/graphql",
      identifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
    };

export function assertSuiNetworkIdentifier(actual: string | undefined): void {
  if (actual !== suiNetwork.identifier) {
    throw new Error(`Sui GraphQL is on ${actual ?? "unknown"}; expected ${suiNetwork.name}`);
  }
}
