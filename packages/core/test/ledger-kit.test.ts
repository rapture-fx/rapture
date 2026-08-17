import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { expect, it } from "vitest";
import { loadTasks } from "../src/config.js";
import { validateCommands } from "../src/validation.js";

const suiteRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/ledger-kit");

it("rejects the ledger-kit baseline and accepts the known-correct solutions", async () => {
  const destination = await mkdtemp(join(tmpdir(), "rapture-ledger-"));
  const repository = join(destination, "repo");
  await execa(process.execPath, [join(suiteRoot, "create.mjs"), repository]);
  const tasks = await loadTasks(join(suiteRoot, "tasks.json"));
  expect(tasks).toHaveLength(6);
  for (const task of tasks) {
    const baseline = await validateCommands(task.validation, repository, 20_000);
    expect(baseline.passed, `${task.id} should fail on the baseline`).toBe(false);
    const corrected = await mkdtemp(join(tmpdir(), "rapture-ledger-solution-"));
    await cp(repository, corrected, { recursive: true });
    for (const [file, content] of Object.entries(task.fake?.files ?? {})) {
      await writeFile(join(corrected, file), content, "utf8");
    }
    const accepted = await validateCommands(task.validation, corrected, 20_000);
    expect(accepted.passed, `${task.id} should pass on the documented solution`).toBe(true);
  }
});
