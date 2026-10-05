import { useEffect, useMemo, useRef, useState } from "react";
import { basename, isMissing } from "@tps-view/core";
import { addImages } from "../actions";
import { useStore } from "../store";

export function SpecimenList() {
  const file = useStore((s) => s.file);
  const current = useStore((s) => s.current);
  const images = useStore((s) => s.images);
  const setCurrent = useStore((s) => s.setCurrent);
  const [filter, setFilter] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const specimens = file?.specimens ?? [];
  // The most common landmark count is treated as "complete".
  const expected = useMemo(() => {
    const counts = new Map<number, number>();
    for (const s of specimens) if (s.landmarks.length) counts.set(s.landmarks.length, (counts.get(s.landmarks.length) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  }, [specimens]);
  const done = specimens.filter((s) => expected > 0 && s.landmarks.length >= expected && !s.landmarks.some(isMissing)).length;

  const q = filter.trim().toLowerCase();
  const rows = specimens
    .map((s, i) => ({ s, i, name: s.image ? basename(s.image) : "(no image)" }))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.s.id ?? "").toLowerCase().includes(q));

  useEffect(() => {
    listRef.current?.querySelector(".specimen.active")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="row spread">
          <strong>Specimens</strong>
          <span className="muted">
            {done}/{specimens.length} done
          </span>
        </div>
        <div className="progress">
          <div style={{ width: `${specimens.length ? (100 * done) / specimens.length : 0}%` }} />
        </div>
        <input type="search" placeholder="Filter by image or ID" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="specimen-list" ref={listRef}>
        {rows.map(({ s, i, name }) => {
          const info = s.image ? images[s.image] : undefined;
          const missingImg = !s.image || info?.status === "missing";
          const complete = expected > 0 && s.landmarks.length >= expected && !s.landmarks.some(isMissing);
          return (
            <button key={i} className={`specimen${i === current ? " active" : ""}`} onClick={() => setCurrent(i)} title={s.image ?? ""}>
              <span className="idx">{i + 1}</span>
              <span className="name">
                <span className={missingImg ? "warn" : ""}>{name}</span>
                <small>
                  {s.id !== undefined ? `ID ${s.id} · ` : ""}
                  {s.scale !== undefined ? `scale ${fmtScale(s.scale)}` : "no scale"}
                </small>
              </span>
              <span className={`badge${complete ? " ok" : s.landmarks.length ? " partial" : ""}`}>{s.landmarks.length}</span>
            </button>
          );
        })}
        {specimens.length > 0 && rows.length === 0 && <p className="muted pad">No specimens match.</p>}
      </div>
      <div className="sidebar-foot">
        <button onClick={addImages}>+ Add images…</button>
      </div>
    </aside>
  );
}

export function fmtScale(v: number) {
  return Number(v.toPrecision(5)).toString();
}
