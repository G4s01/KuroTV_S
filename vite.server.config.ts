import path from "node:path";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((mod) => `node:${mod}`),
]);

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      "@kurosync/sync-client": path.resolve(__dirname, "packages/sync-client/src/index.ts"),
    },
  },
  ssr: {
    noExternal: true,
    external: [...nodeBuiltins],
  },
  build: {
    ssr: path.resolve(__dirname, "src/server/index.ts"),
    outDir: "dist/server",
    emptyOutDir: true,
    target: "node24",
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id) || id.startsWith("node:"),
      output: {
        format: "es",
        entryFileNames: "index.mjs",
      },
    },
  },
});
