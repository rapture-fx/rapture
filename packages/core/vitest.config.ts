import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@rapture/kernel": fileURLToPath(new URL("../kernel/src/index.ts", import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
