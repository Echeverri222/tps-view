import { basename } from "@tps-view/core";
import { newFromImages, openDialog, saveFile } from "../actions";
import { currentSpecimen, useStore, type Tool } from "../store";

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Move", key: "V", hint: "Drag landmarks or pan the image" },
  { id: "landmark", label: "Landmark", key: "L", hint: "Click to place the next landmark" },
  { id: "scale", label: "Scale", key: "S", hint: "Measure a reference to set SCALE" },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const magnifier = useStore((s) => s.magnifier);
  const dirty = useStore((s) => s.dirty);
  const hasFile = useStore((s) => !!s.file);
  const st = useStore.getState;

  return (
    <header className="toolbar">
      <div className="group">
        <button onClick={openDialog} title="Open a .tps file (⌘O)">
          Open
        </button>
        <button onClick={newFromImages} title="Create a new TPS file from a set of images (⌘N)">
          New from images
        </button>
        <button onClick={() => saveFile()} disabled={!hasFile} className={dirty ? "primary" : ""} title="Save (⌘S)">
          Save
        </button>
      </div>
      {hasFile && (
        <>
          <div className="segmented" role="radiogroup">
            {TOOLS.map((t) => (
              <button key={t.id} role="radio" aria-checked={tool === t.id} className={tool === t.id ? "on" : ""} onClick={() => st().setTool(t.id)} title={`${t.hint} (${t.key})`}>
                {t.label} <kbd>{t.key}</kbd>
              </button>
            ))}
          </div>
          <div className="group">
            <button onClick={() => st().requestView("out")} title="Zoom out (⌘-)">
              −
            </button>
            <button onClick={() => st().requestView("fit")} title="Fit image (⌘0)">
              Fit
            </button>
            <button onClick={() => st().requestView("in")} title="Zoom in (⌘+)">
              +
            </button>
            <button className={magnifier ? "on" : ""} onClick={() => st().set({ magnifier: !magnifier })} title="Magnifier (M)">
              Magnifier
            </button>
            <button onClick={() => st().set({ modal: "scales" })} title="List and edit all scales (⌘T)">
              Scales
            </button>
            <button onClick={() => st().set({ modal: "issues" })} title="Check the dataset for problems">
              Check
            </button>
          </div>
        </>
      )}
    </header>
  );
}

export function StatusBar() {
  const path = useStore((s) => s.path);
  const dirty = useStore((s) => s.dirty);
  const cursor = useStore((s) => s.cursor);
  const zoom = useStore((s) => s.zoom);
  const current = useStore((s) => s.current);
  const total = useStore((s) => s.file?.specimens.length ?? 0);
  const scale = useStore((s) => currentSpecimen(s)?.scale);
  const unit = useStore((s) => s.unit);

  return (
    <footer className="statusbar">
      <span title={path ?? ""}>
        {path ? basename(path) : "Untitled"}
        {dirty && <span className="dot" title="Unsaved changes" />}
      </span>
      {total > 0 && (
        <span>
          Specimen {current + 1}/{total}
        </span>
      )}
      <span className="mono">
        {cursor ? `x ${Math.round(cursor.x)}  y ${Math.round(cursor.y)} px` : ""}
        {cursor && scale !== undefined ? `  (${(cursor.x * scale).toFixed(3)}, ${(cursor.y * scale).toFixed(3)} ${unit})` : ""}
      </span>
      <span className="spacer" />
      <span className="muted">Pinch or ⌘-scroll to zoom · Space-drag to pan · ←/→ change specimen</span>
      <span className="mono">{Math.round(zoom * 100)}%</span>
    </footer>
  );
}
