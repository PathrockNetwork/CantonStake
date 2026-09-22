import { makeArc, occluded, onSphere, pointAlong, rotate, rotation, type Rotation, type Vec3 } from "./globe-geometry";

const SIZE = 620, CX = 310, CY = 286, RADIUS = 240, TAU = Math.PI * 2;
// City coordinates anchor every beacon and route to the rotating geography.
const CITIES = [
  [-74.0, 40.7], [-122.4, 37.8], [-79.4, 43.7], [-99.1, 19.4],
  [-46.6, -23.5], [-58.4, -34.6], [-0.1, 51.5], [2.3, 48.9],
  [8.7, 50.1], [3.4, 6.5], [18.4, -33.9], [36.8, -1.3],
  [55.3, 25.2], [72.8, 19.1], [103.8, 1.4], [139.7, 35.7],
  [151.2, -33.9], [106.8, -6.2], [126.9, 37.6],
].map(([lon, lat]) => onSphere(lon, lat));
const CONNECTIONS = [
  [0, 6], [0, 1], [0, 4], [0, 9], [1, 15], [1, 14],
  [1, 16], [2, 8], [6, 12], [6, 10], [6, 14], [9, 11],
  [9, 4], [11, 13], [8, 15], [12, 14], [15, 16], [4, 10],
  [16, 14], [7, 4], [5, 11], [3, 0], [14, 17], [15, 18],
];
const CROSSHAIRS = [[82, 77], [51, 247], [79, 493], [439, 21], [568, 360], [592, 420], [559, 515]];

