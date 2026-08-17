import { open, readFile } from "node:fs/promises";
import pLimit from "p-limit";
import { z } from "zod";
import type { JsonValue } from "./models.js";

export const eventTypes = [
  "experiment_started",
  "experiment_configuration_recorded",
  "trial_started",
  "trial_finished",
  "task_queued",
  "worker_started",
  "task_started",
  "agent_process_started",
  "agent_output",
  "agent_process_finished",
  "validation_started",
  "validation_finished",
  "git_snapshot",
  "integration_started",
  "integration_finished",
  "task_finished",
  "task_failed",
  "worker_finished",
  "experiment_finished",
  "experiment_interrupted",
] as const;

export type EventType = (typeof eventTypes)[number];

export interface ExperimentEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly eventType: EventType;
  readonly experimentId: string;
  readonly timestamp: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const eventSchema = z.object({
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive(),
  eventType: z.enum(eventTypes),
  experimentId: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), jsonValueSchema),
});

export interface EventWriter {
  readonly emit: (eventType: EventType, data?: object) => Promise<ExperimentEvent>;
}

export async function createEventWriter(path: string, experimentId: string): Promise<EventWriter> {
  const handle = await open(path, "wx");
  await handle.close();
  const serialize = pLimit(1);
  let sequence = 0;
  return {
    emit: (eventType, data = {}) =>
      serialize(async () => {
        sequence += 1;
        const event = eventSchema.parse({
          schemaVersion: 1,
          sequence,
          eventType,
          experimentId,
          timestamp: new Date().toISOString(),
          data,
        });
        const appendHandle = await open(path, "a");
        try {
          await appendHandle.write(`${JSON.stringify(event)}\n`);
          await appendHandle.sync();
        } finally {
          await appendHandle.close();
        }
        return event;
      }),
  };
}

export async function readEvents(path: string): Promise<readonly ExperimentEvent[]> {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return eventSchema.parse(JSON.parse(line) as unknown);
      } catch (error: unknown) {
        throw new Error(`invalid event JSONL at line ${index + 1}`, { cause: error });
      }
    });
}
