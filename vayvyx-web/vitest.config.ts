import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "server/tests/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
  },
});
