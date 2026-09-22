export type Vec3 = readonly [number, number, number];
export type Rotation = readonly [number, number, number, number, number, number, number, number, number];
const radians = Math.PI / 180;

export function onSphere(longitude: number, latitude: number): Vec3 {
  const lat = latitude * radians, lon = longitude * radians;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** A great-circle route lifted above the sphere, with endpoints on its surface. */
export function makeArc(from: Vec3, to: Vec3, height: number, segments = 80): Float32Array {
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const angle = Math.acos(dot);
  const tangent = dot < -0.9995
    ? normalize(Math.abs(from[1]) < 0.9 ? [-from[2], 0, from[0]] : [0, from[2], -from[1]])
    : null;
  const points = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let position: Vec3;
    if (i === 0) position = from;
    else if (i === segments) position = to;
    else if (dot > 0.9995) position = normalize([
      from[0] * (1 - t) + to[0] * t, from[1] * (1 - t) + to[1] * t, from[2] * (1 - t) + to[2] * t,
    ]);
    else if (tangent) position = [
      from[0] * Math.cos(Math.PI * t) + tangent[0] * Math.sin(Math.PI * t),
      from[1] * Math.cos(Math.PI * t) + tangent[1] * Math.sin(Math.PI * t),
      from[2] * Math.cos(Math.PI * t) + tangent[2] * Math.sin(Math.PI * t),
    ];
    else {
      const a = Math.sin((1 - t) * angle) / Math.sin(angle), b = Math.sin(t * angle) / Math.sin(angle);
      position = [from[0] * a + to[0] * b, from[1] * a + to[1] * b, from[2] * a + to[2] * b];
    }
    const lift = 1 + height * Math.sin(Math.PI * t);
    points.set(position.map(value => value * lift), i * 3);
  }
  return points;
}

export function rotation(yaw: number, tilt: number, roll = 0): Rotation {
  const a = Math.cos(yaw), b = Math.sin(yaw), c = Math.cos(tilt), d = Math.sin(tilt), e = Math.cos(roll), f = Math.sin(roll);
  return [e*a-f*d*b, -f*c, e*b+f*d*a, f*a+e*d*b, e*c, f*b-e*d*a, -c*b, d, c*a];
}

export function rotate(m: Rotation, p: Vec3): Vec3 {
  return [m[0]*p[0]+m[1]*p[1]+m[2]*p[2], m[3]*p[0]+m[4]*p[1]+m[5]*p[2], m[6]*p[0]+m[7]*p[1]+m[8]*p[2]];
}

/** Orthographic occlusion: a raised arc can remain visible beyond the limb. */
export function occluded(p: Vec3): boolean {
  return p[2] < 0 && p[0] * p[0] + p[1] * p[1] < 1;
}

export function pointAlong(points: Float32Array, fraction: number): Vec3 {
  const segment = Math.max(0, Math.min(1, fraction)) * (points.length / 3 - 1);
  const a = Math.floor(segment) * 3, b = Math.min(a + 3, points.length - 3), t = segment % 1;
  return [points[a] + (points[b] - points[a]) * t, points[a + 1] + (points[b + 1] - points[a + 1]) * t, points[a + 2] + (points[b + 2] - points[a + 2]) * t];
}

export function decodeLand(data: ArrayBuffer): Float32Array {
  const view = new DataView(data);
  if (data.byteLength < 8 || view.getUint32(0) !== 0x43534731) throw new Error("Invalid globe geography");
  const count = view.getUint32(4, true);
  if (count > 52_000 || data.byteLength !== 8 + count * 4) throw new Error("Incomplete globe geography");
  const points = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const lon = view.getInt16(8 + i * 4, true) / 100, lat = view.getInt16(10 + i * 4, true) / 100;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error("Invalid globe coordinate");
    points.set(onSphere(lon, lat), i * 3);
  }
  return points;
}
