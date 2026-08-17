import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runProcess } from "../src/process.js";

it("terminates a timed-out subprocess", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "rapture-process-"));
  const result = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
    cwd,
    timeoutMs: 50,
  });
  expect(result.timedOut).toBe(true);
  expect(result.durationMs).toBeLessThan(5_000);
});

it("captures stdout and stderr separately", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "rapture-process-"));
  const result = await runProcess(
    process.execPath,
    ["-e", "console.log('out'); console.error('err')"],
    { cwd, timeoutMs: 5_000 },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("out\n");
  expect(result.stderr).toBe("err\n");
});
