/**
 * Data model for TPS files (F. James Rohlf's tps series: tpsDig, tpsUtil, tpsRelw...).
 *
 * Coordinates are stored exactly as they appear in the file: pixels with the origin at the
 * BOTTOM-left corner of the image (y grows upwards). Use `tpsToImage` / `imageToTps` from
 * `coords.ts` to convert to screen/image space (origin top-left).
 */

export interface Point {
  x: number;
  y: number;
  /** Only present for 3D landmarks (LM3=). */
  z?: number;
}

/** An open curve (CURVES= block) or closed outline (OUTLINES= block) as a list of points. */
export interface PointSet {
  points: Point[];
}

/** A keyword we don't model explicitly, preserved so files round-trip without data loss. */
export interface ExtraField {
  key: string;
  value: string;
}

export interface Specimen {
  /** 2 for LM=, 3 for LM3=. */
  dim: 2 | 3;
  /** Fixed landmarks. Missing landmarks are encoded with negative coordinates (see `isMissing`). */
  landmarks: Point[];
  curves: PointSet[];
  outlines: PointSet[];
  /** IMAGE= value exactly as written in the file (may be a Windows path). */
  image?: string;
  /** ID= value. */
  id?: string;
  /** SCALE= value: units per pixel. */
  scale?: number;
  /** COMMENT= value. */
  comment?: string;
  /** VARIABLES= values. */
  variables?: number[];
  extra: ExtraField[];
}

export interface TpsFile {
  specimens: Specimen[];
  /** Line ending detected when parsing; used again when writing. */
  lineEnding: "\r\n" | "\n";
}

export interface ParseWarning {
  line: number;
  message: string;
}

export function emptySpecimen(partial: Partial<Specimen> = {}): Specimen {
  return {
    dim: 2,
    landmarks: [],
    curves: [],
    outlines: [],
    extra: [],
    ...partial,
  };
}

/** Coordinate value conventionally used to flag a missing landmark. */
export const MISSING_VALUE = -1;

/**
 * tpsDig has no native "missing" flag; the community convention (also used by
 * geomorph::readland.tps with negNA=TRUE) is negative coordinates. Real coordinates are
 * always >= 0 because the origin is the image corner.
 */
export function isMissing(p: Point): boolean {
  return p.x < 0 || p.y < 0;
}

export function missingPoint(dim: 2 | 3 = 2): Point {
  return dim === 3
    ? { x: MISSING_VALUE, y: MISSING_VALUE, z: MISSING_VALUE }
    : { x: MISSING_VALUE, y: MISSING_VALUE };
}
