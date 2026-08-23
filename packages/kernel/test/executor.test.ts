import { expect, it } from "vitest";
import { createInMemoryExecutor } from "../src/exec/in-memory.js";

it("records prepare, run, and dispose invocations", async () => {
  const executor = createInMemoryExecutor({
    rootPrefix: "/tmp/fake-sandboxes",
  });
  const sandbox = await executor.prepare({
    repository: "/repo",
    baseCommit: "abc123",
    sandboxId: "sb-1",
  });
  expect(sandbox).toEqual({ id: "sb-1", root: "/tmp/fake-sandboxes/sb-1" });

  const result = await executor.run(sandbox, ["node", "-e", "console.log(1)"], {
    timeoutMs: 5_000,
  });
  expect(result.exitCode).toBe(0);
  expect(executor.runInvocations).toHaveLength(1);
  expect(executor.runInvocations[0]?.command).toEqual(["node", "-e", "console.log(1)"]);

  await executor.dispose(sandbox);
  expect(executor.disposedIds).toEqual(["sb-1"]);
});

it("delegates command execution to the scripted handler", async () => {
  const executor = createInMemoryExecutor({
    name: "scripted",
    onRun: (_sandbox, command) => ({
      command,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1_000,
      exitCode: 3,
      timedOut: true,
      stdout: "partial output",
      stderr: "killed",
    }),
  });
  const sandbox = await executor.prepare({
    repository: "/repo",
    baseCommit: "abc123",
    sandboxId: "sb-2",
  });
  const result = await executor.run(sandbox, ["make", "test"], { timeoutMs: 100 });
  expect(result.timedOut).toBe(true);
  expect(result.exitCode).toBe(3);
});

it("propagates scripted prepare failures", async () => {
  const executor = createInMemoryExecutor({
    failOnPrepare: () => "base commit not found",
  });
  await expect(
    executor.prepare({ repository: "/repo", baseCommit: "nope", sandboxId: "sb-3" }),
  ).rejects.toThrow(/base commit not found/u);
});
