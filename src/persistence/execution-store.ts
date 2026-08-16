import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import * as Schema from "effect/Schema";
import { Effect } from "effect";
import {
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
  readonly append: (
    record: ExecutionRecord,
  ) => Effect.Effect<void, PersistenceFailure>;
}

export const createJsonlExecutionStore = (path: string): ExecutionStore => {
  let pending = Promise.resolve();
  return {
    append: (record) =>
      Effect.tryPromise({
        try: () => {
          const validated = Schema.decodeUnknownSync(ExecutionRecordSchema)(
            record,
          );
          const write = pending.then(async () => {
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            const handle = await open(path, "a", 0o600);
            try {
              await handle.chmod(0o600);
              await handle.writeFile(`${JSON.stringify(validated)}\n`, "utf8");
              await handle.sync();
            } finally {
              await handle.close();
            }
          });
          pending = write.catch(() => undefined);
          return write;
        },
        catch: () => new PersistenceFailure(),
      }),
  };
};

export const createInMemoryExecutionStore = (): ExecutionStore & {
  readonly records: readonly ExecutionRecord[];
} => {
  const records: ExecutionRecord[] = [];
  return {
    records,
    append: (record) =>
      Effect.sync(() => {
        records.push(Schema.decodeUnknownSync(ExecutionRecordSchema)(record));
      }),
  };
};
