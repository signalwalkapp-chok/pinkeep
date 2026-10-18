// ระยะ ทิศ และพื้นที่ — แปลงจาก geo/Geo.kt ของแอป Android ให้ผลตรงกัน
const R = 6371000;
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

export const DEFAULT_PIN_ACCURACY = 5.0;

/** ระยะทางบนผิวโลก (haversine) หน่วยเมตร */
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** ทิศจาก a ไป b เทียบทิศเหนือจริง 0–360° */
export function bearingDegrees(a, b) {
  const lat1 = rad(a.lat), lat2 = rad(b.lat), dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** มุมที่ต้องหัน −180..180 (บวก = หันขวา) */
export function relativeTurn(heading, bearing) {
  let t = (bearing - heading) % 360;
  if (t > 180) t -= 360;
  if (t < -180) t += 360;
  return t;
}

/** พื้นที่รูปหลายเหลี่ยม (ตร.ม.) — ฉายลงระนาบรอบจุดกึ่งกลางแล้วใช้ shoelace */
export function polygonAreaSqMeters(points) {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const mLat = 110540, mLon = 111320 * Math.cos(rad(lat0));
  const xy = points.map((p) => [(p.lon - lon0) * mLon, (p.lat - lat0) * mLat]);
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** เรียงหมุดรอบแปลงตามมุมจากจุดกึ่งกลาง เริ่มทิศเหนือ วนตามเข็ม — คืนลำดับ index */
export function orderAround(points) {
  const idx = points.map((_, i) => i);
  if (points.length < 3) return idx;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const k = Math.cos(rad(lat0));
  const angle = (p) => (deg(Math.atan2((p.lon - lon0) * k, p.lat - lat0)) + 360) % 360;
  return idx.sort((i, j) => angle(points[i]) - angle(points[j]));
}

/** เส้นเขตตัดกันเอง */
export function selfIntersects(points) {
  const n = points.length;
  if (n < 4) return false;
  const k = Math.cos(rad(points.reduce((s, p) => s + p.lat, 0) / n));
  const xy = points.map((p) => [p.lon * k, p.lat]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hit = (p1, p2, q1, q2) => {
    const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (hit(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return true;
  }
  return false;
}

export function perimeterMeters(points) {
  if (points.length < 2) return 0;
  return points.reduce((s, p, i) => s + distanceMeters(p, points[(i + 1) % points.length]), 0);
}

/** เทียบเนื้อที่จากหมุดกับโฉนด · ค่าคลาดเคลื่อน = เส้นรอบรูป × ความแม่นเฉลี่ยของหมุด */
export function compareArea(points, accuracies, deedSqMeters) {
  if (points.length < 3 || deedSqMeters == null || deedSqMeters <= 0) return null;
  const mean = accuracies.map((a) => a ?? DEFAULT_PIN_ACCURACY).reduce((s, a) => s + a, 0) / accuracies.length;
  const pinArea = polygonAreaSqMeters(points);
  const tolerance = perimeterMeters(points) * mean;
  const difference = pinArea - deedSqMeters;
  return {
    pinArea, deedArea: deedSqMeters, tolerance, difference,
    percent: difference / deedSqMeters * 100,
    consistent: Math.abs(difference) <= tolerance,
  };
}

/** ไร่-งาน-ตารางวา (ปัด 0.1 วาก่อนแยกหน่วย) */
export function toRaiNganWa(sqMeters) {
  const totalWa = Math.round(sqMeters / 4 * 10) / 10;
  const rai = Math.floor(totalWa / 400);
  const ngan = Math.floor((totalWa - rai * 400) / 100);
  const wa = totalWa - rai * 400 - ngan * 100;
  return { rai, ngan, wa, text: `${rai}-${ngan}-${wa.toFixed(1)}` };
}

export function formatDistance(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  if (m >= 10) return `${Math.round(m)} m`;
  return `${m.toFixed(1)} m`;
}

/** อ่านพิกัดที่พิมพ์/วาง เช่น "13.75, 100.50" หรือลิงก์ Google Maps ที่มี @lat,lon หรือ q=lat,lon */
export function parseCoordinates(text) {
  const m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(text)
    || /(?:^|[^\d.])(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)(?![\d.])/.exec(text);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

export const formatCoordinates = (p) => `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
export const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
export const directionsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
export const appleMapsUrl = (p) => `https://maps.apple.com/?daddr=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
