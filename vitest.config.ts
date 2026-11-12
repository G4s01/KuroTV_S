import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrationsPath = path.resolve(__dirname, "migrations");
  let migrations: any[] = [];
  try {
    migrations = await readD1Migrations(migrationsPath);
  } catch (err) {
    console.warn("Failed to read D1 migrations:", err);
  }

  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                compatibilityDate: "2026-08-22",
                bindings: {
                  TEST_MIGRATIONS: migrations,
                },
              },
            }),
          ],
          test: {
            name: "workers",
            setupFiles: ["./test/helpers/setup.ts"],
            include: [
              "test/**/*.test.ts",
              "!test/client-sdk/**/*.test.ts",
              "!packages/sync-client/**/*.test.ts",
              "!test/tier1-feature-coverage/client-sdk.test.ts",
              "!test/tier2-boundary-corner/client-sdk-boundary.test.ts",
            ],
          },
        },
        {
          test: {
            name: "client-sdk",
            environment: "node",
            include: [
              "test/client-sdk/**/*.test.ts",
              "test/tier1-feature-coverage/client-sdk.test.ts",
              "test/tier2-boundary-corner/client-sdk-boundary.test.ts",
              "packages/sync-client/**/*.test.ts",
            ],
          },
        },
      ],
    },
  };
});
