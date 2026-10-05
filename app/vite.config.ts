import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Browser preview (`npm run dev` then open http://localhost:1420 in a normal browser):
 * src/devmock.ts fakes the Rust commands, using these endpoints for file-system queries.
 */
function devFs(): Plugin {
  return {
    name: "tps-view-dev-fs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/exists", (req, res) => {
        const paths: string[] = JSON.parse(new URL(req.url!, "http://x").searchParams.get("paths") ?? "[]");
        res.end(JSON.stringify(paths.find((p) => existsSync(p) && statSync(p).isFile()) ?? null));
      });
      server.middlewares.use("/__dev/list", (req, res) => {
        const dir = new URL(req.url!, "http://x").searchParams.get("path") ?? "";
        let names: string[] = [];
        try {
          names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
        } catch {
          /* missing dir */
        }
        res.end(JSON.stringify(names));
      });
    },
  };
}

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(({ command }) => ({
  plugins: [react(), devFs()],
  clearScreen: false,
  define: command === "serve" ? { __REPO_ROOT__: JSON.stringify(resolve(__dirname, "..")) } : {},
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] }, fs: { allow: [resolve(__dirname, "..")] } },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "safari15", outDir: "dist" },
}));
