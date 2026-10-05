/**
 * Development-only fake of the Tauri backend so the UI can run in an ordinary browser
 * (handy for UI work and automated testing). Loaded from main.tsx only when running under
 * `vite` without Tauri. Opens examples/wing/anfaan01.tps on start; "saves" are kept in memory.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

declare const __REPO_ROOT__: string;
const root = __REPO_ROOT__;
const demoDir = `${root}/examples/wing`;
const saved: Record<string, string> = {};
(window as unknown as { __saved: typeof saved }).__saved = saved;
let pending = [`${demoDir}/anfaan01.tps`];

const file = (p: string) => fetch(`/@fs${p}`).then((r) => {
  if (!r.ok) throw new Error(`${p}: not found`);
  return r;
});
const json = (url: string) => fetch(url).then((r) => r.json());

mockWindows("main");
mockIPC(
  async (cmd, args) => {
    const a = (args ?? {}) as Record<string, any>;
    switch (cmd) {
      case "read_text":
        return saved[a.path] ?? (await file(a.path)).text();
      case "write_text":
        saved[a.path] = a.contents;
        console.log(`[devmock] wrote ${a.path}\n${a.contents}`);
        return null;
      case "read_bytes":
        return (await file(a.path)).arrayBuffer();
      case "first_existing":
        return json(`/__dev/exists?paths=${encodeURIComponent(JSON.stringify(a.paths))}`);
      case "list_dir":
        return json(`/__dev/list?path=${encodeURIComponent(a.path)}`);
      case "take_pending_open": {
        const p = pending;
        pending = [];
        return p;
      }
      case "plugin:dialog|open":
        if (a.options?.directory) return demoDir;
        if (a.options?.multiple) return [`${demoDir}/anfaan01.png`];
        return a.options?.filters?.[0]?.name === "Images" ? `${demoDir}/anfaan01.png` : `${demoDir}/anfaan01.tps`;
      case "plugin:dialog|save":
        return `${demoDir}/saved.tps`;
      case "plugin:dialog|ask":
      case "plugin:dialog|confirm":
        return true;
      case "plugin:dialog|message":
        console.log("[devmock] dialog:", a.message);
        return null;
      case "plugin:menu|new":
        return [Math.floor(Math.random() * 1e9), String(Math.random())];
      case "plugin:event|listen":
        return Math.floor(Math.random() * 1e9);
      default:
        return null;
    }
  },
);
