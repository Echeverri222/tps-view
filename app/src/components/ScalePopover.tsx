import { useState } from "react";
import { distance, roundScale, scaleFromReference } from "@tps-view/core";
import { useStore } from "../store";

export const UNITS = ["mm", "cm", "µm", "m", "in"];

type Target = "current" | "all" | "unscaled";

/** Floating panel for the scale tool: click both ends of a ruler, type its real length. */
export function ScalePopover() {
  const scaleRef = useStore((s) => s.scaleRef);
  const unit = useStore((s) => s.unit);
  const set = useStore((s) => s.set);
  const [length, setLength] = useState(() => {
    try {
      return localStorage.getItem("tpsview.refLength") ?? "10";
    } catch {
      return "10";
    }
  });
  const [target, setTarget] = useState<Target>("current");

  if (scaleRef.length < 2) {
    return (
      <div className="scale-popover hint">
        <strong>Measure scale</strong>
        <span>
          Click {scaleRef.length === 0 ? "the first" : "the second"} end of a ruler or reference of known length. <kbd>Esc</kbd> to cancel.
        </span>
      </div>
    );
  }

  const px = distance(scaleRef[0]!, scaleRef[1]!);
  const len = Number(length.replace(",", "."));
  const valid = len > 0 && px > 0;
  const scale = valid ? roundScale(scaleFromReference(scaleRef[0]!, scaleRef[1]!, len)) : 0;

  const apply = () => {
    if (!valid) return;
    const st = useStore.getState();
    const specimens = st.file?.specimens ?? [];
    const indices =
      target === "current"
        ? [st.current]
        : target === "all"
          ? specimens.map((_, i) => i)
          : specimens.map((s, i) => (s.scale === undefined ? i : -1)).filter((i) => i >= 0);
    st.setScale(indices, scale);
    try {
      localStorage.setItem("tpsview.refLength", length);
    } catch {
      /* ignore */
    }
    st.set({ scaleRef: [] });
    st.setTool("landmark");
  };

  return (
    <form
      className="scale-popover"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <strong>Set scale</strong>
      <div className="muted">Reference: {px.toFixed(1)} px</div>
      <label className="row">
        Known length
        <input autoFocus inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} style={{ width: 70 }} />
        <select value={unit} onChange={(e) => set({ unit: e.target.value })}>
          {UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      {valid && (
        <div className="muted">
          SCALE = {scale} {unit}/px · {(1 / scale).toFixed(2)} px/{unit}
        </div>
      )}
      <label className="row">
        Apply to
        <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
          <option value="current">This specimen</option>
          <option value="unscaled">All specimens without a scale</option>
          <option value="all">All specimens</option>
        </select>
      </label>
      <div className="row end">
        <button type="button" onClick={() => set({ scaleRef: [] })}>
          Redo
        </button>
        <button type="submit" className="primary" disabled={!valid}>
          Set scale
        </button>
      </div>
    </form>
  );
}
