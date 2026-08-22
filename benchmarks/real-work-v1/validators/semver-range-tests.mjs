import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assert, runValidator } from "./lib.mjs";

const SUITE = "test/range.test.js";

// Behaviour-changing mutants appended to `classes/range.js` after `module.exports = Range`.
// A test suite that genuinely characterises range behaviour must fail against each one.
const mutants = [
  {
    id: "range-test-always-true",
    code: "\nRange.prototype.test = function () { return true }\n",
    requires: "at least one version that must NOT satisfy a range",
  },
  {
    id: "range-test-always-false",
    code: "\nRange.prototype.test = function () { return false }\n",
    requires: "at least one version that MUST satisfy a range",
  },
  {
    id: "range-intersects-always-true",
    code: "\nRange.prototype.intersects = function () { return true }\n",
    requires: "a pair of ranges that must NOT intersect",
  },
  {
    id: "range-intersects-always-false",
    code: "\nRange.prototype.intersects = function () { return false }\n",
    requires: "a pair of ranges that MUST intersect",
  },
];

function runSuite(root) {
  const result = spawnSync(process.execPath, ["--test", SUITE], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  if (result.error !== undefined && result.error !== null) {
    throw new Error(`unable to run ${SUITE}: ${result.error.message}`);
  }
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function stage(repository, workspace, name) {
  const root = join(workspace, name);
  cpSync(repository, root, { recursive: true, filter: (source) => !source.includes(`${"/"}.git`) });
  return root;
}

await runValidator(async (repository) => {
  const suitePath = resolve(repository, SUITE);
  const stats = statSync(suitePath, { throwIfNoEntry: false });
  assert.ok(stats?.isFile(), `${SUITE} must exist`);
  const source = readFileSync(suitePath, "utf8");
  assert.ok(source.trim().length >= 200, `${SUITE} must not be emptied out`);

  const workspace = mkdtempSync(join(tmpdir(), "rapture-semver-range-tests-"));
  try {
    // 1. The suite must pass against the unmodified library.
    const clean = runSuite(stage(repository, workspace, "clean"));
    assert.equal(
      clean.status,
      0,
      `${SUITE} must pass against the unmodified library, exit ${clean.status}\n${clean.output.slice(-2000)}`,
    );

    // 2. The suite must detect each behavioural regression.
    for (const mutant of mutants) {
      const root = stage(repository, workspace, mutant.id);
      appendFileSync(join(root, "classes/range.js"), mutant.code, "utf8");
      const mutated = runSuite(root);
      assert.notEqual(
        mutated.status,
        0,
        `${SUITE} did not detect the '${mutant.id}' regression; the suite needs ${mutant.requires}`,
      );
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
