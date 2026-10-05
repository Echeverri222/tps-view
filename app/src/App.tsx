import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { basename, isImageFile } from "@tps-view/core";
import { addImagePaths, confirmDiscard, newFromImages, openDialog, openPath } from "./actions";
import { backend } from "./backend";
import { Inspector } from "./components/Inspector";
import { IssuesPanel, ScaleTable } from "./components/Modals";
import { SpecimenList } from "./components/SpecimenList";
import { StatusBar, Toolbar } from "./components/Chrome";
import { Viewer } from "./components/Viewer";
import { setupMenu } from "./menu";
import { useStore } from "./store";

export function App() {
  const hasFile = useStore((s) => !!s.file);
  const modal = useStore((s) => s.modal);

  useEffect(() => {
    setupMenu().catch(console.error);
  }, []);

  // Window title reflects file name + unsaved state.
  useEffect(() => {
    const win = getCurrentWindow();
    const update = () => {
      const { path, dirty, file } = useStore.getState();
      const name = path ? basename(path) : file ? "Untitled" : "TPS View";
      void win.setTitle(`${name}${dirty ? " — Edited" : ""}`);
    };
    update();
    return useStore.subscribe((s, prev) => {
      if (s.path !== prev.path || s.dirty !== prev.dirty || !!s.file !== !!prev.file) update();
    });
  }, []);

  // Ask before closing with unsaved changes.
  useEffect(() => {
    const p = getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await confirmDiscard())) e.preventDefault();
    });
    return () => void p.then((un) => un());
  }, []);

  // Files opened from Finder / Explorer ("Open With", double-click).
  useEffect(() => {
    const drain = async () => {
      const paths = await backend.takePendingOpen();
      const last = paths[paths.length - 1];
      if (last) await openPath(last);
    };
    const p = listen("open-files-pending", () => void drain());
    void drain();
    return () => void p.then((un) => un());
  }, []);

  // Drag & drop: a .tps opens it, images become new specimens.
  useEffect(() => {
    const p = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const tps = e.payload.paths.find((x) => /\.tps$/i.test(x));
      if (tps) return void openPath(tps);
      const imgs = e.payload.paths.filter(isImageFile).sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
      void addImagePaths(imgs);
    });
    return () => void p.then((un) => un());
  }, []);

  // Single-key shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useStore.getState();
      if (!st.file) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          st.setCurrent(st.current + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          st.setCurrent(st.current - 1);
          break;
        case "Home":
          st.setCurrent(0);
          break;
        case "End":
          st.setCurrent(st.file.specimens.length - 1);
          break;
        case "l":
        case "L":
          st.setTool("landmark");
          break;
        case "v":
        case "V":
          st.setTool("select");
          break;
        case "s":
        case "S":
          st.setTool("scale");
          break;
        case "m":
        case "M":
          st.set({ magnifier: !st.magnifier });
          break;
        case "f":
        case "F":
          st.requestView("fit");
          break;
        case "Backspace":
        case "Delete":
          if (st.selectedLm !== null) st.deleteLandmark(st.selectedLm);
          break;
        case "Escape":
          if (st.modal) st.set({ modal: null });
          else if (st.tool === "scale") st.setTool("landmark");
          else st.selectLm(null);
          break;
        case "ArrowUp":
        case "ArrowDown": {
          const s = st.file.specimens[st.current];
          if (!s?.landmarks.length) return;
          const n = s.landmarks.length;
          const cur = st.selectedLm ?? (e.key === "ArrowDown" ? -1 : n);
          st.selectLm((cur + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!hasFile) return <Welcome />;

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <SpecimenList />
        <Viewer />
        <Inspector />
      </div>
      <StatusBar />
      {modal === "scales" && <ScaleTable />}
      {modal === "issues" && <IssuesPanel />}
    </div>
  );
}

function Welcome() {
  return (
    <div className="app">
      <Toolbar />
      <div className="welcome">
        <div className="welcome-card">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 64 64" width="64" height="64">
              <rect x="4" y="4" width="56" height="56" rx="14" fill="var(--accent)" />
              <path d="M16 42 C 24 22, 40 22, 48 34" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" />
              <circle cx="16" cy="42" r="4.5" fill="#ffd60a" stroke="white" strokeWidth="2" />
              <circle cx="32" cy="26" r="4.5" fill="#ff453a" stroke="white" strokeWidth="2" />
              <circle cx="48" cy="34" r="4.5" fill="#ff453a" stroke="white" strokeWidth="2" />
            </svg>
          </div>
          <h1>TPS View</h1>
          <p className="muted">Create and edit .tps landmark files: open images, place landmarks, set the scale.</p>
          <div className="row center">
            <button className="primary big" onClick={openDialog}>
              Open TPS file…
            </button>
            <button className="big" onClick={newFromImages}>
              New from images…
            </button>
          </div>
          <p className="muted small">or drop a .tps file or a set of images onto this window</p>
        </div>
      </div>
    </div>
  );
}
