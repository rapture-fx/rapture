import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { codexAgentAdapter } from "../src/adapters/codex.js";
import { fakeAgentAdapter } from "../src/adapters/fake.js";
import { OPENCODE_MODEL, opencodeAgentAdapter } from "../src/adapters/opencode.js";
import type { AgentAdapter } from "../src/adapters/types.js";

it("implements a provider-neutral deterministic adapter", async () => {
  const adapter: AgentAdapter = fakeAgentAdapter;
  expect(adapter.name()).toBe("fake");
  await expect(adapter.version()).resolves.toBe("1");
  await expect(adapter.isAvailable()).resolves.toMatchObject({ available: true });
  await expect(Promise.resolve(adapter.probeCredentials({}))).resolves.toMatchObject({
    required: false,
    present: true,
  });
});

it("recognizes an authenticated Codex ChatGPT session without reading credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-codex-auth-"));
  const executable = join(root, "codex");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(executable, 0o755);

  await expect(
    Promise.resolve(
      codexAgentAdapter.probeCredentials({ PATH: root, CODEX_HOME: join(root, "home") }),
    ),
  ).resolves.toMatchObject({ present: true, method: "chatgpt", envVar: null });
});

it("reports OpenCode identity and builds an explicit non-interactive argv", () => {
  expect(opencodeAgentAdapter.name()).toBe("opencode");
  const command = opencodeAgentAdapter.command({
    task: {
      id: "add-volume-discount",
      description: "implement applyVolumeDiscount",
      baseCommit: "abc",
      validation: ["node v.mjs"],
      timeoutSeconds: 180,
      independent: true,
      dependsOn: [],
    },
    worktree: "/tmp/worktree",
    model: "opencode/deepseek-v4-flash-free",
    trialId: "workers-1-trial-1",
    repetition: 1,
  });
  expect(command[0]).toBe("opencode");
  expect(command).toContain("run");
  expect(command).toContain("--model");
  expect(command).toContain(OPENCODE_MODEL);
  expect(command).toContain("--format");
  expect(command).toContain("json");
  expect(command.join(" ")).toContain(
    "Complete this repository task: implement applyVolumeDiscount",
  );
});

it("detects OpenCode API-key credential presence without retaining the secret", () => {
  const probe = opencodeAgentAdapter.probeCredentials({ OPENCODE_API_KEY: "op-live-secret" });
  expect(Promise.resolve(probe)).resolves.toMatchObject({
    present: true,
    method: "api-key",
    envVar: "OPENCODE_API_KEY",
  });
});

it("detects OpenCode auth storage presence through a working provider probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-opencode-auth-"));
  const executable = join(root, "opencode");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(executable, 0o755);
  const dataHome = join(root, "data");
  await mkdir(join(dataHome, "opencode"), { recursive: true });
  await writeFile(join(dataHome, "opencode", "auth.json"), "{}", "utf8");

  await expect(
    Promise.resolve(
      opencodeAgentAdapter.probeCredentials({
        PATH: root,
        XDG_DATA_HOME: dataHome,
      }),
    ),
  ).resolves.toMatchObject({ present: true, method: "opencode", envVar: null });
});

it("reports missing OpenCode auth storage without secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-opencode-noauth-"));
  await expect(
    Promise.resolve(
      opencodeAgentAdapter.probeCredentials({ PATH: root, XDG_DATA_HOME: join(root, "empty") }),
    ),
  ).resolves.toMatchObject({ present: false });
});

async function withPath<T>(prefix: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = `${prefix}:${previous ?? ""}`;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
}

it("runs the OpenCode adapter against a deterministic executable test double", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-opencode-double-"));
  const executable = join(root, "opencode");
  await writeFile(
    executable,
    ["#!/bin/sh", 'echo \'{"type":"step_finish","reason":"stop"}\'', "exit 0"].join("\n"),
    "utf8",
  );
  await chmod(executable, 0o755);
  const worktree = await mkdtemp(join(tmpdir(), "rapture-opencode-worktree-"));

  const result = await withPath(root, async () =>
    opencodeAgentAdapter.run({
      task: {
        id: "add-volume-discount",
        description: "implement applyVolumeDiscount",
        baseCommit: "abc",
        validation: ["node v.mjs"],
        timeoutSeconds: 30,
        independent: true,
        dependsOn: [],
      },
      worktree,
      model: OPENCODE_MODEL,
      trialId: "workers-1-trial-1",
      repetition: 1,
    }),
  );
  expect(result.process.exitCode).toBe(0);
  expect(result.process.timedOut).toBe(false);
  expect(result.process.stdout).toContain("step_finish");
  expect(result.tokenUsage).toBeNull();
  expect(result.providerCost).toBeNull();
  expect(result.toolCalls).toBeNull();
});

it("honors the OpenCode adapter timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "rapture-opencode-timeout-"));
  const executable = join(root, "opencode");
  await writeFile(executable, "#!/bin/sh\nsleep 30\n", "utf8");
  await chmod(executable, 0o755);
  const worktree = await mkdtemp(join(tmpdir(), "rapture-opencode-timeout-worktree-"));

  const result = await withPath(root, async () =>
    opencodeAgentAdapter.run({
      task: {
        id: "slow",
        description: "slow task",
        baseCommit: "abc",
        validation: [],
        timeoutSeconds: 1,
        independent: true,
        dependsOn: [],
      },
      worktree,
      model: OPENCODE_MODEL,
      trialId: "workers-1-trial-1",
      repetition: 1,
    }),
  );
  expect(result.process.timedOut).toBe(true);
});
