import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextConfig = require("../../next.config.js");

describe("image processing exposure", () => {
  it("disables the unused optimizer while serving local artwork directly", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.images.unoptimized).toBe(true);
  });
});
