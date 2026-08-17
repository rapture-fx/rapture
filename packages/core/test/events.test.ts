import { mkdtemp, readFile } from "node:fs/promises";
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
