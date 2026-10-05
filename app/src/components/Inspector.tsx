import { useEffect, useState } from "react";
import { isMissing, missingPoint } from "@tps-view/core";
import { chooseImageForCurrent, deleteCurrentSpecimen, relinkMissingImages } from "../actions";
import { addMissingLandmark, currentSpecimen, useStore } from "../store";
import { UNITS } from "./ScalePopover";

/** Text input that commits on blur / Enter instead of on every keystroke (one undo step per edit). */
function CommitInput(props: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean; mono?: boolean }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  const common = {
    value: draft,
    placeholder: props.placeholder,
    className: props.mono ? "mono" : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(props.multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        setDraft(props.value);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return props.multiline ? <textarea rows={2} {...common} /> : <input {...common} />;
}

export function Inspector() {
  const s = useStore(currentSpecimen);
  const current = useStore((st) => st.current);
  const total = useStore((st) => st.file?.specimens.length ?? 0);
  const info = useStore((st) => (s?.image ? st.images[s.image] : undefined));
  const selectedLm = useStore((st) => st.selectedLm);
  const unit = useStore((st) => st.unit);
  const adjust = useStore((st) => st.adjust);
  const st = useStore.getState;

  if (!s) return <aside className="inspector" />;

  const update = (fn: Parameters<ReturnType<typeof st>["updateSpecimen"]>[1]) => st().updateSpecimen(current, fn);
  const setField = (key: "id" | "comment") => (v: string) =>
    update((sp) => {
      const next = { ...sp };
      if (v === "") delete next[key];
      else next[key] = v;
      return next;
    });

  return (
    <aside className="inspector">
      <section>
        <div className="row spread">
          <h4>
            Specimen {current + 1} <span className="muted">of {total}</span>
          </h4>
          <button className="link danger" onClick={deleteCurrentSpecimen} title="Delete this specimen">
            Delete
          </button>
        </div>
        <label>Image</label>
        <div className="image-field">
          <span className={`chip ${!s.image ? "" : info?.status === "found" ? "ok" : info?.status === "missing" ? "bad" : ""}`}>
            {!s.image ? "none" : info?.status === "found" ? "found" : info?.status === "missing" ? "missing" : "…"}
          </span>
          <code title={info?.path ?? s.image}>{s.image ?? "—"}</code>
        </div>
        <div className="row">
          <button onClick={chooseImageForCurrent}>Choose image…</button>
          {info?.status === "missing" && <button onClick={relinkMissingImages}>Relink missing…</button>}
        </div>
        <label>ID</label>
        <CommitInput value={s.id ?? ""} onCommit={setField("id")} placeholder="ID" />
        <label>Comment</label>
        <CommitInput value={s.comment ?? ""} onCommit={setField("comment")} placeholder="Comment" multiline />
      </section>

      <section>
        <h4>Scale</h4>
        <div className="row">
          <CommitInput
            mono
            value={s.scale === undefined ? "" : String(s.scale)}
            placeholder="not set"
            onCommit={(v) => {
              const n = Number(v.replace(",", "."));
              if (v.trim() === "") st().setScale([current], undefined);
              else if (Number.isFinite(n) && n > 0) st().setScale([current], n);
            }}
          />
          <select value={unit} onChange={(e) => st().set({ unit: e.target.value })} title="Unit (for display; TPS files don't store units)">
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
        {s.scale !== undefined && (
          <div className="muted small">
            {unit}/px · 1 {unit} = {(1 / s.scale).toFixed(2)} px
          </div>
        )}
        <div className="row">
          <button onClick={() => st().setTool("scale")}>Measure…</button>
          <button onClick={() => st().set({ modal: "scales" })}>Scale table…</button>
        </div>
      </section>

      <section className="grow">
        <div className="row spread">
          <h4>
            Landmarks <span className="muted">({s.landmarks.length})</span>
          </h4>
          <button className="link" onClick={addMissingLandmark} title="Add a placeholder for a landmark that can't be placed">
            + missing
          </button>
        </div>
        <div className="lm-table">
          {s.landmarks.length === 0 && <p className="muted small">Click on the image with the Landmark tool (L) to place landmarks.</p>}
          {s.landmarks.map((p, k) => (
            <div key={k} className={`lm-row${k === selectedLm ? " active" : ""}`} onClick={() => st().selectLm(k)}>
              <span className="idx">{k + 1}</span>
              {isMissing(p) ? (
                <span className="muted grow">missing{k === selectedLm ? " — click image to place" : ""}</span>
              ) : (
                <span className="mono grow">
                  {p.x.toFixed(1)}, {p.y.toFixed(1)}
                </span>
              )}
              {k === selectedLm && (
                <span className="row tight">
                  {!isMissing(p) && (
                    <button
                      className="link"
                      title="Mark as missing"
                      onClick={(e) => {
                        e.stopPropagation();
                        update((sp) => ({ ...sp, landmarks: sp.landmarks.map((q, j) => (j === k ? missingPoint(sp.dim) : q)) }));
                      }}
                    >
                      missing
                    </button>
                  )}
                  <button
                    className="link danger"
                    title="Delete (⌫)"
                    onClick={(e) => {
                      e.stopPropagation();
                      st().deleteLandmark(k);
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {(s.curves.length > 0 || s.outlines.length > 0) && (
          <p className="muted small">
            {s.curves.length} curve(s), {s.outlines.length} outline(s) — shown on the image; editing coming in v0.2.
          </p>
        )}
      </section>

      <section>
        <div className="row spread">
          <h4>Image adjustments</h4>
          <button className="link" onClick={() => st().set({ adjust: { brightness: 100, contrast: 100, invert: false } })}>
            Reset
          </button>
        </div>
        <label className="slider">
          Brightness
          <input type="range" min={20} max={300} value={adjust.brightness} onChange={(e) => st().set({ adjust: { ...adjust, brightness: +e.target.value } })} />
        </label>
        <label className="slider">
          Contrast
          <input type="range" min={20} max={300} value={adjust.contrast} onChange={(e) => st().set({ adjust: { ...adjust, contrast: +e.target.value } })} />
        </label>
        <label className="row">
          <input type="checkbox" checked={adjust.invert} onChange={(e) => st().set({ adjust: { ...adjust, invert: e.target.checked } })} /> Invert
        </label>
      </section>
    </aside>
  );
}
