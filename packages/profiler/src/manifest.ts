import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ExperimentMode = "clean-reset" | "evolving";

export interface ManifestTask {
  readonly id: string;
  readonly task: string;
  readonly taskFile?: string;
  readonly repetitions?: number;
  readonly model?: string;
  readonly agent?: string;
}

export interface ExperimentManifest {
  readonly version: 1;
  readonly agent: "opencode";
  readonly mode: ExperimentMode;
  readonly repository: string;
  readonly runsDir?: string;
  readonly cohort?: string;
  readonly experimentId?: string;
  readonly tasks: readonly ManifestTask[];
}

export function validateManifest(
  value: unknown,
): { ok: true; manifest: ExperimentManifest } | { ok: false; error: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "manifest must be an object" };
  const obj = value as Record<string, unknown>;
  if (obj["version"] !== 1) return { ok: false, error: "manifest version must be 1" };
  if (obj["agent"] !== "opencode") return { ok: false, error: "agent must be 'opencode'" };
  const mode = obj["mode"] as string | undefined;
  if (mode !== "clean-reset" && mode !== "evolving")
    return { ok: false, error: "mode must be 'clean-reset' or 'evolving'" };
  if (typeof obj["repository"] !== "string")
    return { ok: false, error: "repository must be string" };
  if (!Array.isArray(obj["tasks"])) return { ok: false, error: "tasks must be array" };
  if (obj["tasks"].length === 0) return { ok: false, error: "tasks must be non-empty" };
  for (let i = 0; i < obj["tasks"].length; i++) {
    const t = obj["tasks"][i] as Record<string, unknown>;
    if (typeof t["id"] !== "string" || !t["id"])
      return { ok: false, error: `tasks[${i}].id must be non-empty string` };
    if (typeof t["task"] !== "string" || !t["task"]) {
      if (typeof t["taskFile"] !== "string")
        return { ok: false, error: `tasks[${i}] must have task or taskFile` };
    }
    if (
      t["repetitions"] !== undefined &&
      (typeof t["repetitions"] !== "number" || (t["repetitions"] as number) < 1)
    )
      return { ok: false, error: `tasks[${i}].repetitions must be >=1` };
  }
  return { ok: true, manifest: value as ExperimentManifest };
}

export async function loadManifest(path: string): Promise<ExperimentManifest> {
  const raw = await readFile(resolve(path), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const result = validateManifest(parsed);
  if (!result.ok) throw new Error(`Invalid manifest ${path}: ${result.error}`);
  return result.manifest;
}

export interface ExpandedTask {
  readonly manifestTaskId: string;
  readonly repetition: number;
  readonly task: string;
  readonly taskFile: string | null;
  readonly model: string | null;
  readonly agent: string | null;
}

export function expandManifest(manifest: ExperimentManifest): readonly ExpandedTask[] {
  const out: ExpandedTask[] = [];
  for (const t of manifest.tasks) {
    const reps = t.repetitions ?? 1;
    for (let r = 1; r <= reps; r++) {
      out.push({
        manifestTaskId: t.id,
        repetition: r,
        task: t.task,
        taskFile: t.taskFile ?? null,
        model: t.model ?? null,
        agent: t.agent ?? null,
      });
    }
  }
  return out;
}
