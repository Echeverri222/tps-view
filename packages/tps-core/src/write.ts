import type { Point, PointSet, Specimen, TpsFile } from "./model";

export interface WriteOptions {
  /** Defaults to the file's detected line ending (CRLF for new files, matching tpsDig on Windows). */
  lineEnding?: "\r\n" | "\n";
  /** Decimal places for coordinates. tpsDig writes 5. */
  decimals?: number;
}

/**
 * Serialises a TPS file in the layout tpsDig2 produces:
 *   LM=n, coordinates, CURVES/OUTLINES blocks, VARIABLES, IMAGE, ID, SCALE, COMMENT, extras.
 */
export function writeTps(file: TpsFile, opts: WriteOptions = {}): string {
  const eol = opts.lineEnding ?? file.lineEnding ?? "\r\n";
  const decimals = opts.decimals ?? 5;
  const out: string[] = [];
  const fmt = (p: Point, dim: 2 | 3) =>
    dim === 3
      ? `${p.x.toFixed(decimals)} ${p.y.toFixed(decimals)} ${(p.z ?? 0).toFixed(decimals)}`
      : `${p.x.toFixed(decimals)} ${p.y.toFixed(decimals)}`;
  const sets = (keyword: string, list: PointSet[], dim: 2 | 3) => {
    if (list.length === 0) return;
    out.push(`${keyword}=${list.length}`);
    for (const s of list) {
      out.push(`POINTS=${s.points.length}`);
      for (const p of s.points) out.push(fmt(p, dim));
    }
  };

  for (const s of file.specimens) {
    writeSpecimen(s);
  }

  function writeSpecimen(s: Specimen) {
    out.push(`${s.dim === 3 ? "LM3" : "LM"}=${s.landmarks.length}`);
    for (const p of s.landmarks) out.push(fmt(p, s.dim));
    sets("CURVES", s.curves, s.dim);
    sets("OUTLINES", s.outlines, s.dim);
    if (s.variables && s.variables.length > 0) {
      out.push(`VARIABLES=${s.variables.length}`);
      for (const v of s.variables) out.push(String(v));
    }
    if (s.image !== undefined) out.push(`IMAGE=${s.image}`);
    if (s.id !== undefined) out.push(`ID=${s.id}`);
    if (s.scale !== undefined) out.push(`SCALE=${formatScale(s.scale)}`);
    if (s.comment !== undefined && s.comment !== "") out.push(`COMMENT=${s.comment}`);
    for (const e of s.extra) out.push(`${e.key}=${e.value}`);
  }

  return out.join(eol) + eol;
}

/** Shortest representation that round-trips, without exponent notation (tps tools dislike "1e-5"). */
export function formatScale(v: number): string {
  const s = String(v);
  if (!/e/i.test(s)) return s;
  return v.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}
