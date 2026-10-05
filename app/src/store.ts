import { create } from "zustand";
import { missingPoint, type ParseWarning, type Point, type Specimen, type TpsFile } from "@tps-view/core";
import { resolveImagePath } from "./images";

export type Tool = "select" | "landmark" | "scale";
export type Modal = null | "scales" | "issues";

export interface ImageInfo {
  status: "pending" | "found" | "missing";
  path?: string;
}

export interface Adjustments {
  brightness: number;
  contrast: number;
  invert: boolean;
}

const HISTORY_LIMIT = 300;

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`tpsview.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`tpsview.${key}`, JSON.stringify(value));
  } catch {
    /* preferences are best-effort */
  }
}

interface State {
  file: TpsFile | null;
  path: string | null;
  dirty: boolean;
  warnings: ParseWarning[];
  current: number;
  selectedLm: number | null;
  tool: Tool;
  past: TpsFile[];
  future: TpsFile[];
  /** Resolution of IMAGE= values, keyed by the raw field. */
  images: Record<string, ImageInfo>;
  /** Scale reference points being placed with the scale tool (TPS coordinates). */
  scaleRef: Point[];
  cursor: Point | null;
  zoom: number;
  magnifier: boolean;
  unit: string;
  adjust: Adjustments;
  modal: Modal;
  /** Bumped to ask the canvas to fit/zoom; value is the requested action. */
  viewRequest: { kind: "fit" | "actual" | "in" | "out"; n: number };

  load(file: TpsFile, path: string | null, warnings?: ParseWarning[]): void;
  markSaved(file: TpsFile, path: string): void;
  setCurrent(i: number): void;
  setTool(t: Tool): void;
  selectLm(k: number | null): void;

  /** Records an undo step and replaces the file. */
  commit(file: TpsFile): void;
  updateSpecimen(i: number, fn: (s: Specimen) => Specimen): void;
  /** For drags: one undo step at the start, then silent updates. */
  beginGesture(): void;
  updateSpecimenSilently(i: number, fn: (s: Specimen) => Specimen): void;

  addLandmark(p: Point): void;
  deleteLandmark(k: number): void;
  setScale(indices: number[], scale: number | undefined): void;
  deleteSpecimen(i: number): void;
  undo(): void;
  redo(): void;

  resolveImages(): Promise<void>;
  setImageInfo(field: string, info: ImageInfo): void;

  set(patch: Partial<Pick<State, "scaleRef" | "cursor" | "zoom" | "magnifier" | "unit" | "adjust" | "modal">>): void;
  requestView(kind: State["viewRequest"]["kind"]): void;
}

const mapSpecimen = (file: TpsFile, i: number, fn: (s: Specimen) => Specimen): TpsFile => ({
  ...file,
  specimens: file.specimens.map((s, k) => (k === i ? fn(s) : s)),
});

export const useStore = create<State>((set, get) => ({
  file: null,
  path: null,
  dirty: false,
  warnings: [],
  current: 0,
  selectedLm: null,
  tool: "landmark",
  past: [],
  future: [],
  images: {},
  scaleRef: [],
  cursor: null,
  zoom: 1,
  magnifier: loadPref("magnifier", true),
  unit: loadPref("unit", "mm"),
  adjust: { brightness: 100, contrast: 100, invert: false },
  modal: null,
  viewRequest: { kind: "fit", n: 0 },

  load(file, path, warnings = []) {
    set({
      file,
      path,
      warnings,
      dirty: false,
      current: 0,
      selectedLm: null,
      past: [],
      future: [],
      images: {},
      scaleRef: [],
      modal: null,
    });
    void get().resolveImages();
  },

  markSaved(file, path) {
    const pathChanged = path !== get().path;
    set({ file, path, dirty: false, ...(pathChanged ? { images: {} } : {}) });
    if (pathChanged) void get().resolveImages();
  },

  setCurrent(i) {
    const n = get().file?.specimens.length ?? 0;
    if (n === 0) return;
    set({ current: Math.max(0, Math.min(n - 1, i)), selectedLm: null, scaleRef: [] });
  },

  setTool(tool) {
    set({ tool, scaleRef: [] });
  },

  selectLm(k) {
    set({ selectedLm: k });
  },

  commit(file) {
    const { file: prev, past } = get();
    if (!prev) return;
    set({ file, past: [...past, prev].slice(-HISTORY_LIMIT), future: [], dirty: true });
  },

  updateSpecimen(i, fn) {
    const { file } = get();
    if (file) get().commit(mapSpecimen(file, i, fn));
  },

  beginGesture() {
    const { file, past } = get();
    if (file) set({ past: [...past, file].slice(-HISTORY_LIMIT), future: [] });
  },

  updateSpecimenSilently(i, fn) {
    const { file } = get();
    if (file) set({ file: mapSpecimen(file, i, fn), dirty: true });
  },

  addLandmark(p) {
    const { current, selectedLm, file } = get();
    const s = file?.specimens[current];
    if (!s) return;
    // If a missing landmark is selected, the click places it; otherwise append.
    const target = selectedLm !== null && s.landmarks[selectedLm] && s.landmarks[selectedLm]!.x < 0 ? selectedLm : null;
    if (target !== null) {
      get().updateSpecimen(current, (sp) => ({ ...sp, landmarks: sp.landmarks.map((q, k) => (k === target ? p : q)) }));
      const next = s.landmarks.findIndex((q, k) => k > target && q.x < 0);
      set({ selectedLm: next >= 0 ? next : null });
    } else {
      get().updateSpecimen(current, (sp) => ({ ...sp, landmarks: [...sp.landmarks, p] }));
      set({ selectedLm: s.landmarks.length });
    }
  },

  deleteLandmark(k) {
    const { current } = get();
    get().updateSpecimen(current, (s) => ({ ...s, landmarks: s.landmarks.filter((_, j) => j !== k) }));
    set({ selectedLm: null });
  },

  setScale(indices, scale) {
    const { file } = get();
    if (!file) return;
    const which = new Set(indices);
    get().commit({
      ...file,
      specimens: file.specimens.map((s, i) => {
        if (!which.has(i)) return s;
        const next = { ...s };
        if (scale === undefined) delete next.scale;
        else next.scale = scale;
        return next;
      }),
    });
  },

  deleteSpecimen(i) {
    const { file, current } = get();
    if (!file) return;
    get().commit({ ...file, specimens: file.specimens.filter((_, k) => k !== i) });
    const n = file.specimens.length - 1;
    set({ current: Math.max(0, Math.min(current, n - 1)), selectedLm: null });
  },

  undo() {
    const { past, future, file } = get();
    const prev = past[past.length - 1];
    if (!prev || !file) return;
    set({ file: prev, past: past.slice(0, -1), future: [file, ...future], dirty: true, selectedLm: null });
    clampCurrent();
  },

  redo() {
    const { past, future, file } = get();
    const next = future[0];
    if (!next || !file) return;
    set({ file: next, past: [...past, file], future: future.slice(1), dirty: true, selectedLm: null });
    clampCurrent();
  },

  async resolveImages() {
    const { file, path } = get();
    if (!file) return;
    const fields = [...new Set(file.specimens.map((s) => s.image).filter((f): f is string => !!f))];
    const todo = fields.filter((f) => !get().images[f]);
    if (todo.length === 0) return;
    set({ images: { ...get().images, ...Object.fromEntries(todo.map((f) => [f, { status: "pending" } as ImageInfo])) } });
    // Resolve the current specimen first so the canvas shows something immediately.
    const cur = file.specimens[get().current]?.image;
    todo.sort((a, b) => (a === cur ? -1 : b === cur ? 1 : 0));
    for (const field of todo) {
      const resolved = await resolveImagePath(field, path).catch(() => null);
      if (get().path !== path) return; // another file was opened meanwhile
      get().setImageInfo(field, resolved ? { status: "found", path: resolved } : { status: "missing" });
    }
  },

  setImageInfo(field, info) {
    set({ images: { ...get().images, [field]: info } });
  },

  set(patch) {
    if (patch.magnifier !== undefined) savePref("magnifier", patch.magnifier);
    if (patch.unit !== undefined) savePref("unit", patch.unit);
    set(patch);
  },

  requestView(kind) {
    set({ viewRequest: { kind, n: get().viewRequest.n + 1 } });
  },
}));

function clampCurrent() {
  const { file, current } = useStore.getState();
  const n = file?.specimens.length ?? 0;
  if (current >= n) useStore.setState({ current: Math.max(0, n - 1) });
}

/** Convenience selectors. */
export const currentSpecimen = (s: State) => s.file?.specimens[s.current];

export function addMissingLandmark() {
  const st = useStore.getState();
  const s = currentSpecimen(st);
  if (!s) return;
  st.updateSpecimen(st.current, (sp) => ({ ...sp, landmarks: [...sp.landmarks, missingPoint(sp.dim)] }));
  useStore.setState({ selectedLm: s.landmarks.length });
}
