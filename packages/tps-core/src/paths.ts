/**
 * Image path handling. IMAGE= values are often written on Windows ("C:\data\fish\img01.jpg",
 * "..\images\img01.jpg") and must still be found on macOS/Linux. These helpers are pure so the
 * app can check candidates with whatever filesystem API it has.
 */

const WIN_ABS_RE = /^[A-Za-z]:[\\/]/;

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("\\\\") || WIN_ABS_RE.test(p);
}

/** Last path component, accepting both separators. */
export function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

/** Directory of a POSIX path (the .tps file path on macOS). */
export function dirname(p: string): string {
  const i = p.replace(/\\/g, "/").lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return p.slice(0, i);
}

/** Joins and normalises "." / ".." segments; backslashes become slashes. */
export function joinPath(dir: string, rel: string): string {
  const combined = `${dir}/${rel}`.replace(/\\/g, "/");
  const absolute = combined.startsWith("/");
  const out: string[] = [];
  for (const seg of combined.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(seg);
  }
  return (absolute ? "/" : "") + out.join("/");
}

/**
 * Ordered, de-duplicated list of places to look for a specimen's image:
 *   1. the path as written (if it is a usable absolute POSIX path)
 *   2. relative to the .tps file's folder
 *   3. just the file name, next to the .tps file
 *   4. just the file name, in common sibling folders (images/, img/, photos/)
 */
export function imageCandidates(imageField: string, tpsPath: string): string[] {
  const field = imageField.trim();
  if (field === "") return [];
  const dir = dirname(tpsPath);
  const name = basename(field);
  const out: string[] = [];
  if (field.startsWith("/")) out.push(joinPath("/", field));
  if (!isAbsolutePath(field)) out.push(joinPath(dir, field));
  out.push(joinPath(dir, name));
  for (const sub of ["images", "Images", "img", "photos", "Photos"]) out.push(joinPath(dir, `${sub}/${name}`));
  out.push(joinPath(dir, `../${name}`));
  return [...new Set(out)];
}

/**
 * Value to store in IMAGE= for a chosen image. tpsDig stores just the file name when the image
 * sits next to the .tps file; otherwise we store a path relative to the .tps folder so the
 * dataset stays portable between machines.
 */
export function imageFieldFor(imagePath: string, tpsPath: string): string {
  const from = dirname(tpsPath).split("/").filter(Boolean);
  const to = imagePath.split("/").filter(Boolean);
  let k = 0;
  while (k < from.length && k < to.length - 1 && from[k] === to[k]) k++;
  if (k === 0 && from.length > 0) return imagePath; // nothing in common: keep absolute
  const ups = from.length - k;
  return [...Array<string>(ups).fill(".."), ...to.slice(k)].join("/");
}

const IMAGE_EXT_RE = /\.(jpe?g|png|tiff?|bmp|gif|webp|heic)$/i;

export function isImageFile(name: string): boolean {
  return IMAGE_EXT_RE.test(name);
}

/** Case-insensitive file-name match against a directory listing. */
export function findByName(name: string, entries: string[]): string | undefined {
  const lower = name.toLowerCase();
  return entries.find((e) => e === name) ?? entries.find((e) => e.toLowerCase() === lower);
}
