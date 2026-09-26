import { describe, expect, it } from "vitest";
import { createExclusiveAction } from "../exclusive-action";

describe("exclusive wallet actions", () => {
  it("blocks duplicate actions before a disabled button is rendered", async () => {
    const run = createExclusiveAction();
    let settle!: () => void;
    let duplicateCalls = 0;
    const first = run(() => new Promise<void>((resolve) => { settle = resolve; }));
    await run(async () => { duplicateCalls++; });
    expect(duplicateCalls).toBe(0);
    settle();
    await first;
    await run(async () => { duplicateCalls++; });
    expect(duplicateCalls).toBe(1);
  });
  it("allows retry after a rejected wallet prompt", async () => {
    const run = createExclusiveAction();
    await expect(run(async () => { throw new Error("rejected"); })).rejects.toThrow("rejected");
    await expect(run(async () => "retry")).resolves.toBe("retry");
  });
});
