#!/usr/bin/env node
/**
 * Materialize the corpus, compile a change contract per task, and emit paired task files.
 *
 * The two conditions share everything -- repository snapshot, engineering request, editable
 * scope, validator, timeout -- and differ only in whether the compiled contract is present
 * in the worktree and pointed at by a fixed sentence. Both conditions appear in the same
 * task file so they interleave within a trial, which pairs them in time.
 *
 * Usage: build-experiment.mjs <checkout-root> <tasks-out-dir> <contracts-out-dir>
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeRepositoryMechanics,
  benchmarkTasksForRepository,
  compileChangeContract,
  loadBenchmarkSuite,
  materializeBenchmarkRepository,
  parseChangeContract,
} from "../../packages/core/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "benchmarks/delegation-v0/manifest.json");
const [checkoutRoot, tasksOut, contractsOut] = process.argv.slice(2).map((value) => resolve(value));

/**
 * Tasks selected before the experiment, using acceptance measured in the delegation
 * workstream. Four sit away from the ceiling so acceptance can move in either direction;
 * four are at ceiling, which is where exploration cost can be read without acceptance noise.
 * `version-diff-release-type` is retained deliberately as a hard negative control: it has
 * never been solved in 9 attempts, so a contract that "fixes" it would be a red flag.
 */
const SELECTED = [
  { id: "version-diff-release-type", repository: "version-core", priorAcceptance: "0/3" },
  { id: "version-coerce-options", repository: "version-core", priorAcceptance: "1/3" },
  { id: "version-lru-cache-eviction", repository: "version-core", priorAcceptance: "3/3" },
  { id: "glob-ignore-callbacks", repository: "glob-matcher-core", priorAcceptance: "2/3" },
  { id: "glob-utils-helpers", repository: "glob-matcher-core", priorAcceptance: "3/3" },
  { id: "cli-negated-option-name", repository: "cli-command-core", priorAcceptance: "2/3" },
  { id: "cli-argument-contract", repository: "cli-command-core", priorAcceptance: "3/3" },
  { id: "cli-suggest-similar", repository: "cli-command-core", priorAcceptance: "3/3" },
];

/** Fixed for every contract run. The engineering request itself is never altered. */
const PROMPT_SUFFIX = [
  "A machine-generated change contract for this task is available at .rapture/change-contract.json.",
  "It lists the editable scope, the files mechanically related to the change, the module",
  "surface other files depend on, available verification commands, and an explicit list of",
  "what could not be determined. It contains no solution. You may read it or ignore it.",
].join("\n");

const suite = await loadBenchmarkSuite(manifestPath);
await rm(tasksOut, { recursive: true, force: true });
await mkdir(tasksOut, { recursive: true });
await mkdir(contractsOut, { recursive: true });

const byRepository = new Map();
for (const selection of SELECTED) {
  const list = byRepository.get(selection.repository) ?? [];
  list.push(selection);
  byRepository.set(selection.repository, list);
}

const summary = [];
for (const [repositoryId, selections] of [...byRepository.entries()].sort()) {
  const checkout = join(checkoutRoot, repositoryId);
  await rm(checkout, { recursive: true, force: true });
  await materializeBenchmarkRepository({
    manifestPath,
    suite,
    repositoryId,
    destination: checkout,
  });
  const repository = suite.repositories.find((item) => item.id === repositoryId);
  const definitions = benchmarkTasksForRepository({ manifestPath, suite, repositoryId });

  const tasks = [];
  for (const selection of selections.sort((a, b) => a.id.localeCompare(b.id))) {
    const task = suite.tasks.find((item) => item.id === selection.id);
    const definition = definitions.find((item) => item.id === selection.id);
    if (task === undefined || definition === undefined) {
      throw new Error(`task not found in suite: ${selection.id}`);
    }
    const mechanics = await analyzeRepositoryMechanics({
      repositoryRoot: checkout,
      editableScope: task.editableScope,
    });
    const contract = compileChangeContract({
      taskId: task.id,
      intent: task.prompt,
      repositoryCommit: task.baseRevision,
      commitTimestamp: repository.materialization.commitTimestamp,
      editableScope: task.editableScope,
      protectedPaths: mechanics.relevantFiles
        .map((file) => file.path)
        .filter((path) => !task.editableScope.includes(path)),
      acceptanceCommands: [
        "an external validator outside this repository decides acceptance; it cannot be run from here",
      ],
      requiredEvidence: [
        "every editable file still parses",
        "the change stays inside the editable scope",
        "behaviour outside the requested change is unaffected",
      ],
      mechanics,
    });
    parseChangeContract(JSON.parse(JSON.stringify(contract)));
    const serialized = `${JSON.stringify(contract, null, 2)}\n`;
    await writeFile(join(contractsOut, `${task.id}.json`), serialized, "utf8");

    tasks.push({ ...definition, id: `${task.id}__baseline` });
    tasks.push({
      ...definition,
      id: `${task.id}__contract`,
      context: {
        files: { ".rapture/change-contract.json": serialized },
        ignorePaths: [".rapture/"],
        promptSuffix: PROMPT_SUFFIX,
      },
    });
    summary.push({
      task: task.id,
      repository: repositoryId,
      priorAcceptance: selection.priorAcceptance,
      relevantFiles: mechanics.relevantFiles.length,
      unknowns: mechanics.unknowns.length,
      contractSha256: contract.provenance.contractSha256,
      contractBytes: serialized.length,
    });
  }
  await writeFile(
    join(tasksOut, `${repositoryId}.json`),
    `${JSON.stringify({ tasks }, null, 2)}\n`,
    "utf8",
  );
}

process.stdout.write(
  `${"task".padEnd(28)}${"repo".padEnd(20)}prior  files  unknown  bytes  contract\n`,
);
for (const row of summary) {
  process.stdout.write(
    `${row.task.padEnd(28)}${row.repository.padEnd(20)}${row.priorAcceptance.padEnd(7)}${String(row.relevantFiles).padStart(5)}${String(row.unknowns).padStart(9)}${String(row.contractBytes).padStart(7)}  ${row.contractSha256.slice(0, 12)}\n`,
  );
}
process.stdout.write(
  `\n${summary.length} task(s) x 2 conditions x 3 repetitions = ${summary.length * 6} logical runs\n`,
);
