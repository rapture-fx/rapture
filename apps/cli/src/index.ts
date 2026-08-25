#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CapacityContext, EdgeComparison } from "@rapture/core";
import {
  benchmarkTasksForRepository,
  buildExperimentConfig,
  buildTrustMap,
  ConfigurationError,
  compareWorkerEdge,
  createPredictionStore,
  createScanReceipt,
  createVerificationReceipt,
  DoctorError,
  detectCapacityKnee,
  type distributionStats,
  doctorExitCode,
  evaluateStoredPredictions,
  formatDoctor,
  formatFactor,
  formatReport,
  formatScanMarkdown,
  formatTrustMapMarkdown,
  formatVerificationIntegrity,
  inspectExperiment,
  loadBenchmarkSuite,
  loadCapacityContext,
  loadInvariantsFromRepo,
  loadRunObservations,
  loadTasks,
  materializeBenchmarkRepository,
  observeOutcomes,
  parseReceipt,
  persistDoctorArtifacts,
  regenerateReport,
  regenerateStepPredictions,
  resolveBaseRef,
  resumeExperiment,
  runBenchmarkDoctor,
  runDoctor,
  runExperiment,
  runVerificationIntegrity,
  runVerificationScan,
  simulateControllerStop,
} from "@rapture/core";
import type { InvariantsConfig } from "@rapture/kernel";
import {
  generateSigningKeyPair,
  keyIdFor,
  parseInvariantsFile,
  type ReceiptEnvelope,
} from "@rapture/kernel";
import { Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";

const runOptionsSchema = z.object({
  repo: z.string().min(1),
  tasks: z.string().min(1),
  workers: z.string().min(1),
  repetitions: z.string().min(1),
  seed: z.string().min(1),
  agent: z.enum(["fake", "codex", "opencode"]),
  agentModel: z.string().optional(),
  output: z.string().min(1),
  integration: z.boolean(),
  integrationValidation: z.array(z.string()),
  order: z.enum(["repetition-major", "worker-major"]),
  pricing: z.string().optional(),
  json: z.boolean(),
});

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const program = new Command()
  .name("rapture")
  .description("Profile autonomous coding-agent fleet scaling")
  .version("0.1.0");

program
  .command("validate")
  .description("validate a task definition without running agents")
  .requiredOption("--tasks <path>", "task definition JSON")
  .action(async (options: { readonly tasks: string }) => {
    const tasks = await loadTasks(options.tasks);
    process.stdout.write(`valid: ${tasks.length} task(s)\n`);
  });

const verifyOptionsSchema = z.object({
  repo: z.string().optional(),
  base: z.string().optional(),
  candidate: z.string().min(1).default("HEAD"),
  json: z.boolean(),
  write: z.string().optional(),
  signingKey: z.string().optional(),
  receiptOut: z.string().optional(),
  invariants: z.string().optional(),
});

async function resolveInvariants(
  invocationRoot: string,
  repoPath: string,
  override?: string,
): Promise<InvariantsConfig | null> {
  if (override !== undefined) {
    return parseInvariantsFile(resolve(invocationRoot, override));
  }
  return loadInvariantsFromRepo(repoPath);
}

async function resolveRepoPath(
  invocationRoot: string,
  explicitRepo: string | undefined,
): Promise<string> {
  if (explicitRepo !== undefined) return resolve(invocationRoot, explicitRepo);
  const { findGitRoot } = await import("@rapture/core");
  const discovered = await findGitRoot(invocationRoot);
  if (discovered === null) {
    throw new ConfigurationError(
      "not a git repository: run rapture verify from inside a git checkout or supply --repo",
    );
  }
  return discovered;
}

program
  .command("verify")
  .description("verify that a change did not weaken the verification surface (tests, CI, checks)")
  .option("--repo <path>", "git repository to inspect (defaults to current git root)")
  .option("--base <ref>", "base git ref (auto-detected when omitted)")
  .option("--candidate <ref>", "candidate git ref under evaluation", "HEAD")
  .option("--json", "emit machine-readable output", false)
  .option("--write <path>", "also write the report to a file")
  .option(
    "--signing-key <path>",
    "ed25519 private key PEM; when set, emits a signed verification receipt",
  )
  .option("--receipt-out <path>", "where to write the signed receipt", "verification-receipt.json")
  .option(
    "--invariants <path>",
    "path to an invariants JSON (defaults to <repo>/.rapture/invariants.json)",
  )
  .action(async (rawOptions: unknown) => {
    const options = verifyOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const repoPath = await resolveRepoPath(invocationRoot, options.repo);
    const invariants = await resolveInvariants(invocationRoot, repoPath, options.invariants);
    const baseRef = await resolveBaseRef(repoPath, options.base, options.candidate);
    if (options.base === undefined) {
      process.stderr.write(`using auto-detected base: ${baseRef}\n`);
    }
    const report = await runVerificationIntegrity({
      repository: repoPath,
      baseRef,
      candidateRef: options.candidate,
      ...(invariants === null
        ? {}
        : {
            invariants,
            invariantsSource: options.invariants ? "explicit" : "auto",
            invariantsPath: options.invariants
              ? resolve(invocationRoot, options.invariants)
              : `${repoPath}/.rapture/invariants.json`,
          }),
    });
    if (options.write !== undefined) {
      const target = resolve(invocationRoot, options.write);
      await writeFile(
        target,
        options.json ? `${JSON.stringify(report, null, 2)}\n` : formatVerificationIntegrity(report),
      );
      process.stderr.write(`report written: ${target}\n`);
    }
    if (options.signingKey !== undefined) {
      if (options.json) {
        throw new ConfigurationError("--signing-key cannot be combined with --json");
      }
      const privateKeyPem = await readFile(resolve(invocationRoot, options.signingKey), "utf8");
      const envelope = createVerificationReceipt({ report, privateKeyPem });
      const receiptPath = resolve(
        invocationRoot,
        options.receiptOut ?? "verification-receipt.json",
      );
      await writeFile(receiptPath, `${JSON.stringify(envelope, null, 2)}\n`);
      process.stderr.write(`signed receipt written: ${receiptPath}\n`);
    }
    if (options.json) printJson(report);
    else process.stdout.write(formatVerificationIntegrity(report));
    process.exitCode = report.verdict === "REJECT" ? 2 : report.verdict === "WARN" ? 1 : 0;
  });

const keygenOptionsSchema = z.object({
  dir: z.string().min(1),
});

program
  .command("keygen")
  .description("generate an ed25519 signing key pair for verification receipts")
  .requiredOption("--dir <path>", "directory to write rapture-signing-key.pem and public key")
  .action(async (rawOptions: unknown) => {
    const options = keygenOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const dir = resolve(invocationRoot, options.dir);
    await mkdir(dir, { recursive: true });
    const keys = generateSigningKeyPair();
    const privatePath = join(dir, "rapture-signing-key.pem");
    const publicPath = join(dir, "rapture-signing-pub.pem");
    await writeFile(privatePath, keys.privateKeyPem, { mode: 0o600 });
    await writeFile(publicPath, keys.publicKeyPem);
    process.stdout.write(
      `private key: ${privatePath}\npublic key:  ${publicPath}\nkey id:     ${keys.keyId}\n`,
    );
  });

const receiptsVerifyOptionsSchema = z.object({
  receipt: z.string().min(1),
  key: z.array(z.string()).min(1),
});

program
  .command("receipts-verify")
  .description("offline-verify a signed verification receipt against trusted public keys")
  .requiredOption("--receipt <path>", "signed receipt JSON")
  .requiredOption(
    "--key <path>",
    "trusted ed25519 public key PEM; repeat for multiple keys",
    (value: string, previous: readonly string[]) => [...previous, value],
    [],
  )
  .action(async (rawOptions: unknown) => {
    const options = receiptsVerifyOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const envelope = JSON.parse(
      await readFile(resolve(invocationRoot, options.receipt), "utf8"),
    ) as ReceiptEnvelope;
    const trustedKeys: Record<string, string> = {};
    for (const keyPath of options.key) {
      const pem = await readFile(resolve(invocationRoot, keyPath), "utf8");
      trustedKeys[keyIdFor(pem)] = pem;
    }
    const result = parseReceipt(envelope, trustedKeys);
    if (!result.valid) {
      process.stdout.write("RECEIPT: INVALID — signature does not match any trusted key\n");
      process.exitCode = 2;
      return;
    }
    process.stdout.write(
      `RECEIPT: VALID (${result.payload.kind === "verification-scan" ? "scan audit" : "single verification"})\n`,
    );
    printJson(result.payload);
  });

const scanOptionsSchema = z.object({
  repo: z.string().optional(),
  base: z.string().optional(),
  head: z.string().min(1).default("HEAD"),
  out: z.string().optional(),
  invariants: z.string().optional(),
  signingKey: z.string().optional(),
  receiptOut: z.string().optional(),
});

program
  .command("scan")
  .description(
    "audit an entire commit window for verification-weakening changes, attributed per commit",
  )
  .option("--repo <path>", "git repository to inspect (defaults to current git root)")
  .option("--base <ref>", "trusted base ref (auto-detected when omitted)")
  .option("--head <ref>", "head ref of the window", "HEAD")
  .option("--out <path>", "write the markdown audit report to a file")
  .option(
    "--invariants <path>",
    "path to an invariants JSON (defaults to <repo>/.rapture/invariants.json)",
  )
  .option("--signing-key <path>", "ed25519 private key PEM; when set, emits a signed audit receipt")
  .option("--receipt-out <path>", "where to write the signed audit receipt", "audit-receipt.json")
  .action(async (rawOptions: unknown) => {
    const options = scanOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const repoPath = await resolveRepoPath(invocationRoot, options.repo);
    const invariants = await resolveInvariants(invocationRoot, repoPath, options.invariants);
    const baseRef = await resolveBaseRef(repoPath, options.base, options.head);
    if (options.base === undefined) {
      process.stderr.write(`using auto-detected base: ${baseRef}\n`);
    }
    const scan = await runVerificationScan({
      repository: repoPath,
      baseRef,
      headRef: options.head,
      ...(invariants === null ? {} : { invariants }),
    });
    let markdown = formatScanMarkdown(scan);
    if (invariants !== null) {
      const trustMap = await buildTrustMap({
        repository: repoPath,
        ref: options.head,
        invariants,
      });
      markdown = `${markdown}\n---\n\n${formatTrustMapMarkdown(trustMap)}`;
    }
    if (options.signingKey !== undefined) {
      const privateKeyPem = await readFile(resolve(invocationRoot, options.signingKey), "utf8");
      const envelope = createScanReceipt({ scan, privateKeyPem });
      const receiptPath = resolve(invocationRoot, options.receiptOut ?? "audit-receipt.json");
      await writeFile(receiptPath, `${JSON.stringify(envelope, null, 2)}\n`);
      process.stderr.write(`signed audit receipt written: ${receiptPath}\n`);
    }
    if (options.out !== undefined) {
      const target = resolve(invocationRoot, options.out);
      await writeFile(target, markdown);
      process.stderr.write(`audit report written: ${target}\n`);
    }
    process.stdout.write(markdown);
    process.exitCode =
      scan.overallVerdict === "REJECT" ? 2 : scan.overallVerdict === "WARN" ? 1 : 0;
  });

const trustmapOptionsSchema = z.object({
  repo: z.string().optional(),
  ref: z.string().min(1).default("HEAD"),
  out: z.string().optional(),
  invariants: z.string().optional(),
});

program
  .command("trustmap")
  .description("map which acceptance claims rest on evidence the agent can modify")
  .option("--repo <path>", "git repository to inspect (defaults to current git root)")
  .option("--ref <ref>", "ref to analyze", "HEAD")
  .option("--out <path>", "write the markdown trust map to a file")
  .option(
    "--invariants <path>",
    "path to an invariants JSON (defaults to <repo>/.rapture/invariants.json)",
  )
  .action(async (rawOptions: unknown) => {
    const options = trustmapOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const repoPath = await resolveRepoPath(invocationRoot, options.repo);
    const invariants = await resolveInvariants(invocationRoot, repoPath, options.invariants);
    const map = await buildTrustMap({
      repository: repoPath,
      ref: options.ref,
      ...(invariants === null ? {} : { invariants }),
    });
    const markdown = formatTrustMapMarkdown(map);
    if (options.out !== undefined) {
      const target = resolve(invocationRoot, options.out);
      await writeFile(target, markdown);
      process.stderr.write(`trust map written: ${target}\n`);
    }
    process.stdout.write(markdown);
  });

const benchmarkDoctorOptionsSchema = z.object({
  manifest: z.string().min(1),
  json: z.boolean(),
});

program
  .command("benchmark-doctor")
  .description("verify a benchmark manifest, fixtures, validators, and known-good proofs")
  .requiredOption("--manifest <path>", "benchmark suite manifest")
  .option("--json", "emit machine-readable output", false)
  .action(async (rawOptions: unknown) => {
    const options = benchmarkDoctorOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const result = await runBenchmarkDoctor({
      manifestPath: resolve(invocationRoot, options.manifest),
    });
    if (options.json) printJson(result);
    else {
      process.stdout.write(
        `Rapture benchmark doctor ${result.status} (${result.suiteId}@${result.suiteVersion})\n`,
      );
      for (const check of result.checks) {
        process.stdout.write(`${check.id.padEnd(36)} ${check.status.padEnd(8)} ${check.message}\n`);
      }
    }
    process.exitCode = result.status === "BLOCKED" ? 2 : 0;
  });

const benchmarkMaterializeOptionsSchema = z.object({
  manifest: z.string().min(1),
  repository: z.string().min(1),
  destination: z.string().min(1),
  tasksOutput: z.string().optional(),
});

program
  .command("benchmark-materialize")
  .description("materialize one pinned benchmark repository and optionally write Rapture tasks")
  .requiredOption("--manifest <path>", "benchmark suite manifest")
  .requiredOption("--repository <id>", "benchmark repository ID")
  .requiredOption("--destination <path>", "new destination directory")
  .option("--tasks-output <path>", "write compatible task JSON for this repository")
  .action(async (rawOptions: unknown) => {
    const options = benchmarkMaterializeOptionsSchema.parse(rawOptions);
    const invocationRoot = process.env.INIT_CWD ?? process.cwd();
    const manifestPath = resolve(invocationRoot, options.manifest);
    const suite = await loadBenchmarkSuite(manifestPath);
    await materializeBenchmarkRepository({
      manifestPath,
      suite,
      repositoryId: options.repository,
      destination: resolve(invocationRoot, options.destination),
    });
    if (options.tasksOutput !== undefined) {
      const { writeFile } = await import("node:fs/promises");
      const tasks = benchmarkTasksForRepository({
        manifestPath,
        suite,
        repositoryId: options.repository,
      });
      await writeFile(
        resolve(invocationRoot, options.tasksOutput),
        `${JSON.stringify({ tasks }, null, 2)}\n`,
        "utf8",
      );
    }
    process.stdout.write(`materialized ${options.repository} at ${options.destination}\n`);
  });

const doctorOptionsSchema = z.object({
  config: z.string().optional(),
  agent: z.enum(["fake", "codex", "opencode"]).optional(),
  agentModel: z.string().optional(),
  repo: z.string().optional(),
  tasks: z.string().optional(),
  output: z.string().optional(),
  pricing: z.string().optional(),
  writeDir: z.string().optional(),
  json: z.boolean(),
});

program
  .command("doctor")
  .description("inspect whether this environment can execute a Rapture experiment")
  .option("--config <path>", "frozen experiment JSON")
  .addOption(
    new Option("--agent <adapter>", "agent adapter").choices(["fake", "codex", "opencode"]),
  )
  .option("--agent-model <name>", "optional pinned provider model identifier")
  .option("--repo <path>", "local Git repository")
  .option("--tasks <path>", "task definition JSON")
  .option("--output <path>", "experiment output directory")
  .option("--pricing <path>", "versioned pricing context JSON; enables derived monetary economics")
  .option("--write-dir <path>", "write doctor.json and runner-fingerprint.json")
  .option("--json", "emit machine-readable output", false)
  .action(async (rawOptions: unknown) => {
    const options = doctorOptionsSchema.parse(rawOptions);
    try {
      const result = await runDoctor({
        workspaceRoot: process.cwd(),
        env: process.env,
        ...(options.repo === undefined ? {} : { repository: options.repo }),
        ...(options.tasks === undefined ? {} : { taskFile: options.tasks }),
        ...(options.output === undefined ? {} : { outputDirectory: options.output }),
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(options.agentModel === undefined ? {} : { agentModel: options.agentModel }),
        ...(options.config === undefined ? {} : { configPath: options.config }),
        ...(options.pricing === undefined ? {} : { pricingPath: options.pricing }),
      });
      const writeDir = options.writeDir ?? options.output;
      if (writeDir !== undefined) {
        await persistDoctorArtifacts(writeDir, result, process.env);
      }
      if (options.json) printJson(result);
      else process.stdout.write(`${formatDoctor(result)}\n`);
      process.exitCode = doctorExitCode(result.status);
    } catch (error: unknown) {
      if (error instanceof ConfigurationError || error instanceof z.ZodError) {
        process.stderr.write(`configuration error: ${error.message}\n`);
        process.exitCode = 3;
        return;
      }
      if (error instanceof DoctorError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = error.exitCode;
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`doctor internal failure: ${detail}\n`);
      process.exitCode = 4;
    }
  });

program
  .command("run")
  .description("execute a scaling experiment")
  .requiredOption("--repo <path>", "local Git repository")
  .requiredOption("--tasks <path>", "task definition JSON")
  .requiredOption("--workers <counts>", "comma-separated worker counts")
  .option("--repetitions <count>", "number of repeated trials per worker count", "1")
  .option("--seed <integer>", "root experiment seed for deterministic task order", "0")
  .addOption(
    new Option("--agent <adapter>", "agent adapter")
      .choices(["fake", "codex", "opencode"])
      .default("fake"),
  )
  .option("--agent-model <name>", "optional pinned provider model identifier")
  .requiredOption("--output <path>", "artifact output directory")
  .option("--integration", "attempt deterministic integration", false)
  .option(
    "--integration-validation <command>",
    "post-integration validation command; repeat for multiple commands",
    (value: string, previous: readonly string[]) => [...previous, value],
    [],
  )
  .addOption(
    new Option("--order <mode>", "trial execution order")
      .choices(["repetition-major", "worker-major"])
      .default("repetition-major"),
  )
  .option("--pricing <path>", "versioned pricing context JSON; enables derived monetary economics")
  .option("--json", "emit machine-readable output", false)
  .action(async (rawOptions: unknown) => {
    const options = runOptionsSchema.parse(rawOptions);
    const config = await buildExperimentConfig({
      repository: options.repo,
      taskFile: options.tasks,
      workers: options.workers,
      repetitions: options.repetitions,
      seed: options.seed,
      agent: options.agent,
      ...(options.agentModel === undefined ? {} : { agentModel: options.agentModel }),
      outputDirectory: options.output,
      integration: options.integration,
      integrationValidation: options.integrationValidation,
      order: options.order,
      ...(options.pricing === undefined ? {} : { pricingPath: options.pricing }),
    });
    const execution = await runExperiment(config);
    const report = await regenerateReport(execution.directory);
    if (options.json) printJson(report);
    else {
      process.stdout.write(`${formatReport(report)}\nArtifacts: ${execution.directory}\n`);
    }
  });

program
  .command("report")
  .description("regenerate metrics from persisted raw artifacts")
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const report = await regenerateReport(experiment);
    if (options.json) printJson(report);
    else process.stdout.write(`${formatReport(report)}\n`);
  });

