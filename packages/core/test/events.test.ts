import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEventWriter, readEvents } from "../src/events.js";

it("serializes ordered append-only events", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-events-"));
  const path = join(root, "events.jsonl");
  const writer = await createEventWriter(path, "experiment-1");
  await Promise.all([
    writer.emit("experiment_started"),
    writer.emit("experiment_configuration_recorded", { workerCounts: [1, 2] }),
  ]);
  const events = await readEvents(path);
  expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  expect((await readFile(path, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
});

it("refuses to create a fresh writer over an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-events-"));
  const path = join(root, "events.jsonl");
  await createEventWriter(path, "experiment-1");
  await expect(createEventWriter(path, "experiment-1")).rejects.toMatchObject({
    code: "EEXIST",
  });
});

it("re-bases sequence numbers when appending", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-events-"));
  const path = join(root, "events.jsonl");
  const first = await createEventWriter(path, "experiment-1");
  await first.emit("experiment_started");
  const resumed = await createEventWriter(path, "experiment-1", { append: true });
  expect(resumed.nextSequence()).toBe(1);
  const event = await resumed.emit("trial_started", { trialId: "t1" });
  expect(event.sequence).toBe(2);
  const events = await readEvents(path);
  expect(events.map((item) => item.eventType)).toEqual(["experiment_started", "trial_started"]);
});

it("appending a missing file starts at sequence one", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-events-"));
  const path = join(root, "missing.jsonl");
  const writer = await createEventWriter(path, "experiment-1", { append: true });
  const event = await writer.emit("experiment_started");
  expect(event.sequence).toBe(1);
});

it("rejects unknown event types on write", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-events-"));
  const path = join(root, "events.jsonl");
  const writer = await createEventWriter(path, "experiment-1");
  await expect(writer.emit("not_a_real_event" as never)).rejects.toThrow();
});

it("reports the offending line for corrupt event JSONL", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-events-"));
  const path = join(root, "events.jsonl");
  const writer = await createEventWriter(path, "experiment-1");
  await writer.emit("experiment_started");
  await writeFile(path, '{"schemaVersion":1,"sequence":2}\n', { flag: "a" });
  await expect(readEvents(path)).rejects.toThrow(/invalid event JSONL at line 2/u);
});
