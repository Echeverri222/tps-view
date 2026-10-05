import { useMemo, useState } from "react";
import { basename, validate } from "@tps-view/core";
import { relinkMissingImages } from "../actions";
import { useStore } from "../store";
import { fmtScale } from "./SpecimenList";

function Modal(props: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const close = () => useStore.getState().set({ modal: null });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={props.title}>
        <div className="row spread">
          <h3>{props.title}</h3>
          <button className="link" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        {props.children}
        <div className="row end">
          {props.actions}
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every specimen's SCALE in one table (like tpsDig's scale listing), with bulk edits. */
export function ScaleTable() {
  const file = useStore((s) => s.file);
  const current = useStore((s) => s.current);
  const unit = useStore((s) => s.unit);
  const st = useStore.getState;
  const specimens = file?.specimens ?? [];
  const [bulk, setBulk] = useState(() => (specimens[current]?.scale !== undefined ? String(specimens[current]!.scale) : ""));
  const bulkValue = Number(bulk.replace(",", "."));
  const bulkValid = bulk.trim() !== "" && Number.isFinite(bulkValue) && bulkValue > 0;
  const missing = specimens.filter((s) => s.scale === undefined).length;
  const distinct = new Set(specimens.map((s) => s.scale).filter((v) => v !== undefined)).size;

  const copyText = () => {
    const lines = ["specimen\tid\timage\tscale"];
    specimens.forEach((s, i) => lines.push(`${i + 1}\t${s.id ?? ""}\t${s.image ?? ""}\t${s.scale ?? ""}`));
    void navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <Modal
      title="Scales"
      actions={
        <button onClick={copyText} title="Copy as tab-separated text (paste into Excel)">
          Copy table
        </button>
      }
    >
      <p className="muted small">
        SCALE is stored in {unit}/px. {missing} of {specimens.length} specimens have no scale · {distinct} distinct value(s).
      </p>
      <div className="row">
        <input className="mono" placeholder="scale value" value={bulk} onChange={(e) => setBulk(e.target.value)} style={{ width: 140 }} />
        <button disabled={!bulkValid} onClick={() => st().setScale(specimens.map((_, i) => i), bulkValue)}>
          Apply to all
        </button>
        <button disabled={!bulkValid} onClick={() => st().setScale(specimens.flatMap((s, i) => (s.scale === undefined ? [i] : [])), bulkValue)}>
          Apply to missing only
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Image</th>
              <th>ID</th>
              <th>Scale ({unit}/px)</th>
              <th>px/{unit}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {specimens.map((s, i) => (
              <tr key={i} className={i === current ? "active" : ""}>
                <td>{i + 1}</td>
                <td title={s.image}>{s.image ? basename(s.image) : "—"}</td>
                <td>{s.id ?? ""}</td>
                <td className="mono">
                  <ScaleCell value={s.scale} onCommit={(v) => st().setScale([i], v)} />
                </td>
                <td className="mono muted">{s.scale ? (1 / s.scale).toFixed(2) : ""}</td>
                <td>
                  <button
                    className="link"
                    onClick={() => {
                      st().setCurrent(i);
                      st().set({ modal: null });
                    }}
                  >
                    Go
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function ScaleCell({ value, onCommit }: { value: number | undefined; onCommit: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : fmtScale(value));
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.replace(",", "."));
    if (draft.trim() === "") onCommit(undefined);
    else if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    setDraft(null);
  };
  return (
    <input
      className="cell"
      value={shown}
      placeholder="—"
      onFocus={() => setDraft(value === undefined ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** Parse warnings + dataset validation (landmark counts, missing images/scales, duplicates). */
export function IssuesPanel() {
  const file = useStore((s) => s.file);
  const warnings = useStore((s) => s.warnings);
  const images = useStore((s) => s.images);
  const st = useStore.getState;
  const issues = useMemo(() => (file ? validate(file) : []), [file]);
  const missingImages = (file?.specimens ?? []).flatMap((s, i) => (s.image && images[s.image]?.status === "missing" ? [i] : []));

  const go = (i: number) => {
    st().setCurrent(i);
    st().set({ modal: null });
  };

  return (
    <Modal title="Check dataset" actions={missingImages.length > 0 && <button onClick={relinkMissingImages}>Relink missing images…</button>}>
      <div className="table-wrap">
        {warnings.length > 0 && (
          <>
            <h4>While reading the file</h4>
            <ul className="issues">
              {warnings.map((w, k) => (
                <li key={k}>
                  <span className="muted">line {w.line}</span> {w.message}
                </li>
              ))}
            </ul>
          </>
        )}
        {missingImages.length > 0 && (
          <>
            <h4>Images not found ({missingImages.length})</h4>
            <ul className="issues">
              {missingImages.map((i) => (
                <li key={i}>
                  <button className="link" onClick={() => go(i)}>
                    Specimen {i + 1}
                  </button>{" "}
                  <code>{file!.specimens[i]!.image}</code>
                </li>
              ))}
            </ul>
          </>
        )}
        <h4>Dataset</h4>
        {issues.length === 0 ? (
          <p>No problems found. ✓</p>
        ) : (
          <ul className="issues">
            {issues.map((iss, k) => (
              <li key={k}>
                <button className="link" onClick={() => go(iss.specimen)}>
                  Go
                </button>{" "}
                {iss.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