program
  .command("capacity")
  .description(
    "build the capacity curve, knee detection, prediction chronology, baselines, and retrospective simulation from persisted evidence",
  )
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const context: CapacityContext = await loadCapacityContext(experiment);
    const knee = detectCapacityKnee(context.curve);
    const store = await createPredictionStore(
      `${experiment}/predictions.jsonl`.replace(/\/+/g, "/"),
    );
    const stored = await store.read();
    const workerCounts = context.curve.points
      .map((point) => point.workerCount)
      .sort((a, b) => a - b);
    const regenerated = regenerateStepPredictions(context, workerCounts, 0);
    const outcomes = observeOutcomes(
      context,
      stored.predictions.map((prediction) => prediction.targetWorkerCount),
    );
    const evaluations = evaluateStoredPredictions(
      stored.predictions.map((prediction) => ({
        predictorId: prediction.predictorId,
        targetWorkerCount: prediction.targetWorkerCount,
        predictedState: prediction.predictedState,
      })),
      outcomes,
    );
    const simulation =
      knee.candidateKnee === null
        ? null
        : simulateControllerStop(
            context.curve,
            knee.candidateKnee,
            context.metrics.workerResults.reduce((total, row) => total + row.acceptedTasks, 0),
          );
    if (options.json) {
      printJson({
        experimentId: context.experimentId,
        curve: context.curve,
        knee,
        predictions: stored.predictions,
        outcomes: stored.outcomes,
        regeneratedMatchesStored: verifyRegenerated(regenerated, stored.predictions),
        evaluations,
        simulation,
      });
      return;
    }
    process.stdout.write(
      formatCapacityText(context, knee, stored, regenerated, evaluations, simulation),
    );
  });

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function ms(value: number | null): string {
  return value === null ? "n/a" : Math.round(value).toString();
}

