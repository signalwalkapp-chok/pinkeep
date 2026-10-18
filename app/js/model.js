// ข้อมูลแอป · รูปแบบไฟล์ "pinkeep" รุ่น 1 — ตรงกับ data/DataCodec.kt, Merge.kt, model/Search.kt ของ Android
import { orderAround } from './geo.js';

// ---------------------------------------------------------------- ภาษา
let lang = 'th';
try { lang = localStorage.getItem('pk.lang') || (navigator.language?.startsWith('th') ? 'th' : 'en'); } catch { /* ใช้ค่าเริ่มต้น */ }
export const getLang = () => lang;
export function setLang(value) { lang = value; try { localStorage.setItem('pk.lang', value); } catch { /* ไม่เป็นไร */ } }
export const tr = (th, en) => (lang === 'th' ? th : en);

// ---------------------------------------------------------------- ประเภท
export const KINDS = {
  PIN: { symbol: '📍', label: () => tr('หลักหมุด', 'Boundary pin'), prefix: () => tr('หมุด', 'Pin'), hint: () => tr('เช่น หมุดคอนกรีต มุมทิศเหนือ ติดต้นมะม่วง', 'e.g. concrete pin, north corner, next to the mango tree') },
  HOUSE: { symbol: '🏠', label: () => tr('บ้าน', 'House'), prefix: () => tr('บ้าน', 'House'), hint: () => tr('เช่น บ้านเลขที่ ซอย จุดสังเกต', 'e.g. house number, lane, landmark') },
  HOTEL: { symbol: '🏨', label: () => tr('โรงแรม / ที่พัก', 'Hotel / stay'), prefix: () => tr('ที่พัก', 'Stay'), hint: () => tr('เช่น ห้องที่พัก ราคา เบอร์โทร ที่จอดรถ', 'e.g. room, price, phone, parking') },
  RESTAURANT: { symbol: '🍜', label: () => tr('ร้านอาหาร', 'Restaurant'), prefix: () => tr('ร้าน', 'Restaurant'), hint: () => tr('เช่น เมนูเด็ด ราคา เวลาเปิด', 'e.g. best dishes, prices, opening hours') },
  PLACE: { symbol: '🗺️', label: () => tr('สถานที่', 'Place'), prefix: () => tr('สถานที่', 'Place'), hint: () => tr('เช่น ทางเข้า เวลาเปิด จุดจอดรถ', 'e.g. entrance, opening hours, parking') },
  TREE: { symbol: '🌳', label: () => tr('ต้นไม้', 'Tree'), prefix: () => tr('ต้นไม้', 'Tree'), hint: () => tr('เช่น พันธุ์ อายุ วันที่ปลูก', 'e.g. species, age, planting date') },
  ITEM: { symbol: '📦', label: () => tr('สิ่งของ', 'Item'), prefix: () => tr('สิ่งของ', 'Item'), hint: () => tr('เช่น ฝังไว้ลึกเท่าไร อยู่ใต้อะไร', "e.g. how deep it's buried, what it's under") },
  OTHER: { symbol: '⭐', label: () => tr('อื่นๆ', 'Other'), prefix: () => tr('จุด', 'Point'), hint: () => tr('รายละเอียด', 'Details') },
};
export const kindOf = (code) => (KINDS[code] ? code : 'OTHER');
export const IN_SITE = ['PIN', 'TREE', 'ITEM', 'HOUSE', 'OTHER'];
export const STANDALONE = ['HOUSE', 'HOTEL', 'RESTAURANT', 'PLACE', 'TREE', 'ITEM', 'OTHER'];

export const hasLocation = (m) => m.latitude != null && m.longitude != null;
export const pointOf = (m) => ({ lat: m.latitude, lon: m.longitude });

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const newMediaName = (prefix, ext) => `${prefix}-${newId().replace(/-/g, '').slice(0, 16)}.${ext}`;

// ---------------------------------------------------------------- โฉนด
const DEED_FIELDS = ['deedNo', 'landNo', 'surveyPage', 'mapSheet', 'book', 'page', 'subdistrict', 'district', 'province', 'rai', 'ngan', 'wa'];
export const emptyDeed = () => Object.fromEntries(DEED_FIELDS.map((f) => [f, '']));
export const deedIsEmpty = (d) => DEED_FIELDS.every((f) => !String(d?.[f] ?? '').trim());
const thaiDigits = (s) => String(s).replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50));

