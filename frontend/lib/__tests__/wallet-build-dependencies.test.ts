import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("wallet SDK build dependencies", () => {
  it("resolves the optional Coinbase payment peers traversed by the bundler", () => {
    for (const specifier of [
      "@x402/core/client", "@x402/evm", "@x402/evm/exact/client",
      "@x402/evm/upto/client", "@x402/extensions", "@x402/svm/exact/client",
    ]) {
      expect(() => require.resolve(specifier)).not.toThrow();
    }
  });
});
