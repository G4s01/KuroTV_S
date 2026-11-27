import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@kurosync/sync-client": path.resolve(__dirname, "packages/sync-client/src/index.ts"),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
