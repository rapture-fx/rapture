import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { codexAgentAdapter } from "../src/adapters/codex.js";
import { fakeAgentAdapter } from "../src/adapters/fake.js";
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