function smooth(from: number, to: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function makeGrid(): Float32Array[] {
  const lines: Float32Array[] = [];
  for (const lat of [-60, -30, 0, 30, 60]) {
    const points = new Float32Array(121 * 3);
    for (let i = 0; i <= 120; i++) points.set(onSphere(-180 + i * 3, lat), i * 3);
    lines.push(points);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const points = new Float32Array(61 * 3);
    for (let i = 0; i <= 60; i++) points.set(onSphere(lon, -90 + i * 3), i * 3);
    lines.push(points);
  }
  return lines;
}

export interface GlobeRenderer {
  resize: (width: number, pixelRatio: number) => void;
  setLand: (points: Float32Array) => void;
  start: () => void;
  stop: () => void;
  dispose: () => void;
}

/** Native Canvas drawing and 3D projection. No textures, images, video or libraries. */
export function createGlobeRenderer(canvas: HTMLCanvasElement): GlobeRenderer | null {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return null;
  const ctx = context;
  let land: Float32Array = new Float32Array(0);
  let width = SIZE, frame = 0, elapsed = 0, lastTime = 0;
  let running = false, disposed = false;
  const grid = makeGrid();
  const routes = CONNECTIONS.map(([from, to], index) => ({
    points: makeArc(CITIES[from], CITIES[to], 0.12 + (index % 5) * 0.028),
    phase: (index * 0.173 + 0.3) % 1, period: 10 + (index % 5) * 1.4,
  }));

  // A glow is drawn once into a small offscreen canvas, entirely from math.
  const glow = document.createElement("canvas");
  glow.width = glow.height = 64;
  const glowContext = glow.getContext("2d");
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(173,255,216,0.85)");
    gradient.addColorStop(0.13, "rgba(55,255,179,0.4)");
    gradient.addColorStop(0.4, "rgba(0,233,154,0.12)");
    gradient.addColorStop(1, "rgba(0,233,154,0)");
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 64, 64);
  }

  function beacon(p: Vec3, size: number, opacity: number, core: number) {
    const x = CX + p[0] * RADIUS, y = CY - p[1] * RADIUS;
    ctx.globalAlpha = opacity;
    ctx.drawImage(glow, x - size, y - size, size * 2, size * 2);
    ctx.beginPath();
    ctx.arc(x, y, core, 0, TAU);
    ctx.fillStyle = "#b7ffe0";
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function strokeLine(points: Float32Array, m: Rotation, fraction: number, back: boolean) {
    const end = Math.floor((points.length / 3 - 1) * fraction) * 3;
    let pen = false;
    ctx.beginPath();
    for (let i = 0; i <= end; i += 3) {
      const p = rotate(m, [points[i], points[i + 1], points[i + 2]]);
      if (occluded(p) !== back) { pen = false; continue; }
      const x = CX + p[0] * RADIUS, y = CY - p[1] * RADIUS;
      if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }

  function drawLand(m: Rotation) {
    const paths = Array.from({ length: 7 }, () => new Path2D());
    const stride = width < 480 ? 6 : 3;
    for (let i = 0; i < land.length; i += stride) {
      const x = land[i], y = land[i + 1], z = land[i + 2];
      const depth = m[6]*x + m[7]*y + m[8]*z;
      if (depth < 0) continue;
      const bucket = Math.min(6, Math.floor(depth * 7));
      const px = CX + (m[0]*x + m[1]*y + m[2]*z) * RADIUS;
      const py = CY - (m[3]*x + m[4]*y + m[5]*z) * RADIUS;
      const radius = 0.44 + bucket * 0.035;
      // Subpixel squares read as particles without tessellating thousands of circles.
      paths[bucket].rect(px - radius, py - radius, radius * 2, radius * 2);
    }
    for (let i = 0; i < paths.length; i++) {
      ctx.fillStyle = `rgba(0,218,155,${0.24 + i * 0.085})`;
      ctx.fill(paths[i]);
    }
  }

  function draw() {
    if (disposed) return;
    const scale = canvas.width / SIZE;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.lineCap = "round";
    const m = rotation(0.49 + elapsed * 0.12, 0.29 + Math.sin(elapsed * 0.13) * 0.025, -0.035);

    ctx.strokeStyle = "rgba(0,192,139,0.3)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (const [x, y] of CROSSHAIRS) {
      ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
    }
    ctx.stroke();
    const atmosphere = ctx.createRadialGradient(CX - 80, CY - 80, 20, CX, CY, RADIUS + 22);
    atmosphere.addColorStop(0, "rgba(0,61,41,0.08)");
    atmosphere.addColorStop(0.84, "rgba(0,48,33,0.035)");
    atmosphere.addColorStop(0.92, "rgba(0,106,72,0.06)");
    atmosphere.addColorStop(1, "rgba(0,65,43,0)");
    ctx.fillStyle = atmosphere;
    ctx.fillRect(CX - RADIUS - 22, CY - RADIUS - 22, 2 * (RADIUS + 22), 2 * (RADIUS + 22));

    ctx.strokeStyle = "rgba(0,160,121,0.18)";
    ctx.lineWidth = 0.6;
    ctx.setLineDash([0.7, 4]);
    for (const line of grid) strokeLine(line, m, 1, false);
    ctx.beginPath(); ctx.arc(CX, CY, RADIUS, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    drawLand(m);

    routes.forEach((route, index) => {
      const cycle = (elapsed / route.period + route.phase) % 1;
      const reveal = smooth(0, 0.2, cycle), fade = 1 - smooth(0.79, 1, cycle);
      if (reveal < 0.01 || fade < 0.01) return;
      ctx.lineWidth = 0.72;
      ctx.strokeStyle = `rgba(90,246,186,${0.055 * fade})`;
      strokeLine(route.points, m, reveal, true);
      ctx.strokeStyle = `rgba(130,255,210,${0.42 * fade})`;
      strokeLine(route.points, m, reveal, false);

      // Each packet travels along the actual elevated 3D curve.
      const head = (elapsed * (0.12 + (index % 3) * 0.013) + route.phase) % 1;
      if (head > reveal) return;
      const p = rotate(m, pointAlong(route.points, head));
      if (occluded(p)) return;
      for (let tail = 0; tail < 7; tail++) {
        const a = head - (7 - tail) * 0.008, b = a + 0.008;
        if (a < 0) continue;
        const start = rotate(m, pointAlong(route.points, a)), end = rotate(m, pointAlong(route.points, b));
        if (occluded(start) || occluded(end)) continue;
        ctx.strokeStyle = `rgba(114,255,207,${fade * (tail + 1) * 0.09})`;
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.moveTo(CX + start[0] * RADIUS, CY - start[1] * RADIUS);
        ctx.lineTo(CX + end[0] * RADIUS, CY - end[1] * RADIUS);
        ctx.stroke();
      }
      beacon(p, 10, fade * 0.9, 1.35);
    });

    CITIES.forEach((city, index) => {
      const p = rotate(m, city);
      if (p[2] < 0.03) return;
      const pulse = (elapsed * 0.33 + index * 0.19) % 1;
      const intensity = 0.45 + 0.5 * p[2];
      beacon(p, 16 + 3 * Math.sin(elapsed * 1.6 + index), intensity, 1.8);
      ctx.strokeStyle = `rgba(67,255,187,${(1 - pulse) * 0.32 * intensity})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(CX + p[0] * RADIUS, CY - p[1] * RADIUS, 3 + pulse * 9, 0, TAU);
      ctx.stroke();
    });
  }

  function tick(now: number) {
    if (!running || disposed) return;
    frame = requestAnimationFrame(tick);
    const interval = width < 480 ? 1000 / 30 : 1000 / 60;
    if (lastTime && now - lastTime < interval - 0.5) return;
    if (lastTime) elapsed += Math.min(now - lastTime, 100) / 1000;
    lastTime = now;
    draw();
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  return {
    resize(cssWidth, pixelRatio) {
      if (disposed || cssWidth <= 0) return;
      width = cssWidth;
      const pixels = Math.round(cssWidth * Math.min(2, pixelRatio));
      if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
      draw();
    },
    setLand(points) { if (!disposed) { land = points; draw(); } },
    start() { if (!running && !disposed) { running = true; lastTime = 0; frame = requestAnimationFrame(tick); } },
    stop,
    dispose() { stop(); disposed = true; land = new Float32Array(0); },
  };
}
