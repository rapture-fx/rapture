import { z } from "zod";
import { sha256 } from "./artifacts.js";
import { ConfigurationError } from "./config.js";
import type { RepositoryMechanics } from "./repo-mechanics.js";

/**
 * A machine-readable statement of what a requested change must satisfy, plus the mechanical
 * repository facts a coding agent would otherwise have to rediscover by reading files.
 *
 * Two rules govern the content. Every claim is traceable to repository evidence, and
 * anything that could not be established mechanically appears under `unknowns` rather than
 * being guessed. The contract deliberately carries no solution content and no validator
 * internals: it states obligations and observable structure, not answers.
 */

const relativePath = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("/"), "path must be relative");

export const changeContractSchema = z
  .object({
    schemaVersion: z.literal("1"),
    request: z
      .object({
        taskId: z.string().trim().min(1),
        intent: z.string().trim().min(1),
        repositoryCommit: z.string().regex(/^[a-f0-9]{40}$/u),
      })
      .strict(),
    mechanicalContext: z
      .object({
        entrySymbols: z
          .array(z.object({ file: relativePath, symbols: z.array(z.string()).readonly() }).strict())
          .readonly(),
        relevantFiles: z
          .array(
            z
              .object({
                path: relativePath,
                depth: z.number().int().nonnegative(),
                reason: z.enum(["editable", "imported_by_editable", "imports_editable"]),
              })
              .strict(),
          )
          .readonly(),
        dependencyDepth: z
          .object({
            maxDepthWalked: z.number().int().positive(),
            bounded: z.literal(true),
            filesByDepth: z.record(z.string(), z.number().int().nonnegative()),
          })
          .strict(),
        fanOut: z.record(relativePath, z.number().int().nonnegative()).nullable(),
        testSurfaces: z
          .object({
            files: z.array(relativePath).readonly(),
            commands: z.array(z.array(z.string()).readonly()).readonly(),
          })
          .strict(),
        verificationSurface: z
          .array(
            z
              .object({
                mechanism: z.string(),
                command: z.array(z.string()).readonly(),
                evidence: z.string(),
              })
              .strict(),
          )
          .readonly(),
        changeBreadth: z.enum(["local", "module", "cross_module"]).nullable(),
      })
      .strict(),
    constraints: z
      .object({
        editableScope: z.array(relativePath).min(1).readonly(),
        protectedPaths: z.array(relativePath).readonly(),
        existingInvariants: z
          .array(z.object({ statement: z.string(), evidence: z.string() }).strict())
          .readonly(),
        unknowns: z.array(z.string()).readonly(),
      })
      .strict(),
    acceptance: z
      .object({
        commands: z.array(z.string()).readonly(),
        requiredEvidence: z.array(z.string()).readonly(),
      })
      .strict(),
    provenance: z
      .object({
        generatedAt: z.string(),
        generatorVersion: z.string(),
        sourceHashes: z.record(relativePath, z.string().regex(/^[a-f0-9]{64}$/u)),
        contractSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();

export type ChangeContract = z.infer<typeof changeContractSchema>;

export const CHANGE_CONTRACT_GENERATOR = "rapture-change-compiler/0.1.0";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Fingerprint of everything in the contract except the fingerprint itself. */
export function changeContractFingerprint(contract: ChangeContract): string {
  const { contractSha256: _omitted, ...provenance } = contract.provenance;
  return sha256(canonical({ ...contract, provenance }));
}

export function parseChangeContract(value: unknown): ChangeContract {
  const parsed = changeContractSchema.safeParse(value);
  if (!parsed.success) throw new ConfigurationError(z.prettifyError(parsed.error));
  const fingerprint = changeContractFingerprint(parsed.data);
  if (fingerprint !== parsed.data.provenance.contractSha256) {
    throw new ConfigurationError(
      `change contract fingerprint mismatch: expected ${parsed.data.provenance.contractSha256}, got ${fingerprint}`,
    );
  }
  return parsed.data;
}

/**
 * Compile mechanical analysis plus the request into a contract.
 *
 * `generatedAt` is the source commit's own timestamp rather than a wall clock, so that
 * regenerating the contract for the same commit and task reproduces the same bytes. A
 * contract that changed every time it was built could not be integrity-checked.
 */
export function compileChangeContract(input: {
  readonly taskId: string;
  readonly intent: string;
  readonly repositoryCommit: string;
  readonly commitTimestamp: string;
  readonly editableScope: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly acceptanceCommands: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly mechanics: RepositoryMechanics;
}): ChangeContract {
  const { mechanics } = input;
  const invariants: { statement: string; evidence: string }[] = [];
  for (const [file, count] of Object.entries(mechanics.fanOut).sort()) {
    if (count === 0) continue;
    invariants.push({
      statement: `${file} is imported by ${count} other file(s); its module interface is depended upon`,
      evidence: `static import graph: ${count} importer(s)`,
    });
  }
  for (const entry of mechanics.entrySymbols) {
    if (entry.symbols.length === 0) continue;
    invariants.push({
      statement: `${entry.file} exports ${entry.symbols.join(", ")}; these names are its observable surface`,
      evidence: "syntactic export analysis",
    });
  }

  const contract: ChangeContract = {
    schemaVersion: "1",
    request: {
      taskId: input.taskId,
      intent: input.intent,
      repositoryCommit: input.repositoryCommit,
    },
    mechanicalContext: {
      entrySymbols: mechanics.entrySymbols,
      relevantFiles: mechanics.relevantFiles,
      dependencyDepth: mechanics.dependencyDepth,
      fanOut: Object.keys(mechanics.fanOut).length === 0 ? null : mechanics.fanOut,
      testSurfaces: mechanics.testSurfaces,
      verificationSurface: mechanics.verificationSurface,
      changeBreadth: mechanics.changeBreadth,
    },
    constraints: {
      editableScope: [...input.editableScope].sort(),
      protectedPaths: [...input.protectedPaths].sort(),
      existingInvariants: invariants,
      unknowns: mechanics.unknowns,
    },
    acceptance: {
      commands: input.acceptanceCommands,
      requiredEvidence: input.requiredEvidence,
    },
    provenance: {
      generatedAt: input.commitTimestamp,
      generatorVersion: CHANGE_CONTRACT_GENERATOR,
      sourceHashes: mechanics.sourceHashes,
      contractSha256: "0".repeat(64),
    },
  };
  return {
    ...contract,
    provenance: {
      ...contract.provenance,
      contractSha256: changeContractFingerprint(contract),
    },
  };
}

/** Compact human-readable rendering used in the agent-facing pointer. */
export function summarizeChangeContract(contract: ChangeContract): string {
  const lines: string[] = [];
  lines.push(
    `change contract ${contract.provenance.contractSha256.slice(0, 12)} for ${contract.request.taskId}`,
  );
  lines.push(`  editable scope: ${contract.constraints.editableScope.join(", ")}`);
  lines.push(`  relevant files: ${contract.mechanicalContext.relevantFiles.length}`);
  lines.push(`  change breadth: ${contract.mechanicalContext.changeBreadth ?? "unknown"}`);
  lines.push(`  verification mechanisms: ${contract.mechanicalContext.verificationSurface.length}`);
  lines.push(`  explicit unknowns: ${contract.constraints.unknowns.length}`);
  return lines.join("\n");
}
