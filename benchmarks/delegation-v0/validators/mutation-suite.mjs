import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { assert, runNode, withStagedCopies } from "./lib.mjs";

/**
 * Decide a "repair this test suite" task.
 *
 * Running the suite is not sufficient on its own: a suite that asserts nothing also passes,
 * so deleting the assertions would be the cheapest way to satisfy it. The repaired suite
 * must therefore also *fail* against each behavioural mutant, which is only possible if it
 * still makes real claims about the library.
 *
 * Mutants are appended after the target module's export so they survive whatever formatting
 * the agent leaves behind.
 */
export function assertRepairedSuite(repository, spec) {
  const suitePath = resolve(repository, spec.suitePath);
  const stats = statSync(suitePath, { throwIfNoEntry: false });
  assert.ok(stats?.isFile(), `${spec.suitePath} must exist`);
  assert.ok(
    readFileSync(suitePath, "utf8").trim().length >= 200,
    `${spec.suitePath} must not be emptied out`,
  );

  withStagedCopies(repository, spec.mutants.length + 1, (roots) => {
    const clean = runNode(["--test", spec.suitePath], {
      cwd: roots[0],
      timeoutMs: 90_000,
    });
    assert.equal(
      clean.status,
      0,
      `${spec.suitePath} must pass against the unmodified library, exit ${clean.status}\n${clean.output.slice(-1500)}`,
    );

    spec.mutants.forEach((mutant, index) => {
      const root = roots[index + 1];
      appendFileSync(join(root, spec.mutationTarget), `\n${mutant.code}\n`, "utf8");
      const mutated = runNode(["--test", spec.suitePath], { cwd: root, timeoutMs: 90_000 });
      assert.notEqual(
        mutated.status,
        0,
        `${spec.suitePath} did not detect the '${mutant.id}' regression; the suite needs ${mutant.requires}`,
      );
    });
  });
}
