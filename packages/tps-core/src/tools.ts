import { distance } from "./coords";
import { emptySpecimen, isMissing, type Point, type TpsFile } from "./model";
import { basename } from "./paths";

/** New TPS file with one empty specimen per image (like tpsUtil "Build tps file from images"). */
export function buildFromImages(imageFields: string[]): TpsFile {
  return {
    lineEnding: "\r\n",
    specimens: imageFields.map((image, idx) => emptySpecimen({ image, id: String(idx) })),
  };
}

export type IssueKind =
  | "landmark-count"
  | "missing-landmark"
  | "no-image"
  | "no-scale"
  | "duplicate-id"
  | "duplicate-image";

export interface Issue {
  specimen: number;
  kind: IssueKind;
  message: string;
}

/** Dataset-level checks that are easy to miss before running an analysis. */
export function validate(file: TpsFile): Issue[] {
  const issues: Issue[] = [];
  const counts = new Map<number, number>();
  for (const s of file.specimens) counts.set(s.landmarks.length, (counts.get(s.landmarks.length) ?? 0) + 1);
  const expected = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ids = new Map<string, number>();
  const images = new Map<string, number>();

  file.specimens.forEach((s, i) => {
    const label = `Specimen ${i + 1}`;
    if (expected !== undefined && s.landmarks.length !== expected)
      issues.push({ specimen: i, kind: "landmark-count", message: `${label} has ${s.landmarks.length} landmarks; most have ${expected}` });
    const miss = s.landmarks.map((p, k) => (isMissing(p) ? k + 1 : 0)).filter(Boolean);
    if (miss.length) issues.push({ specimen: i, kind: "missing-landmark", message: `${label}: missing landmark(s) ${miss.join(", ")}` });
    if (!s.image) issues.push({ specimen: i, kind: "no-image", message: `${label} has no IMAGE=` });
    if (s.scale === undefined) issues.push({ specimen: i, kind: "no-scale", message: `${label} has no SCALE=` });
    if (s.id !== undefined) {
      const prev = ids.get(s.id);
      if (prev !== undefined) issues.push({ specimen: i, kind: "duplicate-id", message: `${label} repeats ID=${s.id} (specimen ${prev + 1})` });
      else ids.set(s.id, i);
    }
    if (s.image) {
      const key = basename(s.image).toLowerCase();
      const prev = images.get(key);
      if (prev !== undefined) issues.push({ specimen: i, kind: "duplicate-image", message: `${label} uses the same image as specimen ${prev + 1}` });
      else images.set(key, i);
    }
  });
  return issues;
}

/** Re-number IDs 0..n-1 in file order (tpsDig convention). */
export function renumberIds(file: TpsFile): TpsFile {
  return { ...file, specimens: file.specimens.map((s, i) => ({ ...s, id: String(i) })) };
}

/** Resamples a polyline into `n` points equally spaced along its length (semilandmarks). */
export function resampleCurve(points: Point[], n: number): Point[] {
  if (points.length === 0 || n <= 0) return [];
  if (n === 1 || points.length === 1) return [{ ...points[0]! }];
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + distance(points[i - 1]!, points[i]!));
  const total = cum[cum.length - 1]!;
  const out: Point[] = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < points.length - 1 && cum[seg]! < target) seg++;
    const a = points[seg - 1]!;
    const b = points[seg]!;
    const len = cum[seg]! - cum[seg - 1]!;
    const t = len === 0 ? 0 : (target - cum[seg - 1]!) / len;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export interface CsvOptions {
  /** Multiply coordinates by SCALE (specimens without SCALE are left in pixels). */
  scaled?: boolean;
  /** Write missing landmarks as empty cells instead of their raw negative values. */
  missingAsEmpty?: boolean;
}

/** Wide CSV: one row per specimen, columns X1,Y1,X2,Y2,... */
export function toCsv(file: TpsFile, opts: CsvOptions = {}): string {
  const maxLm = Math.max(0, ...file.specimens.map((s) => s.landmarks.length));
  const is3d = file.specimens.some((s) => s.dim === 3);
  const header = ["specimen", "id", "image", "scale"];
  for (let k = 1; k <= maxLm; k++) header.push(`X${k}`, `Y${k}`, ...(is3d ? [`Z${k}`] : []));
  const rows = [header.map(csvCell).join(",")];
  file.specimens.forEach((s, i) => {
    const f = opts.scaled && s.scale !== undefined ? s.scale : 1;
    const row: string[] = [String(i + 1), s.id ?? "", s.image ?? "", s.scale === undefined ? "" : String(s.scale)];
    for (let k = 0; k < maxLm; k++) {
      const p = s.landmarks[k];
      const empty = !p || (opts.missingAsEmpty !== false && isMissing(p));
      row.push(empty ? "" : String(p.x * f), empty ? "" : String(p.y * f));
      if (is3d) row.push(empty ? "" : String((p.z ?? 0) * f));
    }
    rows.push(row.map(csvCell).join(","));
  });
  return rows.join("\n") + "\n";
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
