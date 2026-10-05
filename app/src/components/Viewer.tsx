import { useCallback, useEffect, useRef, useState } from "react";
import { isMissing, roundCoord, type Point } from "@tps-view/core";
import { chooseImageForCurrent, relinkMissingImages } from "../actions";
import { loadImage } from "../images";
import { currentSpecimen, useStore } from "../store";
import { ScalePopover } from "./ScalePopover";

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

type Drag =
  | { kind: "pan"; x: number; y: number; ox: number; oy: number }
  | { kind: "lm"; k: number }
  | null;

const HIT_RADIUS = 9;
const LOUPE_SIZE = 180;
const COLORS = {
  lm: "#ff453a",
  lmSelected: "#ffd60a",
  curve: "#40c8ff",
  outline: "#30d158",
  scale: "#bf5af2",
};

export function Viewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 1, ox: 0, oy: 0 });
  const size = useRef({ w: 0, h: 0 });
  const mouse = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<Drag>(null);
  const space = useRef(false);
  const frame = useRef(0);

  const specimen = useStore(currentSpecimen);
  const field = specimen?.image;
  const info = useStore((s) => (field ? s.images[field] : undefined));
  const adjust = useStore((s) => s.adjust);
  const tool = useStore((s) => s.tool);
  const viewRequest = useStore((s) => s.viewRequest);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  imgRef.current = img;

  // ---- coordinate transforms (TPS space has y up from the image bottom) ----
  const toScreen = useCallback((p: Point) => {
    const v = view.current;
    const h = imgRef.current?.naturalHeight ?? 0;
    return { x: v.ox + p.x * v.zoom, y: v.oy + (h - p.y) * v.zoom };
  }, []);
  const toTps = useCallback((sx: number, sy: number): Point => {
    const v = view.current;
    const h = imgRef.current?.naturalHeight ?? 0;
    return { x: (sx - v.ox) / v.zoom, y: h - (sy - v.oy) / v.zoom };
  }, []);
  const insideImage = (p: Point) => {
    const im = imgRef.current;
    return !!im && p.x >= 0 && p.y >= 0 && p.x <= im.naturalWidth && p.y <= im.naturalHeight;
  };

  // ---- drawing ----
  const draw = useCallback(() => {
    frame.current = 0;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size.current;
    const ic = imageCanvas.current?.getContext("2d");
    const oc = overlay.current?.getContext("2d");
    if (!ic || !oc) return;
    const im = imgRef.current;
    const v = view.current;

    ic.setTransform(1, 0, 0, 1, 0, 0);
    ic.clearRect(0, 0, w * dpr, h * dpr);
    if (im) {
      ic.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.ox, dpr * v.oy);
      ic.imageSmoothingEnabled = v.zoom < 3;
      ic.imageSmoothingQuality = "high";
      ic.drawImage(im, 0, 0);
    }

    oc.setTransform(dpr, 0, 0, dpr, 0, 0);
    oc.clearRect(0, 0, w, h);
    if (!im) return;
    const st = useStore.getState();
    const s = currentSpecimen(st);
    if (!s) return;

    const drawMarks = (ctx: CanvasRenderingContext2D, map: (p: Point) => { x: number; y: number }, labels: boolean) => {
      ctx.lineWidth = 1.5;
      for (const c of s.curves) polyline(ctx, c.points.map(map), COLORS.curve, false);
      for (const o of s.outlines) polyline(ctx, o.points.map(map), COLORS.outline, true);
      s.landmarks.forEach((p, k) => {
        if (isMissing(p)) return;
        const q = map(p);
        const sel = k === st.selectedLm;
        ctx.beginPath();
        ctx.arc(q.x, q.y, sel ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = sel ? COLORS.lmSelected : COLORS.lm;
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (labels) {
          ctx.font = "600 12px -apple-system, system-ui, sans-serif";
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(0,0,0,0.75)";
          ctx.strokeText(String(k + 1), q.x + 8, q.y - 8);
          ctx.fillStyle = sel ? COLORS.lmSelected : "white";
          ctx.fillText(String(k + 1), q.x + 8, q.y - 8);
        }
      });
      if (st.tool === "scale" && st.scaleRef.length > 0) {
        const pts = st.scaleRef.map(map);
        ctx.strokeStyle = COLORS.scale;
        ctx.lineWidth = 2;
        if (pts.length === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          ctx.lineTo(pts[1]!.x, pts[1]!.y);
          ctx.stroke();
        }
        for (const q of pts) crosshair(ctx, q.x, q.y, 9, COLORS.scale);
      }
    };

    drawMarks(oc, toScreen, true);

    // Magnifier loupe next to the cursor.
    const m = mouse.current;
    if (st.magnifier && m && !(drag.current?.kind === "pan")) {
      const p = toTps(m.x, m.y);
      if (insideImage(p)) {
        const lz = Math.min(Math.max(v.zoom * 4, 1), 40);
        let lx = m.x + 24;
        let ly = m.y - LOUPE_SIZE - 24;
        if (lx + LOUPE_SIZE > w) lx = m.x - LOUPE_SIZE - 24;
        if (ly < 0) ly = m.y + 24;
        const ix = p.x;
        const iy = im.naturalHeight - p.y;
        const src = LOUPE_SIZE / lz;
        oc.save();
        oc.beginPath();
        oc.arc(lx + LOUPE_SIZE / 2, ly + LOUPE_SIZE / 2, LOUPE_SIZE / 2, 0, Math.PI * 2);
        oc.clip();
        oc.fillStyle = "#111";
        oc.fillRect(lx, ly, LOUPE_SIZE, LOUPE_SIZE);
        oc.imageSmoothingEnabled = lz < 4;
        oc.filter = cssFilter(st.adjust);
        oc.drawImage(im, ix - src / 2, iy - src / 2, src, src, lx, ly, LOUPE_SIZE, LOUPE_SIZE);
        oc.filter = "none";
        const loupeMap = (q: Point) => ({
          x: lx + LOUPE_SIZE / 2 + (q.x - ix) * lz,
          y: ly + LOUPE_SIZE / 2 + (im.naturalHeight - q.y - iy) * lz,
        });
        drawMarks(oc, loupeMap, false);
        crosshair(oc, lx + LOUPE_SIZE / 2, ly + LOUPE_SIZE / 2, 14, "rgba(255,255,255,0.9)", 1);
        oc.restore();
        oc.beginPath();
        oc.arc(lx + LOUPE_SIZE / 2, ly + LOUPE_SIZE / 2, LOUPE_SIZE / 2, 0, Math.PI * 2);
        oc.strokeStyle = "rgba(255,255,255,0.85)";
        oc.lineWidth = 2;
        oc.stroke();
      }
    }
  }, [toScreen, toTps]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  const publishZoom = () => useStore.getState().set({ zoom: view.current.zoom });

  const fit = useCallback(() => {
    const im = imgRef.current;
    const { w, h } = size.current;
    if (!im || !w || !h) return;
    const zoom = Math.min(w / im.naturalWidth, h / im.naturalHeight) * 0.96;
    view.current = { zoom, ox: (w - im.naturalWidth * zoom) / 2, oy: (h - im.naturalHeight * zoom) / 2 };
    publishZoom();
    schedule();
  }, [schedule]);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      const v = view.current;
      const zoom = Math.min(Math.max(v.zoom * factor, 0.01), 64);
      const f = zoom / v.zoom;
      view.current = { zoom, ox: sx - (sx - v.ox) * f, oy: sy - (sy - v.oy) * f };
      publishZoom();
      schedule();
    },
    [schedule],
  );

  // ---- load the current specimen's image ----
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (info?.status !== "found" || !info.path) {
      setImg(null);
      return;
    }
    loadImage(info.path).then(
      (im) => {
        if (cancelled) return;
        imgRef.current = im;
        setImg(im);
        fit();
      },
      (e) => {
        if (cancelled) return;
        setImg(null);
        setError(String(e instanceof Error ? e.message : e));
      },
    );
    // Preload the next specimen so "next" feels instant.
    const st = useStore.getState();
    const nextField = st.file?.specimens[st.current + 1]?.image;
    const next = nextField ? st.images[nextField] : undefined;
    if (next?.path) loadImage(next.path).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [info?.status, info?.path, fit]);

  // ---- canvas sizing ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = size.current.w === 0;
      size.current = { w: r.width, h: r.height };
      for (const c of [imageCanvas.current, overlay.current]) {
        if (!c) continue;
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
      }
      if (first) fit();
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw, fit]);

  // Redraw on any store change (landmarks, selection, tool, magnifier...).
  useEffect(() => useStore.subscribe(schedule), [schedule]);

  // Toolbar / menu view requests.
  useEffect(() => {
    if (viewRequest.n === 0) return;
    const { w, h } = size.current;
    if (viewRequest.kind === "fit") fit();
    else if (viewRequest.kind === "in") zoomAt(1.25, w / 2, h / 2);
    else if (viewRequest.kind === "out") zoomAt(0.8, w / 2, h / 2);
    else if (viewRequest.kind === "actual") zoomAt(1 / view.current.zoom, w / 2, h / 2);
  }, [viewRequest, fit, zoomAt]);

  // Wheel: pinch / ⌘-scroll zooms, two-finger scroll pans. Needs a non-passive listener.
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
      } else {
        view.current = { ...view.current, ox: view.current.ox - e.deltaX, oy: view.current.oy - e.deltaY };
        schedule();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, schedule]);

  // Space bar = temporary pan.
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) {
        space.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---- pointer interaction ----
  const local = (e: React.PointerEvent) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTest = (x: number, y: number): number | null => {
    const s = currentSpecimen(useStore.getState());
    if (!s) return null;
    let best: number | null = null;
    let bestD = HIT_RADIUS;
    s.landmarks.forEach((p, k) => {
      if (isMissing(p)) return;
      const q = toScreen(p);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!imgRef.current) return;
    const { x, y } = local(e);
    overlay.current!.setPointerCapture(e.pointerId);
    const st = useStore.getState();
    const startPan = () => {
      drag.current = { kind: "pan", x, y, ox: view.current.ox, oy: view.current.oy };
    };
    if (e.button === 1 || e.button === 2 || space.current) return startPan();
    const hit = st.tool === "scale" ? null : hitTest(x, y);
    if (hit !== null) {
      st.selectLm(hit);
      st.beginGesture();
      drag.current = { kind: "lm", k: hit };
      return;
    }
    const p = toTps(x, y);
    if (st.tool === "landmark") {
      if (insideImage(p)) st.addLandmark({ x: roundCoord(p.x), y: roundCoord(p.y) });
    } else if (st.tool === "scale") {
      if (insideImage(p)) {
        const ref = st.scaleRef.length >= 2 ? [] : st.scaleRef;
        st.set({ scaleRef: [...ref, p] });
      }
    } else {
      st.selectLm(null);
      startPan();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    mouse.current = { x, y };
    const st = useStore.getState();
    const d = drag.current;
    const p = toTps(x, y);
    if (d?.kind === "pan") {
      view.current = { ...view.current, ox: d.ox + (x - d.x), oy: d.oy + (y - d.y) };
    } else if (d?.kind === "lm" && imgRef.current) {
      const im = imgRef.current;
      const q = { x: roundCoord(Math.min(Math.max(p.x, 0), im.naturalWidth)), y: roundCoord(Math.min(Math.max(p.y, 0), im.naturalHeight)) };
      st.updateSpecimenSilently(st.current, (s) => ({ ...s, landmarks: s.landmarks.map((o, k) => (k === d.k ? { ...o, ...q } : o)) }));
    }
    st.set({ cursor: imgRef.current && insideImage(p) ? p : null });
    schedule();
  };

  const onPointerUp = () => {
    drag.current = null;
    schedule();
  };

  const onPointerLeave = () => {
    mouse.current = null;
    useStore.getState().set({ cursor: null });
    schedule();
  };

  const cursor = tool === "select" ? "grab" : "crosshair";
  const placeholder = !specimen
    ? null
    : !field
      ? { title: "This specimen has no image", detail: "Choose which image file belongs to it." }
      : info?.status === "missing"
        ? { title: "Image not found", detail: field }
        : error
          ? { title: "Can't show this image", detail: error }
          : info?.status === "pending" || !img
            ? { title: "Loading image…", detail: "", loading: true }
            : null;

  return (
    <div className="viewer" ref={containerRef}>
      <canvas ref={imageCanvas} className="layer" style={{ filter: cssFilter(adjust) }} />
      <canvas
        ref={overlay}
        className="layer"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      {placeholder && (
        <div className="viewer-message">
          <h3>{placeholder.title}</h3>
          {placeholder.detail && <code>{placeholder.detail}</code>}
          {!("loading" in placeholder) && (
            <div className="row">
              <button className="primary" onClick={chooseImageForCurrent}>
                Choose image…
              </button>
              {info?.status === "missing" && <button onClick={relinkMissingImages}>Find missing images in folder…</button>}
            </div>
          )}
        </div>
      )}
      {tool === "scale" && img && <ScalePopover />}
    </div>
  );
}

export function cssFilter(a: { brightness: number; contrast: number; invert: boolean }) {
  if (a.brightness === 100 && a.contrast === 100 && !a.invert) return "none";
  return `brightness(${a.brightness}%) contrast(${a.contrast}%)${a.invert ? " invert(1)" : ""}`;
}

function polyline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string, closed: boolean) {
  const vis = pts.filter((p) => Number.isFinite(p.x));
  if (vis.length === 0) return;
  ctx.strokeStyle = color;
  ctx.beginPath();
  vis.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = color;
  for (const p of vis) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function crosshair(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}
