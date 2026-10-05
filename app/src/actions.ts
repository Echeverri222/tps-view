import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import {
  basename,
  buildFromImages,
  dirname,
  emptySpecimen,
  findByName,
  imageFieldFor,
  isImageFile,
  joinPath,
  parseTps,
  toCsv,
  writeTps,
  type TpsFile,
} from "@tps-view/core";
import { backend } from "./backend";
import { useStore } from "./store";

const TPS_FILTER = [{ name: "TPS files", extensions: ["tps", "TPS", "txt"] }];
const IMAGE_FILTER = [{ name: "Images", extensions: ["jpg", "jpeg", "JPG", "JPEG", "png", "PNG", "tif", "tiff", "TIF", "TIFF", "bmp", "BMP", "gif", "webp", "heic"] }];

const st = () => useStore.getState();

async function fail(title: string, err: unknown) {
  await message(String(err instanceof Error ? err.message : err), { title, kind: "error" });
}

/** Returns true if it's OK to throw away the current document. */
export async function confirmDiscard(): Promise<boolean> {
  if (!st().dirty) return true;
  return ask("You have unsaved changes. Discard them?", { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });
}

function defaultDir(): string | undefined {
  const p = st().path;
  return p ? dirname(p) : undefined;
}

export async function openDialog() {
  if (!(await confirmDiscard())) return;
  const path = await open({ multiple: false, filters: TPS_FILTER, defaultPath: defaultDir() });
  if (typeof path === "string") await openPath(path, true);
}

export async function openPath(path: string, confirmed = false) {
  if (!confirmed && !(await confirmDiscard())) return;
  try {
    const text = await backend.readText(path);
    const { file, warnings } = parseTps(text);
    st().load(file, path, warnings);
    st().requestView("fit");
    if (warnings.length > 0) st().set({ modal: "issues" });
  } catch (e) {
    await fail("Couldn't open file", e);
  }
}

/** Absolute paths of the chosen image files, sorted by name. */
async function pickImages(title: string): Promise<string[]> {
  const res = await open({ multiple: true, filters: IMAGE_FILTER, title, defaultPath: defaultDir() });
  if (!res) return [];
  const list = Array.isArray(res) ? res : [res];
  return list.sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
}

/** New dataset with one specimen per image (like tpsUtil "build tps from images"). */
export async function newFromImages() {
  if (!(await confirmDiscard())) return;
  const paths = await pickImages("Choose the images for the new TPS file");
  if (paths.length === 0) return;
  st().load(buildFromImages(paths), null);
  st().requestView("fit");
}

/** Appends specimens for more images to the open file. */
export async function addImages() {
  if (!st().file) return newFromImages();
  const paths = await pickImages("Add images as new specimens");
  await addImagePaths(paths);
}

/** Appends one specimen per image path (also used for drag & drop). */
export async function addImagePaths(paths: string[]) {
  if (paths.length === 0) return;
  const { file, path } = st();
  if (!file) {
    if (!(await confirmDiscard())) return;
    st().load(buildFromImages(paths), null);
    st().requestView("fit");
    return;
  }
  const start = file.specimens.length;
  const added = paths.map((p, k) => emptySpecimen({ image: path ? imageFieldFor(p, path) : p, id: String(start + k) }));
  st().commit({ ...file, specimens: [...file.specimens, ...added] });
  added.forEach((s, k) => st().setImageInfo(s.image!, { status: "found", path: paths[k]! }));
  st().setCurrent(start);
}

/** Lets the user pick exactly which image file belongs to the current specimen. */
export async function chooseImageForCurrent() {
  const { file, current, path } = st();
  if (!file?.specimens[current]) return;
  const res = await open({ multiple: false, filters: IMAGE_FILTER, title: "Choose the image for this specimen", defaultPath: defaultDir() });
  if (typeof res !== "string") return;
  const field = path ? imageFieldFor(res, path) : res;
  st().setImageInfo(field, { status: "found", path: res });
  st().updateSpecimen(current, (s) => ({ ...s, image: field }));
  st().requestView("fit");
}

