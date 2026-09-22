import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeLand, makeArc, occluded, onSphere, pointAlong, rotate, rotation } from "./globe-geometry";

const radius = (point: Iterable<number>) => Math.hypot(...point);

describe("procedural globe geometry", () => {
  it("keeps geographic points on the sphere through a full rotation", () => {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.1) {
      for (const [lon, lat] of [[-74, 40.7], [151.2, -33.9], [0, 90], [180, -90]]) {
        expect(radius(rotate(rotation(yaw, 0.29, -0.035), onSphere(lon, lat)))).toBeCloseTo(1, 10);
      }
    }
    expect(rotate(rotation(Math.PI / 2, 0), onSphere(0, 0))[0]).toBeCloseTo(1);
  });

  it("anchors routes at their cities and lifts the midpoint above the surface", () => {
    const from = onSphere(-74, 40.7), to = onSphere(139.7, 35.7);
    const arc = makeArc(from, to, 0.2);
    pointAlong(arc, 0).forEach((value, i) => expect(value).toBeCloseTo(from[i], 6));
    pointAlong(arc, 1).forEach((value, i) => expect(value).toBeCloseTo(to[i], 6));
    expect(radius(pointAlong(arc, 0.5))).toBeCloseTo(1.2, 6);
    for (let i = 0; i < arc.length; i += 3) expect(radius(arc.slice(i, i + 3))).toBeGreaterThanOrEqual(0.999999);
    expect(pointAlong(arc, -1)).toEqual(pointAlong(arc, 0));
    expect(pointAlong(arc, 2)).toEqual(pointAlong(arc, 1));
  });

  it("handles coincident and opposite endpoints without undefined coordinates", () => {
    for (const lon of [0, 180]) {
      const arc = makeArc(onSphere(0, 0), onSphere(lon, 0), 0.1);
      expect([...arc].every(Number.isFinite)).toBe(true);
      expect(radius(pointAlong(arc, 0.5))).toBeCloseTo(1.1, 6);
    }
  });

  it("hides back-side packets but leaves arcs beyond the limb visible", () => {
    expect(occluded([0.2, 0.2, -0.5])).toBe(true);
    expect(occluded([0.2, 0.2, 0.5])).toBe(false);
    expect(occluded([1.1, 0, -0.2])).toBe(false);
  });

  it("loads the shipped geography as unit vectors and rejects damaged data", () => {
    const bytes = readFileSync(new URL("../../public/globe-land.bin", import.meta.url));
    const data = Uint8Array.from(bytes).buffer;
    const points = decodeLand(data);
    expect(points.length / 3).toBeGreaterThan(10_000);
    for (let i = 0; i < points.length; i += 3) expect(radius(points.slice(i, i + 3))).toBeCloseTo(1, 6);
    expect(() => decodeLand(new ArrayBuffer(0))).toThrow();
    expect(() => decodeLand(data.slice(0, -1))).toThrow();
    const invalidCoordinate = data.slice(0);
    new DataView(invalidCoordinate).setInt16(10, 9001, true);
    expect(() => decodeLand(invalidCoordinate)).toThrow("Invalid globe coordinate");
    const invalidMagic = data.slice(0);
    new DataView(invalidMagic).setUint32(0, 0);
    expect(() => decodeLand(invalidMagic)).toThrow("Invalid globe geography");
  });
});
