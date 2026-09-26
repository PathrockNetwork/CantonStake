import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { suiNetwork } from "./network";

export const suiDAppKit = createDAppKit({
  networks: [suiNetwork.name],
  defaultNetwork: suiNetwork.name,
  createClient: () => new SuiGraphQLClient({ url: suiNetwork.graphql, network: suiNetwork.name }),
  autoConnect: true,
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof suiDAppKit;
  }
}
