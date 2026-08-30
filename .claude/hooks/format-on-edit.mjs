#!/usr/bin/env node
// PostToolUse(Write|Edit): run Biome's formatter on just the edited file.
// jq is not installed on this machine, so the hook payload is parsed with node.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let file;
  try {
    const payload = JSON.parse(raw);
    file = payload?.tool_response?.filePath ?? payload?.tool_input?.file_path;
  } catch {
    process.exit(0);
  }

  // Hard guard: never invoke Biome without a concrete path. An empty argument
  // makes `biome format --write` walk the whole repo.
  if (typeof file !== "string" || file.trim() === "") process.exit(0);

  const target = resolve(file);
  if (!target.startsWith(`${repoRoot}/`)) process.exit(0);
  if (!existsSync(target)) process.exit(0);
  if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc)$/.test(target)) process.exit(0);

  spawnSync("pnpm", ["exec", "biome", "format", "--write", target], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  process.exit(0);
});