/** Looks for every missing image by file name inside a folder the user chooses. */
export async function relinkMissingImages() {
  const { file, images, path } = st();
  if (!file) return;
  const missing = file.specimens.map((s) => s.image).filter((f): f is string => !!f && images[f]?.status === "missing");
  if (missing.length === 0) {
    await message("All images were found.", { title: "Relink images" });
    return;
  }
  const dir = await open({ directory: true, title: `Choose the folder containing the ${missing.length} missing image(s)`, defaultPath: defaultDir() });
  if (typeof dir !== "string") return;
  const entries = (await backend.listDir(dir)).filter(isImageFile);
  const remap = new Map<string, string>();
  for (const field of new Set(missing)) {
    const hit = findByName(basename(field), entries);
    if (hit) remap.set(field, joinPath(dir, hit));
  }
  if (remap.size === 0) {
    await message("None of the missing images are in that folder.", { title: "Relink images", kind: "warning" });
    return;
  }
  const newField = (abs: string) => (path ? imageFieldFor(abs, path) : abs);
  st().commit({
    ...file,
    specimens: file.specimens.map((s) => (s.image && remap.has(s.image) ? { ...s, image: newField(remap.get(s.image)!) } : s)),
  });
  for (const abs of remap.values()) st().setImageInfo(newField(abs), { status: "found", path: abs });
  const left = new Set(missing).size - remap.size;
  await message(`Relinked ${remap.size} image(s).${left ? ` ${left} still missing.` : ""}`, { title: "Relink images" });
}

/**
 * Before writing to `target`, rewrite IMAGE= values that are absolute paths (or relative to a
 * different folder) so the dataset stays portable. Windows paths are left untouched unless the
 * file moves, to avoid surprising edits to existing datasets.
 */
function portableImages(file: TpsFile, target: string): TpsFile {
  const { images, path } = st();
  const moved = !path || dirname(path) !== dirname(target);
  return {
    ...file,
    specimens: file.specimens.map((s) => {
      const info = s.image ? images[s.image] : undefined;
      if (!s.image || info?.status !== "found" || !info.path) return s;
      if (!moved && !s.image.startsWith("/")) return s;
      return { ...s, image: imageFieldFor(info.path, target) };
    }),
  };
}

export async function saveFile(forceDialog = false): Promise<boolean> {
  const { file } = st();
  if (!file) return false;
  let target = st().path;
  if (forceDialog || !target) {
    const chosen = await save({ filters: TPS_FILTER, defaultPath: target ?? (defaultDir() ? joinPath(defaultDir()!, "landmarks.tps") : "landmarks.tps") });
    if (!chosen) return false;
    target = /\.tps$/i.test(chosen) ? chosen : `${chosen}.tps`;
  }
  try {
    const out = portableImages(file, target);
    await backend.writeText(target, writeTps(out));
    // Keep image resolutions valid for the rewritten fields.
    const { images } = st();
    out.specimens.forEach((s, i) => {
      const old = file.specimens[i]?.image;
      if (s.image && old && s.image !== old && images[old]) st().setImageInfo(s.image, images[old]!);
    });
    st().markSaved(out, target);
    return true;
  } catch (e) {
    await fail("Couldn't save file", e);
    return false;
  }
}

export async function exportCsv() {
  const { file, path } = st();
  if (!file) return;
  const scaled = await ask("Export coordinates multiplied by SCALE (real units)?\n\nChoose “Pixels” to export raw pixel coordinates.", {
    title: "Export CSV",
    okLabel: "Scaled units",
    cancelLabel: "Pixels",
  });
  const base = path ? basename(path).replace(/\.tps$/i, "") : "landmarks";
  const target = await save({ filters: [{ name: "CSV", extensions: ["csv"] }], defaultPath: joinPath(defaultDir() ?? "", `${base}${scaled ? "_scaled" : ""}.csv`) });
  if (!target) return;
  try {
    await backend.writeText(target, toCsv(file, { scaled }));
  } catch (e) {
    await fail("Couldn't export CSV", e);
  }
}

export async function deleteCurrentSpecimen() {
  const { file, current } = st();
  if (!file?.specimens[current]) return;
  const ok = await ask(`Delete specimen ${current + 1} from the file? (You can undo this.)`, { title: "Delete specimen", kind: "warning", okLabel: "Delete" });
  if (ok) st().deleteSpecimen(current);
}
