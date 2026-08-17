import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import type { TaskDefinition } from "../src/models.js";

export async function createGitRepository(root: string): Promise<string> {
  const repository = join(root, "repository");
  await mkdir(repository);
  await writeFile(join(repository, "value.txt"), "base\n", "utf8");
  await execa("git", ["init", "-q", "-b", "main"], { cwd: repository });
  await execa("git", ["add", "."], { cwd: repository });
  await execa(
    "git",
    [
      "-c",
      "user.name=Rapture Test",
      "-c",
      "user.email=test@invalid.example",
      "commit",
      "-q",
      "-m",
      "baseline",
    ],
    { cwd: repository },
  );
  return repository;
}

export function fakeTask(
  id: string,
  file: string,
  content: string,
  validation: string,
): TaskDefinition {
  return {
    id,
    description: `write ${file}`,
    baseCommit: "HEAD",
    validation: [validation],
    timeoutSeconds: 5,
    independent: true,
    dependsOn: [],
    fake: {
      files: { [file]: content },
      exitCode: 0,
      delayMs: 10,
      stdout: "done",
      stderr: "",
    },
  };
}

export async function writeTaskFile(
  root: string,
  tasks: readonly TaskDefinition[],
): Promise<string> {
  const path = join(root, "tasks.json");
  await writeFile(path, JSON.stringify({ tasks }), "utf8");
  return path;
}
