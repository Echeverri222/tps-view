import { basename, dirname, findByName, imageCandidates, isAbsolutePath, joinPath } from "@tps-view/core";
import { backend } from "./backend";

/**
 * Finds the file an IMAGE= value refers to. Tries the candidate list from tps-core, then a
 * case-insensitive name match in the .tps folder (Windows paths are case-insensitive).
 */
export async function resolveImagePath(field: string | undefined, tpsPath: string | null): Promise<string | null> {
  if (!field) return null;
  if (!tpsPath) {
    // Unsaved file built from images: fields are absolute paths.
    return isAbsolutePath(field) ? backend.firstExisting([field]) : null;
  }
  const hit = await backend.firstExisting(imageCandidates(field, tpsPath));
  if (hit) return hit;
  const dir = dirname(tpsPath);
  const match = findByName(basename(field), await backend.listDir(dir));
  return match ? joinPath(dir, match) : null;
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

interface CacheEntry {
  url: string;
  promise: Promise<HTMLImageElement>;
}

/** Small LRU of decoded images so flipping back and forth between specimens is instant. */
const cache = new Map<string, CacheEntry>();
const CACHE_SIZE = 6;

export function loadImage(path: string): Promise<HTMLImageElement> {
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    cache.set(path, hit);
    return hit.promise;
  }
  const entry: CacheEntry = { url: "", promise: Promise.resolve(null as unknown as HTMLImageElement) };
  entry.promise = (async () => {
    const bytes = await backend.readBytes(path);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    entry.url = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? "application/octet-stream" }));
    const img = new Image();
    img.src = entry.url;
    try {
      await img.decode();
    } catch {
      throw new Error(`Can't decode ${basename(path)} (unsupported image format?)`);
    }
    return img;
  })();
  entry.promise.catch(() => cache.delete(path));
  cache.set(path, entry);
  while (cache.size > CACHE_SIZE) {
    const [oldest, old] = cache.entries().next().value!;
    cache.delete(oldest);
    if (old.url) URL.revokeObjectURL(old.url);
  }
  return entry.promise;
}
