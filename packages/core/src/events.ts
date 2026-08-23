import { readFile } from "node:fs/promises";
import { createJsonlAppender, exclusiveCreateFile } from "@rapture/kernel";
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
  "continuation_started",
  "continuation_finished",
  "telemetry_sample",
  "telemetry_error",
  "run_skipped",
  "provider_blocked",
  "infrastructure_failed",
  "run_interrupted",
  "matrix_completion",
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
  readonly nextSequence: () => number;
}

export interface CreateEventWriterOptions {
  readonly append?: boolean;
}

export async function createEventWriter(
  path: string,
  experimentId: string,
  options: CreateEventWriterOptions = {},
): Promise<EventWriter> {
  let baseSequence = 0;
  if (options.append === true) {
    const existing = await readEvents(path).catch(() => []);
    baseSequence = existing.length;
  } else {
    await exclusiveCreateFile(path);
  }
  const appender = await createJsonlAppender(path);
  const serialize = pLimit(1);
  let sequence = baseSequence;
  return {
    nextSequence: () => sequence,
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
        await appender.appendLine(JSON.stringify(event));
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
