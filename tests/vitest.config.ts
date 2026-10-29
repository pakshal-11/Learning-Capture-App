import { defineConfig } from "vitest/config";

// Integration tests hit the real dev Supabase project (see tests/integration/README in docs/TESTING.md).
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
