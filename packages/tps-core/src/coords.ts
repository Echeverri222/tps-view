import { isMissing, type Point } from "./model";

/**
 * TPS stores y with the origin at the bottom of the image; images/screens use the top.
 * Both conversions are the same reflection, kept as two names for readability at call sites.
 */
export function tpsToImage(p: Point, imageHeight: number): Point {
  if (isMissing(p)) return p;
  return { ...p, y: imageHeight - p.y };
}

export function imageToTps(p: Point, imageHeight: number): Point {
  return { ...p, y: imageHeight - p.y };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/**
 * Units per pixel, as stored in SCALE=, from a reference of known length.
 * e.g. clicking both ends of a 10 mm ruler segment that spans 2373 px gives 0.004214.
 */
export function scaleFromReference(a: Point, b: Point, knownLength: number): number {
  const px = distance(a, b);
  if (px === 0) throw new Error("Reference points are identical");
  if (!(knownLength > 0)) throw new Error("Known length must be positive");
  return knownLength / px;
}

/**
 * tpsDig stores landmarks as whole pixels ("1997.00000"), so digitized points are rounded
 * the same way to keep files looking and behaving like tpsDig output.
 */
export function roundCoord(v: number): number {
  return Math.round(v);
}

/**
 * tpsDig writes SCALE with 6 decimal places ("SCALE=0.024969"). Very small scales (< 0.001,
 * e.g. µm-per-pixel microscopy in mm) keep 6 significant digits instead so they don't collapse.
 */
export function roundScale(v: number): number {
  return v >= 0.001 ? Number(v.toFixed(6)) : Number(v.toPrecision(6));
}
