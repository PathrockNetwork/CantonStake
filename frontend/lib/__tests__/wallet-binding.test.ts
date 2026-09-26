import { describe, expect, it } from "vitest";
import { assertEvmWalletBinding, assertWalletOwner } from "../wallet-binding";

describe("native wallet intent binding", () => {
  it("requires the same Cosmos account", () => {
    expect(() => assertWalletOwner("Cosmos Hub", "cosmos1owner", "cosmos1owner")).not.toThrow();
    expect(() => assertWalletOwner("Cosmos Hub", "cosmos1other", "cosmos1owner")).toThrow(/wallet account changed/);
    expect(() => assertWalletOwner("Cosmos Hub", null, "cosmos1owner")).toThrow(/wallet account changed/);
  });

  it("compares Sui and Aptos hex addresses without checksum case", () => {
    expect(() => assertWalletOwner("Sui", "0xABCD", "0xabcd", true)).not.toThrow();
    expect(() => assertWalletOwner("Aptos", "0x1234", "0xabcd", true)).toThrow(/wallet account changed/);
  });
});

describe("EVM signing binding", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  it("requires the reviewed owner and settlement chain", () => {
    expect(() => assertEvmWalletBinding({ address: owner, chainId: 11155111 }, owner, 11155111)).not.toThrow();
    expect(() => assertEvmWalletBinding({ address: "0x2222222222222222222222222222222222222222", chainId: 11155111 }, owner, 11155111)).toThrow(/wallet account changed/);
    expect(() => assertEvmWalletBinding({}, owner, 11155111)).toThrow(/wallet account changed/);
    expect(() => assertEvmWalletBinding({ address: owner, chainId: 80002 }, owner, 11155111)).toThrow(/network changed/);
    expect(() => assertEvmWalletBinding({ address: owner, chainId: 1 }, owner, 11155111)).toThrow(/network changed/);
  });
});
