// Generate compact geographic coordinates, never image or animation frames.
// Source: Natural Earth 1:110m land polygons (public domain).
// node scripts/generate-globe-land.mjs /path/to/ne_110m_land.geojson
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = JSON.parse(readFileSync(process.argv[2], "utf8"));
const polygons = source.features.flatMap(({ geometry }) => {
  const groups = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return groups.map((rings) => {
    const outer = rings[0];
    return { rings, minX: Math.min(...outer.map(p => p[0])), maxX: Math.max(...outer.map(p => p[0])),
      minY: Math.min(...outer.map(p => p[1])), maxY: Math.max(...outer.map(p => p[1])) };
  });
});

function insideRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const coordinates = [];
const samples = 52_000;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
for (let i = 0; i < samples; i++) {
  // Fibonacci sampling keeps the density uniform at every latitude.
  const lat = Math.asin(1 - 2 * (i + 0.5) / samples) * 180 / Math.PI;
  const lon = ((i * goldenAngle * 180 / Math.PI + 180) % 360) - 180;
  const land = polygons.some(p => lon >= p.minX && lon <= p.maxX && lat >= p.minY && lat <= p.maxY
    && insideRing(lon, lat, p.rings[0]) && !p.rings.slice(1).some(hole => insideRing(lon, lat, hole)));
  if (land) coordinates.push([Math.round(lon * 100), Math.round(lat * 100)]);
}

// CSG1, uint32 count, then little-endian int16 lon/lat in hundredths of a degree.
const data = Buffer.alloc(8 + coordinates.length * 4);
data.write("CSG1", 0);
data.writeUInt32LE(coordinates.length, 4);
coordinates.forEach(([lon, lat], index) => {
  data.writeInt16LE(lon, 8 + index * 4);
  data.writeInt16LE(lat, 10 + index * 4);
});
const target = fileURLToPath(new URL("../public/globe-land.bin", import.meta.url));
writeFileSync(target, data);
console.log(`Generated ${coordinates.length} land coordinates (${data.length} bytes): ${target}`);
