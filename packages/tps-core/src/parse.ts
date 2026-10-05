import { emptySpecimen, type ParseWarning, type Point, type PointSet, type Specimen, type TpsFile } from "./model";

export interface ParseResult {
  file: TpsFile;
  warnings: ParseWarning[];
}

const KEYWORD_RE = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Tolerant TPS parser. Accepts CRLF/LF/CR line endings, any keyword case, blank lines,
 * tabs or commas between values and decimal commas ("12,5 30,25"). Problems are reported as
 * warnings instead of throwing so a damaged file can still be opened and repaired.
 */
export function parseTps(text: string): ParseResult {
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const warnings: ParseWarning[] = [];
  const specimens: Specimen[] = [];
  let current: Specimen | null = null;
  let i = 0;

  const warn = (line: number, message: string) => warnings.push({ line: line + 1, message });

  /** Reads `count` coordinate lines starting at `i`, advancing `i`. */
  const readPoints = (count: number, dim: 2 | 3, what: string): Point[] => {
    const pts: Point[] = [];
    while (pts.length < count && i < lines.length) {
      const raw = lines[i]!.trim();
      if (raw === "") {
        i++;
        continue;
      }
      if (KEYWORD_RE.test(raw)) {
        warn(i, `${what}: expected ${count} points but found ${pts.length} before "${raw.split("=")[0]}"`);
        return pts;
      }
      const nums = parseNumbers(raw, dim);
      if (!nums || nums.length < dim) {
        warn(i, `${what}: could not read coordinates from "${raw}"`);
        i++;
        continue;
      }
      pts.push(dim === 3 ? { x: nums[0]!, y: nums[1]!, z: nums[2]! } : { x: nums[0]!, y: nums[1]! });
      i++;
    }
    if (pts.length < count) warn(i - 1, `${what}: expected ${count} points but file ended after ${pts.length}`);
    return pts;
  };

  /** Reads a sequence of `POINTS=m` blocks (used by CURVES= and OUTLINES=). */
  const readPointSets = (count: number, dim: 2 | 3, what: string): PointSet[] => {
    const sets: PointSet[] = [];
    while (sets.length < count && i < lines.length) {
      const raw = lines[i]!.trim();
      if (raw === "") {
        i++;
        continue;
      }
      const m = KEYWORD_RE.exec(raw);
      if (!m || m[1]!.toUpperCase() !== "POINTS") {
        warn(i, `${what}: expected POINTS= for item ${sets.length + 1} of ${count}`);
        break;
      }
      const n = parseCount(m[2]!);
      i++;
      if (n === null) {
        warn(i - 1, `${what}: invalid POINTS value "${m[2]}"`);
        continue;
      }
      sets.push({ points: readPoints(n, dim, `${what} ${sets.length + 1}`) });
    }
    return sets;
  };

  while (i < lines.length) {
    const raw = lines[i]!.trim();
    if (raw === "") {
      i++;
      continue;
    }
    const m = KEYWORD_RE.exec(raw);
    if (!m) {
      warn(i, `unexpected line "${raw}"`);
      i++;
      continue;
    }
    const key = m[1]!.toUpperCase();
    const value = m[2]!.trim();
    const lineNo = i;
    i++;

    if (key === "LM" || key === "LM3") {
      const dim = key === "LM3" ? 3 : 2;
      const n = parseCount(value);
      current = emptySpecimen({ dim });
      specimens.push(current);
      if (n === null) {
        warn(lineNo, `invalid ${key} value "${value}"`);
        continue;
      }
      current.landmarks = readPoints(n, dim, `specimen ${specimens.length} landmarks`);
      continue;
    }

    if (!current) {
      // Keywords before the first LM= line: tolerate by starting an implicit specimen.
      warn(lineNo, `"${key}=" found before any LM= line`);
      current = emptySpecimen();
      specimens.push(current);
    }

    switch (key) {
      case "CURVES": {
        const n = parseCount(value);
        if (n === null) warn(lineNo, `invalid CURVES value "${value}"`);
        else current.curves = readPointSets(n, current.dim, `specimen ${specimens.length} curve`);
        break;
      }
      case "OUTLINES": {
        const n = parseCount(value);
        if (n === null) warn(lineNo, `invalid OUTLINES value "${value}"`);
        else current.outlines = readPointSets(n, current.dim, `specimen ${specimens.length} outline`);
        break;
      }
      case "POINTS": {
        // A stray POINTS= without CURVES=: treat as a single curve.
        const n = parseCount(value);
        if (n === null) warn(lineNo, `invalid POINTS value "${value}"`);
        else current.curves.push({ points: readPoints(n, current.dim, `specimen ${specimens.length} curve`) });
        break;
      }
      case "VARIABLES": {
        const n = parseCount(value);
        if (n === null) {
          warn(lineNo, `invalid VARIABLES value "${value}"`);
          break;
        }
        const vals: number[] = [];
        while (vals.length < n && i < lines.length) {
          const l = lines[i]!.trim();
          if (l === "") {
            i++;
            continue;
          }
          if (KEYWORD_RE.test(l)) break;
          for (const tok of l.split(/[\s,;]+/)) {
            const v = parseNumber(tok);
            if (v !== null) vals.push(v);
          }
          i++;
        }
        if (vals.length !== n) warn(lineNo, `VARIABLES: expected ${n} values, found ${vals.length}`);
        current.variables = vals;
        break;
      }
      case "IMAGE":
        current.image = value;
        break;
      case "ID":
        current.id = value;
        break;
      case "SCALE": {
        const v = parseNumber(value);
        if (v === null) warn(lineNo, `invalid SCALE value "${value}"`);
        else current.scale = v;
        break;
      }
      case "COMMENT":
        current.comment = value;
        break;
      default:
        current.extra.push({ key: m[1]!, value });
    }
  }

  return { file: { specimens, lineEnding }, warnings };
}

function parseCount(s: string): number | null {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseNumber(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Splits a coordinate line into numbers. Handles "x y", "x\ty", "x,y" and decimal-comma
 * locales ("12,5 30,25" or "12,5;30,25").
 */
function parseNumbers(line: string, dim: number): number[] | null {
  let tokens = line.split(/[\s;]+/).filter(Boolean);
  if (tokens.length < dim) {
    // "x,y" style: commas are separators.
    tokens = line.split(/[\s,;]+/).filter(Boolean);
  }
  const nums: number[] = [];
  for (const t of tokens) {
    const n = parseNumber(t);
    if (n === null) return null;
    nums.push(n);
  }
  return nums;
}