/** เนื้อที่ตามโฉนด (ตร.ม.) · null ถ้ายังไม่กรอกหรือเลขอ่านไม่ได้ */
export function deedAreaSqMeters(d) {
  if (!d || (!d.rai.trim() && !d.ngan.trim() && !d.wa.trim())) return null;
  const num = (s) => (s.trim() === '' ? 0 : Number(thaiDigits(s).replace(/,/g, '').trim()));
  const r = num(d.rai), n = num(d.ngan), w = num(d.wa);
  if ([r, n, w].some((x) => Number.isNaN(x))) return null;
  return r * 1600 + n * 400 + w * 4;
}
export function deedAreaText(d) {
  if (!d || (!d.rai.trim() && !d.ngan.trim() && !d.wa.trim())) return null;
  return `${d.rai || '0'}-${d.ngan || '0'}-${d.wa || '0'} ${tr('ไร่', 'rai')}`;
}
export function deedLocationText(d) {
  return [
    d.subdistrict && tr(`ต.${d.subdistrict}`, d.subdistrict),
    d.district && tr(`อ.${d.district}`, d.district),
    d.province && tr(`จ.${d.province}`, d.province),
  ].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- อ่าน/เขียน JSON
export const FORMAT = 'pinkeep';
export const VERSION = 1;

const str = (v) => (v == null ? '' : String(v));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const optNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const CORNERS = { TOP_LEFT: [0, 0], TOP_RIGHT: [1, 0], BOTTOM_LEFT: [0, 1], BOTTOM_RIGHT: [1, 1] };
function readStamp(s) {
  if (!s) return { enabled: false, coordinates: true, dateTime: true, label: true, notes: false, customText: '', corner: 'BOTTOM_LEFT', layout: 'OVERLAY', x: 0, y: 1, scale: 1, qr: false };
  const corner = CORNERS[s.corner] ? s.corner : 'BOTTOM_LEFT';
  return {
    enabled: s.enabled ?? true, coordinates: s.coordinates ?? true, dateTime: s.dateTime ?? true, label: s.label ?? true,
    notes: s.notes ?? false, customText: str(s.customText), corner,
    layout: ['OVERLAY', 'BOTTOM', 'SIDE'].includes(s.layout) ? s.layout : 'OVERLAY',
    x: num(s.x, CORNERS[corner][0]), y: num(s.y, CORNERS[corner][1]), scale: num(s.scale, 1), qr: s.qr ?? false,
  };
}
export const defaultStamp = () => readStamp({ enabled: true });
const readPhoto = (p) => ({ file: str(p.file), takenAt: num(p.takenAt), stamp: readStamp(p.stamp) });

function readSite(j) {
  const created = num(j.createdAt);
  return {
    id: str(j.id), name: str(j.name), notes: str(j.notes), createdAt: created, updatedAt: num(j.updatedAt, created),
    deed: Object.fromEntries(DEED_FIELDS.map((f) => [f, str(j.deed?.[f])])),
    deedPhotos: (j.deedPhotos || []).filter((p) => p && p.file).map(readPhoto),
    pinOrder: (j.pinOrder || []).map(str),
  };
}
function readMark(j) {
  const created = num(j.createdAt);
  return {
    id: str(j.id), siteId: j.siteId ? str(j.siteId) : null, kind: kindOf(j.kind), label: str(j.label),
    latitude: optNum(j.latitude), longitude: optNum(j.longitude), accuracyMeters: optNum(j.accuracyMeters),
    manual: !!j.manual, draft: !!j.draft, notes: str(j.notes), createdAt: created, updatedAt: num(j.updatedAt, created),
    photos: (j.photos || []).filter((p) => p && p.file).map(readPhoto),
    voices: (j.voices || []).filter((v) => v && v.file).map((v) => ({ file: str(v.file), durationMs: num(v.durationMs), createdAt: num(v.createdAt) })),
  };
}

/** @throws ถ้าไม่ใช่ไฟล์ของ PinKeep */
export function decode(text) {
  const root = JSON.parse(text);
  if (root?.format !== FORMAT) throw new Error('not a PinKeep file');
  const sites = (root.sites || []).filter((s) => s && s.id).map(readSite);
  const ids = new Set(sites.map((s) => s.id));
  const marks = (root.marks || []).filter((m) => m && m.id).map(readMark).filter((m) => m.siteId == null || ids.has(m.siteId));
  return { sites, marks };
}

export function encode(data, generator = '') {
  const site = (s) => ({
    id: s.id, name: s.name, notes: s.notes, createdAt: s.createdAt, updatedAt: s.updatedAt,
    deed: Object.fromEntries(DEED_FIELDS.map((f) => [f, s.deed[f]])),
    deedPhotos: s.deedPhotos, ...(s.pinOrder.length ? { pinOrder: s.pinOrder } : {}),
  });
  const mark = (m) => ({
    id: m.id, ...(m.siteId ? { siteId: m.siteId } : {}), kind: m.kind, label: m.label,
    ...(m.latitude != null ? { latitude: m.latitude } : {}), ...(m.longitude != null ? { longitude: m.longitude } : {}),
    ...(m.accuracyMeters != null ? { accuracyMeters: m.accuracyMeters } : {}),
    ...(m.manual ? { manual: true } : {}), ...(m.draft ? { draft: true } : {}),
    notes: m.notes, createdAt: m.createdAt, updatedAt: m.updatedAt, photos: m.photos, voices: m.voices,
  });
  return JSON.stringify({ format: FORMAT, version: VERSION, ...(generator ? { generator } : {}), sites: data.sites.map(site), marks: data.marks.map(mark) }, null, 2);
}

export function referencedFiles(data) {
  const set = new Set();
  data.sites.forEach((s) => s.deedPhotos.forEach((p) => set.add(p.file)));
  data.marks.forEach((m) => { m.photos.forEach((p) => set.add(p.file)); m.voices.forEach((v) => set.add(v.file)); });
  return set;
}

// ---------------------------------------------------------------- แปลง/หมุด
export const marksOf = (data, siteId) => data.marks.filter((m) => m.siteId === siteId && !m.draft);
export const standaloneOf = (data, kind) => data.marks.filter((m) => m.siteId == null && m.kind === kind && !m.draft);

/** หลักหมุดที่มีพิกัดตามลำดับรอบแปลง: ลำดับที่ผู้ใช้จัด (ที่เพิ่มทีหลังต่อท้าย) หรือเรียงตามมุมอัตโนมัติ */
export function boundaryOf(site, marks) {
  const pins = marks.filter((m) => m.siteId === site.id && m.kind === 'PIN' && hasLocation(m) && !m.draft);
  if (site.pinOrder.length) {
    const byId = new Map(pins.map((p) => [p.id, p]));
    const ordered = site.pinOrder.map((id) => byId.get(id)).filter(Boolean);
    return ordered.concat(pins.filter((p) => !ordered.includes(p)));
  }
  return orderAround(pins.map(pointOf)).map((i) => pins[i]);
}

// ---------------------------------------------------------------- รวมข้อมูลที่ได้รับ
export const conflicts = (existing, incoming) =>
  incoming.sites.filter((s) => existing.sites.some((e) => e.id === s.id)).length +
  incoming.marks.filter((m) => existing.marks.some((e) => e.id === m.id)).length;

/** mode: 'UPDATE' | 'KEEP_BOTH' · mediaName(old) คืนชื่อไฟล์ใหม่ในเครื่อง */
export function merge(existing, incoming, mode, mediaName) {
  const names = new Map();
  const rename = (n) => { if (!names.has(n)) names.set(n, mediaName(n)); return names.get(n); };
  const received = {
    sites: incoming.sites.map((s) => ({ ...s, deedPhotos: s.deedPhotos.map((p) => ({ ...p, file: rename(p.file) })) })),
    marks: incoming.marks.map((m) => ({ ...m, photos: m.photos.map((p) => ({ ...p, file: rename(p.file) })), voices: m.voices.map((v) => ({ ...v, file: rename(v.file) })) })),
  };
  const siteIds = new Map();
  const sites = existing.sites.slice();
  for (const site of received.sites) {
    const i = sites.findIndex((s) => s.id === site.id);
    if (i < 0) sites.push(site);
    else if (mode === 'UPDATE') {
      const old = sites[i];
      sites[i] = deedIsEmpty(site.deed) && !site.deedPhotos.length ? { ...site, deed: old.deed, deedPhotos: old.deedPhotos } : site;
    } else { const id = newId(); siteIds.set(site.id, id); sites.push({ ...site, id }); }
  }
  const markIds = new Map();
  const marks = existing.marks.slice();
  for (const inc of received.marks) {
    const mark = { ...inc, siteId: inc.siteId ? (siteIds.get(inc.siteId) ?? inc.siteId) : null, draft: false };
    const i = marks.findIndex((m) => m.id === mark.id);
    if (i < 0) marks.push(mark);
    else if (mode === 'UPDATE' && mark.siteId === inc.siteId) marks[i] = mark;
    else { const id = newId(); markIds.set(mark.id, id); marks.push({ ...mark, id }); }
  }
  const fresh = new Set(siteIds.values());
  return {
    data: { sites: sites.map((s) => (fresh.has(s.id) ? { ...s, pinOrder: s.pinOrder.map((p) => markIds.get(p) ?? p) } : s)), marks },
    renamed: names,
  };
}

/** ข้อมูลที่จะส่ง: แปลงที่เลือกทั้งแปลง + รายการที่เลือก (พร้อมแปลงของรายการ) · includeDeed=false ตัดโฉนดออก */
export function subset(data, sites, marks, includeDeed) {
  const whole = new Set(sites.map((s) => s.id));
  const siteIds = new Set([...whole, ...marks.map((m) => m.siteId).filter(Boolean)]);
  const chosen = new Map();
  data.marks.filter((m) => whole.has(m.siteId) && !m.draft).concat(marks).forEach((m) => chosen.set(m.id, { ...m, draft: false }));
  return {
    sites: data.sites.filter((s) => siteIds.has(s.id)).map((s) => (includeDeed ? s : { ...s, deed: emptyDeed(), deedPhotos: [] })),
    marks: [...chosen.values()],
  };
}
export const hasDeedData = (data) => data.sites.some((s) => !deedIsEmpty(s.deed) || s.deedPhotos.length);

// ---------------------------------------------------------------- ค้นหา/เรียง
export const normalize = (t) => thaiDigits(String(t).toLowerCase()).replace(/\s+/g, ' ').trim();
const deedText = (d) => ['deedNo', 'landNo', 'surveyPage', 'mapSheet', 'book', 'page', 'subdistrict', 'district', 'province'].map((f) => d[f]).join(' ');

/** ผลค้นหา [{type:'mark'|'site', item}] เรียงจากตรงชื่อมากสุด แล้วแก้ไขล่าสุด */
export function find(data, query) {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return [];
  const score = (name, rest) => {
    const n = normalize(name), all = `${n} ${normalize(rest)}`;
    if (!terms.every((t) => all.includes(t))) return null;
    if (n.startsWith(terms[0])) return 0;
    return terms.every((t) => n.includes(t)) ? 1 : 2;
  };
  const hits = [];
  data.marks.filter((m) => !m.draft).forEach((m) => {
    const site = m.siteId ? data.sites.find((s) => s.id === m.siteId) : null;
    const s = score(m.label, [m.notes, site?.name ?? '', site ? deedText(site.deed) : ''].join(' '));
    if (s != null) hits.push({ s, type: 'mark', item: m });
  });
  data.sites.forEach((site) => {
    const s = score(site.name, `${site.notes} ${deedText(site.deed)}`);
    if (s != null) hits.push({ s, type: 'site', item: site });
  });
  return hits.sort((a, b) => a.s - b.s || b.item.updatedAt - a.item.updatedAt);
}

const collator = new Intl.Collator('th');
export function sortMarks(marks, sort, here, distance) {
  const list = marks.slice();
  if (sort === 'RECENT') return list.sort((a, b) => b.updatedAt - a.updatedAt);
  if (sort === 'NAME') return list.sort((a, b) => collator.compare(a.label, b.label));
  const d = (m) => (here && hasLocation(m) ? distance(here, pointOf(m)) : Infinity);
  return list.sort((a, b) => d(a) - d(b) || b.updatedAt - a.updatedAt);
}
