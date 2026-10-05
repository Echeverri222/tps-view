import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildFromImages,
  findByName,
  imageCandidates,
  imageFieldFor,
  imageToTps,
  roundCoord,
  roundScale,
  isMissing,
  parseTps,
  resampleCurve,
  scaleFromReference,
  toCsv,
  tpsToImage,
  validate,
  writeTps,
} from "../src";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), "utf8");

describe("parseTps", () => {
  it("reads a tpsDig2 file written on Windows", () => {
    const { file, warnings } = parseTps(fixture("tpsdig-windows.tps"));
    expect(warnings).toEqual([]);
    expect(file.lineEnding).toBe("\r\n");
    expect(file.specimens).toHaveLength(2);
    const [a, b] = file.specimens;
    expect(a!.landmarks).toEqual([
      { x: 1023, y: 1544 },
      { x: 1210.5, y: 1498.25 },
      { x: -1, y: -1 },
    ]);
    expect(isMissing(a!.landmarks[2]!)).toBe(true);
    expect(a!.curves[0]!.points).toHaveLength(4);
    expect(a!.image).toBe("C:\\Users\\lab\\fish\\fish_001.JPG");
    expect(a!.id).toBe("0");
    expect(a!.scale).toBeCloseTo(0.004213);
    expect(b!.scale).toBeUndefined();
    expect(b!.comment).toBe("dorsal fin damaged");
  });

  it("tolerates lowercase keywords, decimal commas, blank lines, outlines, variables, extras, 3D", () => {
    const { file, warnings } = parseTps(fixture("messy.tps"));
    expect(warnings).toEqual([]);
    const [a, b] = file.specimens;
    expect(a!.landmarks).toEqual([
      { x: 12.5, y: 30.25 },
      { x: 40, y: 50 },
    ]);
    expect(a!.image).toBe("..\\photos\\a b.tif");
    expect(a!.id).toBe("specimen A");
    expect(a!.outlines[0]!.points).toHaveLength(3);
    expect(a!.variables).toEqual([3.5, 7]);
    expect(a!.extra).toEqual([{ key: "CUSTOMKEY", value: "hello" }]);
    expect(b!.dim).toBe(3);
    expect(b!.landmarks[0]).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("warns instead of throwing on truncated data", () => {
    const { file, warnings } = parseTps("LM=3\n1 2\n3 4\nIMAGE=x.jpg\n");
    expect(file.specimens[0]!.landmarks).toHaveLength(2);
    expect(file.specimens[0]!.image).toBe("x.jpg");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/expected 3 points/);
  });
});

describe("writeTps", () => {
  it("round-trips every fixture without changing the data", () => {
    for (const name of ["tpsdig-windows.tps", "messy.tps"]) {
      const first = parseTps(fixture(name)).file;
      const again = parseTps(writeTps(first)).file;
      expect(again).toEqual(first);
    }
  });

  it("writes tpsDig layout with CRLF and 5 decimals", () => {
    const text = writeTps(parseTps(fixture("tpsdig-windows.tps")).file);
    expect(text).toBe(fixture("tpsdig-windows.tps"));
  });

  it("never writes exponent notation for small scales", () => {
    const f = buildFromImages(["a.jpg"]);
    f.specimens[0]!.scale = 0.0000123;
    expect(writeTps(f)).toContain("SCALE=0.0000123");
  });
});

describe("coordinates and scale", () => {
  it("flips Y between TPS (bottom-left) and image (top-left) space", () => {
    expect(tpsToImage({ x: 10, y: 900 }, 1000)).toEqual({ x: 10, y: 100 });
    expect(imageToTps({ x: 10, y: 100 }, 1000)).toEqual({ x: 10, y: 900 });
    expect(tpsToImage({ x: -1, y: -1 }, 1000)).toEqual({ x: -1, y: -1 });
  });

  it("rounds like tpsDig: whole pixels, 6-decimal SCALE", () => {
    expect(roundCoord(1911.46)).toBe(1911);
    expect(roundScale(0.024435667)).toBe(0.024436);
    expect(roundScale(0.0000123456789)).toBe(0.0000123457);
    const f = buildFromImages(["a.png"]);
    f.specimens[0]!.scale = roundScale(0.024435667);
    f.specimens[0]!.landmarks = [{ x: roundCoord(1911.46), y: roundCoord(2376.62) }];
    expect(writeTps(f)).toBe("LM=1\r\n1911.00000 2377.00000\r\nIMAGE=a.png\r\nID=0\r\nSCALE=0.024436\r\n");
  });

  it("computes units per pixel from a reference", () => {
    expect(scaleFromReference({ x: 0, y: 0 }, { x: 300, y: 400 }, 10)).toBeCloseTo(0.02);
    expect(() => scaleFromReference({ x: 0, y: 0 }, { x: 0, y: 0 }, 10)).toThrow();
  });
});

describe("image paths", () => {
  it("finds Windows absolute paths by file name next to the .tps", () => {
    const c = imageCandidates("C:\\Users\\lab\\fish\\fish_001.JPG", "/Users/me/data/fish.tps");
    expect(c[0]).toBe("/Users/me/data/fish_001.JPG");
    expect(c).toContain("/Users/me/data/images/fish_001.JPG");
  });

  it("resolves Windows relative paths", () => {
    const c = imageCandidates("..\\photos\\a b.tif", "/Users/me/data/set.tps");
    expect(c[0]).toBe("/Users/me/photos/a b.tif");
  });

  it("stores portable IMAGE= values", () => {
    expect(imageFieldFor("/Users/me/data/a.jpg", "/Users/me/data/x.tps")).toBe("a.jpg");
    expect(imageFieldFor("/Users/me/data/img/a.jpg", "/Users/me/data/x.tps")).toBe("img/a.jpg");
    expect(imageFieldFor("/Users/me/photos/a.jpg", "/Users/me/data/x.tps")).toBe("../photos/a.jpg");
  });

  it("matches file names case-insensitively", () => {
    expect(findByName("FISH_001.jpg", ["fish_001.JPG", "other.jpg"])).toBe("fish_001.JPG");
  });
});

describe("tools", () => {
  it("validates datasets", () => {
    const { file } = parseTps(fixture("tpsdig-windows.tps"));
    const kinds = validate(file).map((i) => `${i.specimen}:${i.kind}`);
    expect(kinds).toContain("0:missing-landmark");
    expect(kinds).toContain("1:no-scale");
  });

  it("resamples curves evenly", () => {
    const pts = resampleCurve([{ x: 0, y: 0 }, { x: 10, y: 0 }], 3);
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
  });

  it("exports scaled CSV", () => {
    const { file } = parseTps(fixture("tpsdig-windows.tps"));
    const lines = toCsv(file, { scaled: true }).trim().split("\n");
    expect(lines[0]).toBe("specimen,id,image,scale,X1,Y1,X2,Y2,X3,Y3");
    expect(lines[1]!.split(",")[4]).toBe(String(1023 * 0.004213));
    expect(lines[1]!.endsWith(",,")).toBe(true);
  });
});
