import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sha256File } from "../src/evidence/artifacts.js";
import { runExternalValidator, ValidatorAssetError } from "../src/judge/validator.js";

async function makeWorkspace(validatorSource: string): Promise<{
  readonly root: string;
  readonly repo: string;
  readonly validatorPath: string;
  readonly hash: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "rapture-judge-"));
  const repo = join(root, "repo");
  const tools = join(root, "tools");
  await mkdir(repo, { recursive: true });
  await mkdir(tools, { recursive: true });
  const validatorPath = join(tools, "validator.mjs");
  await writeFile(validatorPath, validatorSource);
  return { root, repo, validatorPath, hash: await sha256File(validatorPath) };
}

function run(workspace: Awaited<ReturnType<typeof makeWorkspace>>, timeoutMs = 30_000) {
  return runExternalValidator({
    validatorPath: workspace.validatorPath,
    expectedSha256: workspace.hash,
    repositoryPath: workspace.repo,
    cwd: workspace.root,
    timeoutMs,
  });
}

it("classifies exit code zero as accepted", async () => {
  const workspace = await makeWorkspace("process.exit(0);\n");
  const result = await run(workspace);
  expect(result.classification).toBe("accepted");
  expect(result.detail).toBe("validator accepted task");
});

it("classifies exit code one as rejected", async () => {
  const workspace = await makeWorkspace("process.exit(1);\n");
  const result = await run(workspace);
  expect(result.classification).toBe("rejected");
  expect(result.process?.exitCode).toBe(1);
});

it("classifies other exit codes as infrastructure failure", async () => {
  const workspace = await makeWorkspace("process.exit(7);\n");
  const result = await run(workspace);
  expect(result.classification).toBe("infrastructure_failure");
  expect(result.detail).toBe("validator exited 7");
});

it("classifies a validator timeout as infrastructure failure", async () => {
  const workspace = await makeWorkspace("setTimeout(() => {}, 60_000);\n");
  const result = await run(workspace, 1_500);
  expect(result.classification).toBe("infrastructure_failure");
  expect(result.detail).toBe("validator timed out");
  expect(result.process?.timedOut).toBe(true);
});

it("refuses to run a tampered validator", async () => {
  const workspace = await makeWorkspace("process.exit(0);\n");
  await writeFile(workspace.validatorPath, "process.exit(1);\n");
  const result = await run(workspace);
  expect(result.classification).toBe("infrastructure_failure");
  expect(result.detail).toContain("asset drift");
});

it("refuses a validator that lives inside the candidate repository", async () => {
  const workspace = await makeWorkspace("process.exit(0);\n");
  const insidePath = join(workspace.repo, "validator.mjs");
  await writeFile(insidePath, "process.exit(0);\n");
  const result = await runExternalValidator({
    validatorPath: insidePath,
    expectedSha256: await sha256File(insidePath),
    repositoryPath: workspace.repo,
    cwd: workspace.root,
    timeoutMs: 30_000,
  });
  expect(result.classification).toBe("infrastructure_failure");
  expect(result.detail).toBe("validator entered candidate repository");
});

it("exposes asset drift as a typed error when verified directly", async () => {
  expect(new ValidatorAssetError("boom").name).toBe("ValidatorAssetError");
});
