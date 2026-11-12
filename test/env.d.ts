/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS?: Fetcher;
      SYNC_ADMIN_SECRET?: string;
      TEST_MIGRATIONS?: D1Migration[];
    }
  }
}

declare module "cloudflare:test" {
  export const env: Cloudflare.Env;
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
}
