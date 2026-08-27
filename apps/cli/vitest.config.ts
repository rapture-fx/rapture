import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@rapture/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@rapture/kernel": fileURLToPath(
        new URL("../../packages/kernel/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    fileParallelism: false,
  },
});
