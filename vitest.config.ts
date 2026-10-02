import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    env: { HACKAHUB_DB: ":memory:" },
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
  },
});
