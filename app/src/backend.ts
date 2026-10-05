import { invoke } from "@tauri-apps/api/core";

/** Thin typed wrappers around the Rust commands in src-tauri/src/lib.rs. */
export const backend = {
  readText: (path: string) => invoke<string>("read_text", { path }),
  writeText: (path: string, contents: string) => invoke<void>("write_text", { path, contents }),
  readBytes: (path: string) => invoke<ArrayBuffer>("read_bytes", { path }),
  firstExisting: (paths: string[]) => invoke<string | null>("first_existing", { paths }),
  listDir: (path: string) => invoke<string[]>("list_dir", { path }),
  takePendingOpen: () => invoke<string[]>("take_pending_open"),
};
