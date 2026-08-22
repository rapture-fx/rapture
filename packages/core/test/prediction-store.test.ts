import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPredictionStore,
  OutcomeAlreadyExistsError,
  type OutcomeRecord,
  PredictionAlreadyExistsError,
  type PredictionRecord,
} from "../src/prediction-store.js";

function predictionRecord(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    schemaVersion: 1,
    kind: "prediction",
    experimentId: "exp-2026-08-21-test",
    predictorId: "rapture",
    predictorVersion: "1",
    observedWorkerCounts: [1],
    targetWorkerCount: 2,
    question: "will the next step deliver useful marginal throughput",
    predictedState: "PRODUCTIVE",
    confidence: "low",
    evidence: { notes: ["single observed worker count"] },
    detectorConfiguration: { thresholds: { lowMarginalGainFraction: 0.15 } },
    persistedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function outcomeRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    schemaVersion: 1,
    kind: "outcome",
    experimentId: "exp-2026-08-21-test",
    targetWorkerCount: 2,
    observedOutcome: { outcomeClass: "productive", marginalThroughputGainFraction: 0.3 },
    recordedAt: "2026-08-21T01:00:00.000Z",
    ...overrides,
  };
}

describe("prediction persistence", () => {
  it("round-trips predictions and outcomes through append-only JSONL", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "rapture-predictions-")), "predictions.jsonl");
    const store = await createPredictionStore(path);
    await store.appendPrediction(predictionRecord());
    await store.appendPrediction(
      predictionRecord({ predictorId: "cpu-only", predictedState: "SATURATING" }),
    );
    await store.appendOutcome(outcomeRecord());
    const { predictions, outcomes } = await store.read();
    expect(predictions).toHaveLength(2);
    expect(outcomes).toHaveLength(1);
    expect(predictions[0]?.predictedState).toBe("PRODUCTIVE");
    expect(predictions[1]?.predictedState).toBe("SATURATING");
    expect(outcomes[0]?.observedOutcome.outcomeClass).toBe("productive");
  });

  it("serializes one JSON object per line", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "rapture-predictions-")), "predictions.jsonl");
    const store = await createPredictionStore(path);
    await store.appendPrediction(predictionRecord());
    await store.appendOutcome(outcomeRecord());
    const content = await readFile(path, "utf8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => (JSON.parse(line) as { kind: string }).kind)).toEqual([
      "prediction",
      "outcome",
    ]);
  });

  it("refuses to overwrite an existing prediction for the same step and predictor", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "rapture-predictions-")), "predictions.jsonl");
    const store = await createPredictionStore(path);
    await store.appendPrediction(predictionRecord());
    // Same experiment/predictor/target: immutable.
    await expect(store.appendPrediction(predictionRecord())).rejects.toThrow(
      PredictionAlreadyExistsError,
    );
    // Even with a different predicted state.
    await expect(
      store.appendPrediction(predictionRecord({ predictedState: "DIMINISHING_RETURNS" })),
    ).rejects.toThrow(PredictionAlreadyExistsError);
    // A different predictor or a different target is still allowed.
    await store.appendPrediction(predictionRecord({ predictorId: "memory-only" }));
    await store.appendPrediction(predictionRecord({ targetWorkerCount: 3 }));
    expect((await store.read()).predictions).toHaveLength(3);
  });

  it("refuses to overwrite an existing outcome but keeps prediction immutability separate", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "rapture-predictions-")), "predictions.jsonl");
    const store = await createPredictionStore(path);
    await store.appendOutcome(outcomeRecord());
    await expect(store.appendOutcome(outcomeRecord())).rejects.toThrow(OutcomeAlreadyExistsError);
    // Outcomes do not block predictions for the same target.
    await store.appendPrediction(predictionRecord());
    expect((await store.read()).outcomes).toHaveLength(1);
  });

  it("reads an empty chronology when the file does not exist yet", async () => {
    const store = await createPredictionStore(
      join(await mkdtemp(join(tmpdir(), "rapture-predictions-")), "predictions.jsonl"),
    );
    const { predictions, outcomes } = await store.read();
    expect(predictions).toEqual([]);
    expect(outcomes).toEqual([]);
  });
});