function verifyRegenerated(
  regenerated: ReturnType<typeof regenerateStepPredictions>,
  stored: readonly { predictorId: string; targetWorkerCount: number; predictedState: string }[],
): boolean {
  for (const step of regenerated) {
    for (const prediction of step.predictions) {
      const match = stored.some(
        (item) =>
          item.predictorId === prediction.predictor.id &&
          item.targetWorkerCount === prediction.targetWorkerCount &&
          item.predictedState === prediction.predictedState,
      );
      if (!match) return false;
    }
  }
  return true;
}

function formatCapacityText(
  context: CapacityContext,
  knee: ReturnType<typeof detectCapacityKnee>,
  stored: Awaited<ReturnType<Awaited<ReturnType<typeof createPredictionStore>>["read"]>>,
  regenerated: ReturnType<typeof regenerateStepPredictions>,
  evaluations: ReturnType<typeof evaluateStoredPredictions>,
  simulation: ReturnType<typeof simulateControllerStop> | null,
): string {
  const lines: string[] = [];
  lines.push(`Rapture capacity curve ${context.experimentId}`);
  lines.push("");
  lines.push("Capacity curve");
  lines.push(
    "workers  accepted  accept-rate  median-tph  min-tph  max-tph  speedup  efficiency  agent-ms  infl-vs-1  cpu-mean  mem-used  load-p95",
  );
  for (const point of context.curve.points) {
    lines.push(
      [
        point.workerCount.toString().padStart(7),
        point.acceptedTasks.toString().padStart(8),
        pct(point.acceptanceRate).padStart(11),
        (point.medianTasksPerHour === null ? "n/a" : point.medianTasksPerHour.toFixed(2)).padStart(
          10,
        ),
        (point.minTasksPerHour === null ? "n/a" : point.minTasksPerHour.toFixed(2)).padStart(8),
        (point.maxTasksPerHour === null ? "n/a" : point.maxTasksPerHour.toFixed(2)).padStart(8),
        formatFactor(point.speedup).padStart(8),
        formatFactor(point.parallelEfficiency).padStart(11),
        ms(point.medianAgentExecutionMs).padStart(9),
        formatFactor(point.agentLatencyInflationVsBaseline).padStart(10),
        pct(point.resources?.cpuUtilizationMean ?? null).padStart(9),
        pct(point.resources?.memoryUsedFractionMean ?? null).padStart(9),
        (point.resources?.loadAverage1mP95 === null || point.resources === null
          ? "n/a"
          : point.resources.loadAverage1mP95.toFixed(1)
        ).padStart(8),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push("Adjacent marginal yield");
  lines.push("step   gain-tph  gain-%   yield/worker  incr-eff  latency-infl");
  for (const step of context.curve.adjacentSteps) {
    lines.push(
      [
        `T(${step.toWorkerCount})-T(${step.fromWorkerCount})`,
        (step.marginalThroughputGain === null
          ? "n/a"
          : step.marginalThroughputGain.toFixed(2)
        ).padStart(8),
        pct(step.marginalThroughputGainFraction).padStart(7),
        (step.marginalWorkerYield === null ? "n/a" : step.marginalWorkerYield.toFixed(2)).padStart(
          13,
        ),
        formatFactor(step.incrementalWorkerEfficiency).padStart(9),
        formatFactor(step.agentLatencyInflation).padStart(12),
      ].join("  "),
    );
  }
  lines.push("");
  lines.push(
    `Candidate knee: ${knee.status}${knee.candidateKnee === null ? "" : ` at N=${knee.candidateKnee} (confidence ${knee.confidence})`}`,
  );
  for (const reason of knee.reasons) lines.push(`  - ${reason}`);
  lines.push("");
  lines.push("Prediction chronology (persisted before held-out results)");
  const sortedPredictions = [...stored.predictions].sort(
    (a, b) =>
      a.targetWorkerCount - b.targetWorkerCount || a.persistedAt.localeCompare(b.persistedAt),
  );
  for (const prediction of sortedPredictions) {
    lines.push(
      `  [${prediction.persistedAt}] ${prediction.predictorId} observed=${prediction.observedWorkerCounts.join(",")} -> N=${prediction.targetWorkerCount}: ${prediction.predictedState} (${prediction.confidence})`,
    );
  }
  for (const outcome of stored.outcomes) {
    lines.push(
      `  [${outcome.recordedAt}] observed outcome N=${outcome.targetWorkerCount}: ${JSON.stringify(outcome.observedOutcome)}`,
    );
  }
  lines.push("");
  lines.push(
    `Predictions reproducible from persisted restricted evidence: ${verifyRegenerated(regenerated, stored.predictions) ? "yes" : "no"}`,
  );
  lines.push("");
  lines.push("Predictor vs held-out outcomes (descriptive agreement only)");
  lines.push("predictor           steps  correct  agreement");
  for (const evaluation of evaluations) {
    lines.push(
      [
        evaluation.predictorId.padEnd(19),
        evaluation.evaluableSteps.toString().padStart(5),
        evaluation.correctSteps.toString().padStart(8),
        (evaluation.agreementFraction === null
          ? "n/a"
          : pct(evaluation.agreementFraction)
        ).padStart(10),
      ].join("  "),
    );
  }
  if (simulation !== null) {
    lines.push("");
    lines.push("Retrospective controller simulation (NOT a live adaptive controller)");
    lines.push(
      `stop-at N=${simulation.stopAtWorkers}: tph=${simulation.throughputAtStopWorkers?.toFixed(2) ?? "n/a"} wall=${simulation.estimatedWallHoursAtStopWorkers?.toFixed(2) ?? "n/a"}h occupancy=${pct(simulation.workerOccupancyAtStopWorkers)}`,
    );
    lines.push(
      `max N=${simulation.maxWorkers}: tph=${simulation.throughputAtMaxWorkers?.toFixed(2) ?? "n/a"} wall=${simulation.estimatedWallHoursAtMaxWorkers?.toFixed(2) ?? "n/a"}h occupancy=${pct(simulation.workerOccupancyAtMaxWorkers)}`,
    );
    lines.push(`wall-time delta (stop-vs-max): ${pct(simulation.wallTimeReductionFraction)}`);
  } else {
    lines.push("");
    lines.push("Retrospective controller simulation: unavailable (no candidate knee detected)");
  }
  return lines.join("\n");
}

program
  .command("attribution")
  .description(
    "compare provider-wait, local-execution, and concurrency-overlap evidence between two worker counts from persisted run records",
  )
  .argument("<experiment>", "experiment artifact directory")
  .option("--low <count>", "lower worker count of the edge", "3")
  .option("--high <count>", "higher worker count of the edge", "4")
  .option("--json", "emit machine-readable output", false)
  .action(
    async (
      experiment: string,
      options: { readonly low: string; readonly high: string; readonly json: boolean },
    ) => {
      const low = Number.parseInt(options.low, 10);
      const high = Number.parseInt(options.high, 10);
      if (!Number.isInteger(low) || !Number.isInteger(high) || low <= 0 || high <= low) {
        process.stderr.write("invalid --low/--high worker counts\n");
        process.exitCode = 2;
        return;
      }
      const observations = await loadRunObservations(experiment);
      if (observations.length === 0) {
        process.stderr.write("no readable run records found\n");
        process.exitCode = 3;
        return;
      }
      const comparison = compareWorkerEdge(observations, low, high);
      const report = await regenerateReport(experiment);
      if (options.json) {
        printJson({ experimentId: report.experimentId, comparison });
        return;
      }
      process.stdout.write(formatAttributionText(report.experimentId, comparison));
    },
  );

function statsLine(label: string, stats: ReturnType<typeof distributionStats>, unit = ""): string {
  if (stats === null) return `  ${label.padEnd(28)} n/a`;
  return [
    "  ",
    label.padEnd(28),
    `n=${stats.count}`,
    `min=${Math.round(stats.min)}`,
    `p25=${Math.round(stats.p25)}`,
    `med=${Math.round(stats.median)}`,
    `p75=${Math.round(stats.p75)}`,
    `max=${Math.round(stats.max)}${unit}`,
  ].join(" ");
}

function formatAttributionText(experimentId: string, comparison: EdgeComparison): string {
  const lines: string[] = [];
  lines.push(
    `Runtime attribution ${experimentId}: N=${comparison.low.workerCount} vs N=${comparison.high.workerCount}`,
  );
  lines.push("");
  for (const side of [comparison.low, comparison.high]) {
    lines.push(
      `N=${side.workerCount}: runs=${side.runs} accepted=${side.acceptedRuns} (${(side.acceptanceRate * 100).toFixed(1)}%) streamCoverage=${(side.streamCoverage * 100).toFixed(0)}% rateLimitSignals=${side.rateLimitSignals}`,
    );
    lines.push(statsLine("agent execution ms", side.agentExecutionMs));
    lines.push(statsLine("provider wait ms", side.providerWaitMs));
    lines.push(statsLine("provider wait fraction", side.providerWaitFraction));
    lines.push(statsLine("local tool gap fraction", side.interStepGapFraction));
    lines.push(statsLine("non-tool gap fraction", side.unobservedFraction));
    lines.push(statsLine("launch->first event ms", side.launchToFirstEventMs));
    lines.push(statsLine("model steps per run", side.modelStepsPerRun));
    lines.push(statsLine("tool events per run", side.toolEventsPerRun));
    lines.push("");
  }
  lines.push("Median ratios (N=high / N=low)");
  lines.push(`  agentExecutionMs       ${formatFactor(comparison.ratios.agentExecutionMs)}`);
  lines.push(`  providerWaitMs         ${formatFactor(comparison.ratios.providerWaitMs)}`);
  lines.push(`  providerWaitFraction   ${formatFactor(comparison.ratios.providerWaitFraction)}`);
  lines.push(`  interStepGapFraction   ${formatFactor(comparison.ratios.interStepGapFraction)}`);
  lines.push(`  launchToFirstEventMs   ${formatFactor(comparison.ratios.launchToFirstEventMs)}`);
  lines.push("");
  lines.push("Actual concurrency overlap per trial (execution windows)");
  lines.push("trial                        workers  maxConcurrent  meanConcurrent  frac@full");
  for (const trial of comparison.actualOverlapByTrial) {
    lines.push(
      [
        "  ",
        trial.trialId.padEnd(27),
        String(trial.workerCount).padStart(7),
        String(trial.maxConcurrent).padStart(14),
        trial.meanConcurrent === null
          ? "n/a".padStart(15)
          : trial.meanConcurrent.toFixed(2).padStart(15),
        trial.fractionAtFullConcurrency === null
          ? "n/a".padStart(10)
          : `${(trial.fractionAtFullConcurrency * 100).toFixed(1)}%`.padStart(10),
      ].join("  "),
    );
  }
  if (comparison.providerOverlapByTrial.length > 0) {
    lines.push("");
    lines.push("Provider-span overlap per trial");
    lines.push("trial                        workers  maxSpans  meanSpans  spanCount");
    for (const trial of comparison.providerOverlapByTrial) {
      lines.push(
        [
          "  ",
          trial.trialId.padEnd(27),
          String(trial.workerCount).padStart(7),
          String(trial.maxConcurrentProviderSpans).padStart(9),
          trial.meanConcurrentProviderSpans === null
            ? "n/a".padStart(10)
            : trial.meanConcurrentProviderSpans.toFixed(2).padStart(10),
          String(trial.spanCount).padStart(10),
        ].join("  "),
      );
    }
  }
  return lines.join("\n");
}

program
  .command("resume")
  .description("resume a previously interrupted experiment")
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const execution = await resumeExperiment(experiment);
    const report = await regenerateReport(execution.directory);
    if (options.json) printJson(report);
    else {
      process.stdout.write(`${formatReport(report)}\nArtifacts: ${execution.directory}\n`);
    }
  });

program
  .command("inspect")
  .description("inspect raw experiment metadata and artifact locations")
  .argument("<experiment>", "experiment artifact directory")
  .option("--json", "emit machine-readable output", false)
  .action(async (experiment: string, options: { readonly json: boolean }) => {
    const inspection = await inspectExperiment(experiment);
    if (options.json) printJson(inspection);
    else {
      process.stdout.write(
        `Rapture experiment ${inspection.experimentId} (${inspection.status})\n` +
          `Artifacts: ${inspection.artifactDirectory}\n` +
          `Trials: ${inspection.trialManifests.length}\n` +
          `Runs: ${inspection.runResults.length}\n`,
      );
    }
  });

program.configureOutput({
  outputError: (value, write) => write(value),
});

try {
  await program.parseAsync(process.argv);
} catch (error: unknown) {
  if (error instanceof DoctorError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else if (error instanceof ConfigurationError || error instanceof z.ZodError) {
    process.stderr.write(`configuration error: ${error.message}\n`);
    process.exitCode = 2;
  } else if (error instanceof InvalidArgumentError) {
    process.stderr.write(`argument error: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`execution error: ${detail}\n`);
    process.exitCode = 3;
  }
}
