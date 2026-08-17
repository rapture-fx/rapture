import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { deriveMetrics } from "../src/metrics.js";

function event(sequence: number, eventType: string, timestamp: string, data: object): object {
  return {
    schemaVersion: 1,
    sequence,
    eventType,
    experimentId: "experiment-1",
    timestamp,
    data,
  };
}

it("derives speedup and parallel efficiency from persisted events", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-metrics-"));
  const path = join(root, "events.jsonl");
  const events: object[] = [];
  let sequence = 0;
  for (const [workers, accepted] of [
    [1, 1],
    [2, 2],
  ] as const) {
    events.push(
      event(++sequence, "task_started", "2026-01-01T00:00:00.000Z", {
        workerCount: workers,
      }),
    );
    for (let index = 0; index < accepted; index += 1) {
      events.push(
        event(++sequence, "task_finished", "2026-01-01T01:00:00.000Z", {
          workerCount: workers,
          accepted: true,
          durationMs: 100,
          validationResult: "passed",
          commands: [["node", "--test"]],
          testInvocations: [["node", "--test"]],
          buildInvocations: [],
          tokenUsage: null,
          providerCost: null,
        }),
      );
    }
  }
  await writeFile(path, `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  const metrics = await deriveMetrics(path);
  expect(metrics.workerResults[0]?.acceptedTasksPerHour).toBe(1);
  expect(metrics.workerResults[1]?.speedup).toBe(2);
  expect(metrics.workerResults[1]?.parallelEfficiency).toBe(1);
  expect(metrics.workerResults[1]?.duplicateTestInvocations).toBe(1);
  expect(metrics.workerResults[1]?.tokenUsagePerAcceptedTask).toBeNull();
});
