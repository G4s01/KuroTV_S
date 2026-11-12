import { applyD1Migrations, env } from "cloudflare:test";

// Automatically apply D1 migrations to the isolated test database before tests run
if (
  env?.DB &&
  (env as any).TEST_MIGRATIONS &&
  Array.isArray((env as any).TEST_MIGRATIONS) &&
  (env as any).TEST_MIGRATIONS.length > 0
) {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
}
