import { createJsonlAppender, readJsonlLines } from "@rapture/kernel";
import { z } from "zod";

/**
 * Append-only prediction chronology store.
 *
 * Predictions are persisted BEFORE the held-out worker-count outcomes exist
 * and are never rewritten afterwards. Observed outcomes are appended as
 * separate records. Both record kinds use exclusive creation: a duplicate
 * prediction or outcome record for the same step is refused.
 */

export const PREDICTION_STORE_SCHEMA_VERSION = 1;

export const predictionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("prediction"),
  experimentId: z.string().min(1),
  predictorId: z.string().min(1),
  predictorVersion: z.string().min(1),
  observedWorkerCounts: z.array(z.number().int().positive()),
  targetWorkerCount: z.number().int().positive(),
  question: z.string().min(1),
  predictedState: z.enum([
    "PRODUCTIVE",
    "DIMINISHING_RETURNS",
    "SATURATING",
    "INSUFFICIENT_EVIDENCE",
  ]),
  confidence: z.enum(["low", "medium", "high"]),
  evidence: z.record(z.string(), z.unknown()),
  detectorConfiguration: z.record(z.string(), z.unknown()),
  persistedAt: z.string().min(1),
});

export const outcomeRecordSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("outcome"),
  experimentId: z.string().min(1),
  targetWorkerCount: z.number().int().positive(),
  observedOutcome: z.record(z.string(), z.unknown()),
  recordedAt: z.string().min(1),
});

export type PredictionRecord = z.infer<typeof predictionRecordSchema>;
export type OutcomeRecord = z.infer<typeof outcomeRecordSchema>;
export type CapacityStoreRecord = PredictionRecord | OutcomeRecord;

export class PredictionAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`prediction already persisted for ${key}; predictions are immutable once recorded`);
    this.name = "PredictionAlreadyExistsError";
  }
}

export class OutcomeAlreadyExistsError extends Error {
  constructor(key: string) {
    super(`outcome already persisted for ${key}; outcomes are immutable once recorded`);
    this.name = "OutcomeAlreadyExistsError";
  }
}

export interface PredictionStore {
  readonly path: string;
  appendPrediction(record: PredictionRecord): Promise<void>;
  appendOutcome(record: OutcomeRecord): Promise<void>;
  read(): Promise<{
    readonly predictions: readonly PredictionRecord[];
    readonly outcomes: readonly OutcomeRecord[];
  }>;
}

export function predictionKey(
  record: Pick<PredictionRecord, "experimentId" | "predictorId" | "targetWorkerCount">,
): string {
  return `${record.experimentId}/${record.predictorId}/N=${record.targetWorkerCount}`;
}

export async function createPredictionStore(path: string): Promise<PredictionStore> {
  const appender = await createJsonlAppender(path);
  const lines = async (): Promise<CapacityStoreRecord[]> => {
    const raw = await readJsonlLines(path);
    return raw
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const value: { kind?: string } = JSON.parse(line);
        const parsed =
          value.kind === "outcome"
            ? outcomeRecordSchema.parse(value)
            : predictionRecordSchema.parse(value);
        return parsed;
      });
  };

  return {
    path,
    async appendPrediction(record: PredictionRecord): Promise<void> {
      const parsed = predictionRecordSchema.parse(record);
      const existing = await lines();
      if (
        existing.some(
          (item) =>
            item.kind === "prediction" &&
            item.experimentId === parsed.experimentId &&
            item.predictorId === parsed.predictorId &&
            item.targetWorkerCount === parsed.targetWorkerCount,
        )
      ) {
        throw new PredictionAlreadyExistsError(predictionKey(parsed));
      }
      await appender.appendLine(JSON.stringify(parsed));
    },
    async appendOutcome(record: OutcomeRecord): Promise<void> {
      const parsed = outcomeRecordSchema.parse(record);
      const existing = await lines();
      if (
        existing.some(
          (item) =>
            item.kind === "outcome" &&
            item.experimentId === parsed.experimentId &&
            item.targetWorkerCount === parsed.targetWorkerCount,
        )
      ) {
        throw new OutcomeAlreadyExistsError(`${parsed.experimentId}/N=${parsed.targetWorkerCount}`);
      }
      await appender.appendLine(JSON.stringify(parsed));
    },
    async read() {
      const records = await lines();
      return {
        predictions: records.filter(
          (record): record is PredictionRecord => record.kind === "prediction",
        ),
        outcomes: records.filter((record): record is OutcomeRecord => record.kind === "outcome"),
      };
    },
  };
}
