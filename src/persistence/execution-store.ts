import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import * as Schema from "effect/Schema";
import { Effect } from "effect";
import {
  AttemptIntentRecordSchema,
  type AttemptIntentRecord,
  ExecutionRecordSchema,
  type ExecutionRecord,
} from "../domain/execution-record.js";

export class PersistenceFailure extends Error {
  readonly _tag = "PersistenceFailure";
  constructor() {
    super("execution record persistence failed");
    this.name = "PersistenceFailure";
  }
}

export interface ExecutionStore {
  readonly beginAttempt: (
    record: AttemptIntentRecord,
  ) => Effect.Effect<void, PersistenceFailure>;
  readonly append: (
    record: ExecutionRecord,
  ) => Effect.Effect<void, PersistenceFailure>;
}

export const createJsonlExecutionStore = (path: string): ExecutionStore => {
  let pending = Promise.resolve();
  const appendLine = (record: AttemptIntentRecord | ExecutionRecord) =>
    Effect.tryPromise({
      try: () => {
        const write = pending.then(async () => {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const handle = await open(path, "a", 0o600);
          try {
            await handle.chmod(0o600);
            await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
        });
        pending = write.catch(() => undefined);
        return write;
      },
      catch: () => new PersistenceFailure(),
    });
  return {
    beginAttempt: (record) =>
      appendLine(Schema.decodeUnknownSync(AttemptIntentRecordSchema)(record)),
    append: (record) =>
      appendLine(Schema.decodeUnknownSync(ExecutionRecordSchema)(record)),
  };
};

export const createInMemoryExecutionStore = (): ExecutionStore & {
  readonly intents: readonly AttemptIntentRecord[];
  readonly records: readonly ExecutionRecord[];
} => {
  const intents: AttemptIntentRecord[] = [];
  const records: ExecutionRecord[] = [];
  return {
    intents,
    records,
    beginAttempt: (record) =>
      Effect.sync(() => {
        intents.push(
          Schema.decodeUnknownSync(AttemptIntentRecordSchema)(record),
        );
      }),
    append: (record) =>
      Effect.sync(() => {
        records.push(Schema.decodeUnknownSync(ExecutionRecordSchema)(record));
      }),
  };
};
