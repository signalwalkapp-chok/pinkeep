// PinKeep เว็บแอป — หน้าจอทั้งหมด (ไม่มี framework) · ข้อมูลอยู่ใน IndexedDB ของเครื่อง
import * as G from './geo.js';
import * as M from './model.js';
import * as DB from './db.js';

const { tr } = M;
export const APP_VERSION = '0.1.0';
const app = document.getElementById('app');

let data = { sites: [], marks: [] };
let here = null;          // ตำแหน่งล่าสุดที่รู้ {lat, lon, acc}
let editor = null;        // { mark, isNew, from } รายการที่กำลังแก้ (ยังไม่บันทึก)
let incoming = null;      // ไฟล์ที่เปิดรอยืนยันนำเข้า { data, media: Map, name }
let listSort = 'NEAREST';
let query = '';
let map = null;
let cleanups = [];

// ---------------------------------------------------------------- เครื่องมือ
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { location.hash = hash; };
const back = () => (history.length > 1 ? history.back() : go('#/'));
const now = () => Date.now();
const siteById = (id) => data.sites.find((s) => s.id === id);
const markById = (id) => data.marks.find((m) => m.id === id);
const sqWa = (sqm) => (sqm / 4).toLocaleString('en-US', { maximumFractionDigits: 1 });

let toastTimer;
function toast(text) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.append(el); }
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function save() {
  try { await DB.saveData(data); } catch (e) { toast(tr('บันทึกไม่สำเร็จ: ', 'Save failed: ') + e.message); }
}

const header = (title, { home = false, right = '' } = {}) => `
  <header class="bar">
    ${home ? '<span class="logo">📍</span>' : `<button class="icon" data-act="back" aria-label="${tr('กลับ', 'Back')}">‹</button>`}
    <h1>${esc(title)}</h1>
    <div class="bar-right">${right}</div>
  </header>`;

// รูปจาก IndexedDB — ใส่ data-media แล้วเติม src ทีหลัง
const urls = new Map();
async function mediaUrl(name) {
  if (urls.has(name)) return urls.get(name);
  const blob = await DB.getMedia(name);
  const url = blob ? URL.createObjectURL(blob) : '';
  urls.set(name, url);
  return url;
}
async function fillMedia(root = app) {
  for (const el of root.querySelectorAll('[data-media]')) {
    const url = await mediaUrl(el.dataset.media);
    if (url) el.src = url; else el.classList.add('missing');
  }
}

/** ย่อรูปให้ด้านยาวไม่เกิน max แล้วเก็บเป็น JPEG — รูปจาก iPhone ใหญ่เกินจะเก็บตรง ๆ */
function resizeImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error(tr('เปิดรูปไม่ได้', 'Cannot open image'))); };
    img.src = src;
  });
}

async function addPhotos(files) {
  const added = [];
  for (const f of files) {
    const blob = await resizeImage(f);
    const name = M.newMediaName('photo', 'jpg');
    await DB.putMedia(name, blob);
    added.push({ file: name, takenAt: f.lastModified || now(), stamp: M.defaultStamp() });
  }
  return added;
}

// ---------------------------------------------------------------- ตำแหน่ง
function watchHere() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (p) => { here = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; document.dispatchEvent(new Event('here')); },
    () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
}

/** อ่าน GPS หลายครั้งภายใน 15 วินาที เลือกค่าที่แม่นที่สุด (หยุดก่อนถ้าแม่นถึง 4 ม.) */
function captureGps(onProgress) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(tr('อุปกรณ์นี้ไม่มี GPS', 'No GPS on this device'))); return; }
    let best = null; const start = now();
    const finish = () => { navigator.geolocation.clearWatch(id); clearTimeout(timer); best ? resolve(best) : reject(new Error(tr('ยังหาตำแหน่งไม่ได้', 'No position yet'))); };
    const id = navigator.geolocation.watchPosition((p) => {
      const fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
      if (!best || fix.acc < best.acc) best = fix;
      onProgress?.(best, Math.round((now() - start) / 1000));
      if (best.acc <= 4 && now() - start > 3000) finish();
    }, (e) => {
      if (e.code === 1) { navigator.geolocation.clearWatch(id); clearTimeout(timer); reject(new Error(tr('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดใน ตั้งค่า › ความเป็นส่วนตัว › บริการหาตำแหน่ง', 'Location permission denied — enable it in Settings'))); }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    const timer = setTimeout(finish, 15000);
  });
}

// ---------------------------------------------------------------- ไฟล์ .pinkeep
async function pack(subsetData, generatorNote) {
  const zip = new JSZip();
  zip.file('data.json', M.encode(subsetData, `PinKeep Web ${APP_VERSION} ${generatorNote}`));
  for (const name of [...M.referencedFiles(subsetData)].sort()) {
    const blob = await DB.getMedia(name);
    if (blob) zip.file(`media/${name}`, blob);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream' });
}

const safeName = (s) => (s || 'PinKeep').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'PinKeep';

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function sendItems(sites, marks, name) {
  const includeDeed = M.hasDeedData(M.subset(data, sites, marks, true))
    ? confirm(tr('รวมข้อมูลโฉนด (เลขโฉนดและรูปโฉนด) ไปด้วยไหม?\n\nตกลง = ส่งโฉนดด้วย · ยกเลิก = ไม่ส่งโฉนด', 'Include deed details (deed number and photos)?\n\nOK = include · Cancel = leave out'))
    : false;
  toast(tr('กำลังสร้างไฟล์…', 'Building file…'));
  const blob = await pack(M.subset(data, sites, marks, includeDeed), 'share');
  await shareOrDownload(blob, `${safeName(name)}.pinkeep`, name);
}

async function backupAll() {
  toast(tr('กำลังสร้างไฟล์สำรอง…', 'Building backup…'));
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const blob = await pack({ sites: data.sites, marks: data.marks.filter((m) => !m.draft) }, 'backup');
  await shareOrDownload(blob, `PinKeep-backup-${stamp}.pinkeep`, 'PinKeep backup');
}

async function openFile(file) {
  try {
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file('data.json');
    if (!entry) throw new Error('missing data.json');
    const parsed = M.decode(await entry.async('string'));
    const media = new Map();
    for (const f of Object.values(zip.files)) {
      if (f.dir || !f.name.startsWith('media/')) continue;
      const name = f.name.split('/').pop();   // เฉพาะชื่อไฟล์ กัน ../
      if (name) media.set(name, await f.async('blob'));
    }
    incoming = { data: parsed, media, name: file.name };
    go('#/import');
  } catch (e) {
    toast(tr('ไม่ใช่ไฟล์ PinKeep หรือไฟล์เสีย', 'Not a PinKeep file, or the file is damaged'));
  }
}

async function confirmImport(mode) {
  const mediaName = (old) => M.newMediaName((old.split('-')[0] || 'f').slice(0, 5), old.includes('.') ? old.split('.').pop() : 'bin');
  const { data: merged, renamed } = M.merge(data, incoming.data, mode, mediaName);
  for (const [old, fresh] of renamed) {
    const blob = incoming.media.get(old);
    if (blob) await DB.putMedia(fresh, blob);
  }
  data = merged; await save();
  const n = incoming.data.sites.length + incoming.data.marks.length;
  incoming = null;
  toast(tr(`นำเข้าแล้ว ${n} รายการ`, `Imported ${n} items`));
  go('#/');
}

// ---------------------------------------------------------------- แผนที่
const tiles = () => ({
  [tr('ดาวเทียม', 'Satellite')]: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Tiles © Esri' }),
  [tr('แผนที่ถนน', 'Streets')]: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
});
const emojiIcon = (emoji, cls = '') => L.divIcon({ className: `emoji-pin ${cls}`, html: `<span>${emoji}</span>`, iconSize: [34, 34], iconAnchor: [17, 30] });

function makeMap(el) {
  const layers = tiles();
  const m = L.map(el, { zoomControl: true, attributionControl: true });
  Object.values(layers)[0].addTo(m);
  L.control.layers(layers, null, { position: 'topright' }).addTo(m);
  return m;
}

function drawMarks(m, marks, sites) {
  const bounds = [];
  for (const site of sites) {
    const pins = M.boundaryOf(site, data.marks);
    if (pins.length >= 3) L.polygon(pins.map((p) => [p.latitude, p.longitude]), { color: '#f97316', weight: 3, fillOpacity: 0.15 }).addTo(m);
  }
  for (const mk of marks) {
    if (!M.hasLocation(mk)) continue;
    const ll = [mk.latitude, mk.longitude]; bounds.push(ll);
    L.marker(ll, { icon: emojiIcon(M.KINDS[mk.kind].symbol) }).addTo(m)
      .bindPopup(`<b>${esc(mk.label)}</b><br><a href="#/mark/${mk.id}">${tr('เปิด', 'Open')}</a>`);
  }
  if (bounds.length) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  else if (here) m.setView([here.lat, here.lon], 16);
  else m.setView([13.7563, 100.5018], 6);
}

// ---------------------------------------------------------------- หน้าจอ
const views = {};

views.home = () => {
  const counts = { SITES: data.sites.length };
  M.STANDALONE.forEach((k) => { counts[k] = M.standaloneOf(data, k).length; });
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone;
  const results = query ? M.find(data, query) : null;
  return {
    html: `${header('PinKeep', { home: true, right: `<button class="chip" data-act="lang">${M.getLang() === 'th' ? 'EN' : 'ไทย'}</button>` })}
    <main>
      ${ios ? `<div class="note install">📲 ${tr('ติดตั้งเป็นแอป: กดปุ่ม แชร์ <b>⬆︎</b> ใน Safari แล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b>', 'Install: tap Share <b>⬆︎</b> in Safari, then <b>Add to Home Screen</b>')}</div>` : ''}
      <input class="search" type="search" id="q" value="${esc(query)}" placeholder="🔍 ${tr('ค้นหา ชื่อ เลขโฉนด ตำบล…', 'Search name, deed no., area…')}">
      ${results ? `<div class="list">${results.length ? results.map((h) => (h.type === 'site' ? siteRow(h.item) : markRow(h.item))).join('') : `<p class="muted">${tr('ไม่พบ', 'No results')}</p>`}</div>` : `
      <h2 class="ask">${tr('จะเก็บอะไร?', 'What do you want to save?')}</h2>
      <div class="grid">
        <a class="tile land" href="#/sites"><span class="sym">📜</span><b>${tr('โฉนด / ที่ดิน', 'Deeds / land')}</b><i>${counts.SITES || ''}</i></a>
        ${M.STANDALONE.map((k) => `<a class="tile" href="#/cat/${k}"><span class="sym">${M.KINDS[k].symbol}</span><b>${M.KINDS[k].label()}</b><i>${counts[k] || ''}</i></a>`).join('')}
      </div>
      <div class="row">
        <a class="btn" href="#/map">🗺️ ${tr('แผนที่ทุกจุด', 'All on map')}</a>
        <label class="btn">📥 ${tr('เปิดไฟล์ PinKeep', 'Open PinKeep file')}<input type="file" id="openfile" hidden></label>
      </div>
      <div class="row">
        <button class="btn" data-act="backup">💾 ${tr('สำรองข้อมูลทั้งหมด', 'Back up everything')}</button>
      </div>
      <p class="muted small">PinKeep Web ${APP_VERSION} · ${tr('ข้อมูลเก็บในเครื่องนี้เท่านั้น ควรสำรองเป็นไฟล์เป็นระยะ', 'Data stays on this device — back up to a file now and then')}</p>`}
    </main>`,
    mount() {
      const q = document.getElementById('q');
      q.addEventListener('input', () => { query = q.value; const pos = q.selectionStart; render(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); });
      document.getElementById('openfile')?.addEventListener('change', (e) => e.target.files[0] && openFile(e.target.files[0]));
    },
  };
};

function distanceText(mk) {
  return here && M.hasLocation(mk) ? G.formatDistance(G.distanceMeters(here, M.pointOf(mk))) : '';
}
const markRow = (mk) => {
  const site = mk.siteId ? siteById(mk.siteId) : null;
  return `<a class="item" href="#/mark/${mk.id}"><span class="sym">${M.KINDS[mk.kind].symbol}</span>
    <span class="txt"><b>${esc(mk.label)}</b><small>${esc([site?.name, mk.notes].filter(Boolean).join(' · ')) || (M.hasLocation(mk) ? '' : tr('ยังไม่มีพิกัด', 'No location yet'))}</small></span>
    <span class="dist">${distanceText(mk)}</span></a>`;
};
const siteRow = (s) => `<a class="item" href="#/site/${s.id}"><span class="sym">📜</span>
  <span class="txt"><b>${esc(s.name)}</b><small>${esc([s.deed.deedNo && tr(`โฉนด ${s.deed.deedNo}`, `Deed ${s.deed.deedNo}`), M.deedLocationText(s.deed)].filter(Boolean).join(' · '))}</small></span>
  <span class="dist">${M.marksOf(data, s.id).length}</span></a>`;

views.sites = () => ({
  html: `${header(tr('โฉนด / ที่ดิน', 'Deeds / land'))}
  <main>
    <form class="row" id="newsite"><input id="sitename" placeholder="${tr('ชื่อแปลง เช่น สวนหลังบ้าน', 'Plot name, e.g. back garden')}" required><button class="btn primary">+ ${tr('เพิ่มแปลง', 'Add plot')}</button></form>
    <div class="list">${data.sites.slice().sort((a, b) => b.updatedAt - a.updatedAt).map(siteRow).join('') || `<p class="muted">${tr('ยังไม่มีแปลง', 'No plots yet')}</p>`}</div>
  </main>`,
  mount() {
    document.getElementById('newsite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = now();
      const site = { id: M.newId(), name: document.getElementById('sitename').value.trim(), notes: '', deed: M.emptyDeed(), deedPhotos: [], createdAt: t, updatedAt: t, pinOrder: [] };
      data.sites.push(site); await save(); go(`#/site/${site.id}`);
    });
  },
});

const sortChips = () => `<div class="chips">${[['NEAREST', tr('ใกล้สุด', 'Nearest')], ['RECENT', tr('ล่าสุด', 'Recent')], ['NAME', tr('ชื่อ', 'Name')]]
  .map(([k, t]) => `<button class="chip ${listSort === k ? 'on' : ''}" data-act="sort" data-v="${k}">${t}</button>`).join('')}</div>`;

views.cat = (kind) => {
  kind = M.kindOf(kind);
  const list = M.sortMarks(M.standaloneOf(data, kind), listSort, here, G.distanceMeters);
  return {
    html: `${header(M.KINDS[kind].label(), { right: list.length ? `<button class="chip" data-act="sendcat" data-v="${kind}">📤</button>` : '' })}
    <main>
      <a class="btn primary wide" href="#/new/${kind}">+ ${M.KINDS[kind].symbol} ${tr('เพิ่ม', 'Add')} ${M.KINDS[kind].label()}</a>
      ${list.length ? sortChips() : ''}
      <div class="list">${list.map(markRow).join('') || `<p class="muted">${tr('ยังไม่มีรายการ', 'Nothing saved yet')}</p>`}</div>
    </main>`,
  };
};

const DEED_LABELS = () => [
  ['deedNo', tr('เลขที่โฉนด', 'Deed no.')], ['landNo', tr('เลขที่ดิน', 'Parcel no.')], ['surveyPage', tr('หน้าสำรวจ', 'Survey page')],
  ['mapSheet', tr('ระวาง', 'Map sheet')], ['book', tr('เล่ม', 'Book')], ['page', tr('หน้า', 'Page')],
  ['subdistrict', tr('ตำบล', 'Subdistrict')], ['district', tr('อำเภอ', 'District')], ['province', tr('จังหวัด', 'Province')],
  ['rai', tr('ไร่', 'Rai')], ['ngan', tr('งาน', 'Ngan')], ['wa', tr('ตารางวา', 'Sq. wa')],
];

function areaSummary(site) {
  const pins = M.boundaryOf(site, data.marks);
  const pts = pins.map(M.pointOf);
  const deedArea = M.deedAreaSqMeters(site.deed);
  if (pts.length < 3) {
    return `<div class="card"><b>${tr('เนื้อที่จากหมุด', 'Area from pins')}</b><p class="muted">${tr(`มีหมุดที่มีพิกัด ${pts.length} จุด ต้องมีอย่างน้อย 3 จุด`, `${pts.length} pins with a location — at least 3 needed`)}</p>
      ${deedArea ? `<p>${tr('ตามโฉนด', 'Deed')}: ${esc(M.deedAreaText(site.deed))}</p>` : ''}</div>`;
  }
  const area = G.polygonAreaSqMeters(pts);
  const cmp = G.compareArea(pts, pins.map((p) => p.accuracyMeters), deedArea);
  const crossed = G.selfIntersects(pts);
  let cmpHtml = '';
  if (cmp) {
    const diffWa = sqWa(Math.abs(cmp.difference)), tolWa = sqWa(cmp.tolerance);
    cmpHtml = cmp.consistent
      ? `<div class="ok">✅ ${tr(`สอดคล้องกับโฉนด · ต่างกัน ${diffWa} ตร.วา อยู่ในค่าคลาดเคลื่อน GPS ±${tolWa} ตร.วา`, `Matches the deed · ${diffWa} sq wa apart, within GPS error ±${tolWa} sq wa`)}</div>`
      : `<div class="warn">⚠️ ${cmp.difference < 0 ? tr('น้อยกว่า', 'Smaller than') : tr('มากกว่า', 'Larger than')}${tr('โฉนด', ' the deed by')} ${diffWa} ${tr('ตร.วา', 'sq wa')} (${Math.abs(cmp.percent).toFixed(1)}%)<br>${tr(`เกินค่าคลาดเคลื่อน ±${tolWa} ตร.วา · อาจขาดหมุด วางผิดตำแหน่ง หรือลำดับผิด`, `More than the ±${tolWa} sq wa GPS error · a pin may be missing, misplaced or out of order`)}</div>`;
  }
  return `<div class="card"><b>${tr('เนื้อที่จากหมุด', 'Area from pins')} (${pts.length})</b>
    <p class="big">≈ ${G.toRaiNganWa(area).text} ${tr('ไร่', 'rai')} <small>(${Math.round(area).toLocaleString()} ${tr('ตร.ม.', 'm²')})</small></p>
    ${deedArea ? `<p>${tr('ตามโฉนด', 'Deed')}: ${esc(M.deedAreaText(site.deed))}</p>` : ''}
    ${cmpHtml}
    ${crossed ? `<div class="warn">⚠️ ${tr('เส้นเขตตัดกันเอง — ลำดับหมุดน่าจะผิด จัดลำดับใหม่ด้านล่าง', 'Boundary crosses itself — pin order is probably wrong; reorder below')}</div>` : ''}
    <p class="small muted">${tr('GPS มือถือคลาดเคลื่อนได้ 3–10 ม. เนื้อที่เป็นค่าประมาณ ไม่ใช่การรังวัด', 'Phone GPS is off by 3–10 m; areas are estimates, not a survey')}</p></div>`;
}

views.site = (id) => {
  const site = siteById(id);
  if (!site) return views.home();
  const marks = M.marksOf(data, id);
  const pins = M.boundaryOf(site, data.marks);
  const others = marks.filter((m) => !pins.includes(m));
  return {
    html: `${header(site.name, { right: `<button class="chip" data-act="sendsite" data-v="${id}">📤</button>` })}
    <main>
      <div class="addrow">${M.IN_SITE.map((k) => `<a class="btn ${k === 'PIN' ? 'primary' : ''}" href="#/new/${k}/${id}">+ ${M.KINDS[k].symbol} ${M.KINDS[k].label()}</a>`).join('')}</div>
      <div id="map" class="map small"></div>
      ${areaSummary(site)}
      ${pins.length ? `<div class="card"><b>${tr('ลำดับหมุดรอบแปลง', 'Pin order around the plot')} ${site.pinOrder.length ? '' : `<small class="muted">(${tr('อัตโนมัติ', 'automatic')})</small>`}</b>
        <div class="list">${pins.map((p, i) => `<div class="item"><span class="sym">${i + 1}</span><a class="txt" href="#/mark/${p.id}"><b>${esc(p.label)}</b><small>${p.accuracyMeters != null ? `±${Math.round(p.accuracyMeters)} m` : tr('ปักบนแผนที่', 'placed on map')}</small></a>
          <span class="ord"><button class="icon" data-act="up" data-v="${p.id}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon" data-act="down" data-v="${p.id}" ${i === pins.length - 1 ? 'disabled' : ''}>↓</button></span></div>`).join('')}</div>
        ${site.pinOrder.length ? `<button class="btn" data-act="autoorder">↺ ${tr('เรียงอัตโนมัติ', 'Order automatically')}</button>` : ''}</div>` : ''}
      ${others.length ? `<div class="card"><b>${tr('รายการอื่นในแปลง', 'Other items in the plot')}</b><div class="list">${others.map(markRow).join('')}</div></div>` : ''}
      <details class="card" ${M.deedIsEmpty(site.deed) ? '' : 'open'}><summary><b>📜 ${tr('ข้อมูลโฉนด', 'Deed details')}</b></summary>
        <label class="field">${tr('ชื่อแปลง', 'Plot name')}<input data-site="name" value="${esc(site.name)}"></label>
        <div class="deed">${DEED_LABELS().map(([f, t]) => `<label class="field">${t}<input data-deed="${f}" value="${esc(site.deed[f])}" ${['rai', 'ngan', 'wa'].includes(f) ? 'inputmode="decimal"' : ''}></label>`).join('')}</div>
        <label class="field">${tr('บันทึก', 'Notes')}<textarea data-site="notes" rows="2">${esc(site.notes)}</textarea></label>
        <div class="photos">${site.deedPhotos.map((p, i) => `<figure><img data-media="${esc(p.file)}" alt=""><button class="icon del" data-act="deldeedphoto" data-v="${i}">✕</button></figure>`).join('')}</div>
        <label class="btn">📷 ${tr('เพิ่มรูปโฉนด', 'Add deed photo')}<input type="file" accept="image/*" multiple hidden id="deedphoto"></label>
        <p class="small muted">${tr('อ่านโฉนดจากรูปอัตโนมัติยังไม่มีในเว็บรุ่นนี้ (มีในแอป Android)', 'Reading the deed from a photo is not in this web version yet (it is in the Android app)')}</p>
      </details>
      <button class="btn danger" data-act="delsite" data-v="${id}">🗑 ${tr('ลบแปลงนี้', 'Delete this plot')}</button>
    </main>`,
    mount() {
      map = makeMap(document.getElementById('map'));
      drawMarks(map, marks, [site]);
      app.querySelectorAll('[data-deed]').forEach((el) => el.addEventListener('change', async () => {
        site.deed[el.dataset.deed] = el.value.trim(); site.updatedAt = now(); await save(); render();
      }));
      app.querySelectorAll('[data-site]').forEach((el) => el.addEventListener('change', async () => {
        site[el.dataset.site] = el.dataset.site === 'name' ? (el.value.trim() || site.name) : el.value; site.updatedAt = now(); await save(); render();
      }));
      document.getElementById('deedphoto').addEventListener('change', async (e) => {
        site.deedPhotos.push(...await addPhotos([...e.target.files])); site.updatedAt = now(); await save(); render();
      });
      fillMedia();
    },
  };
};

function movePin(siteId, pinId, delta) {
  const site = siteById(siteId);
  const order = M.boundaryOf(site, data.marks).map((p) => p.id);
  const i = order.indexOf(pinId), j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  site.pinOrder = order; site.updatedAt = now();
}

views.mark = (id) => {
  const mk = markById(id);
  if (!mk) return views.home();
  const site = mk.siteId ? siteById(mk.siteId) : null;
  const p = M.hasLocation(mk) ? M.pointOf(mk) : null;
  return {
    html: `${header(mk.label, { right: `<button class="chip" data-act="edit" data-v="${id}">✏️ ${tr('แก้ไข', 'Edit')}</button>` })}
    <main>
      <p class="muted">${M.KINDS[mk.kind].symbol} ${M.KINDS[mk.kind].label()}${site ? ` · <a href="#/site/${site.id}">${esc(site.name)}</a>` : ''}</p>
      ${p ? `<div id="map" class="map small"></div>
        <p class="coords">${G.formatCoordinates(p)} ${mk.accuracyMeters != null ? `±${Math.round(mk.accuracyMeters)} m` : tr('(ปักบนแผนที่)', '(placed on map)')} ${here ? `· ${tr('ห่าง', 'away')} ${distanceText(mk)}` : ''}</p>
        <div class="row">
          <a class="btn primary" href="#/find/${id}">🧭 ${tr('เดินหาด้วยเข็มทิศ', 'Find with compass')}</a>
          <a class="btn" href="${G.directionsUrl(p)}" target="_blank" rel="noopener">🚗 Google Maps</a>
          <a class="btn" href="${G.appleMapsUrl(p)}" target="_blank" rel="noopener">🍎 Apple Maps</a>
        </div>` : `<div class="warn">${tr('ยังไม่มีพิกัด — กดแก้ไขเพื่อใส่ตำแหน่ง', 'No location yet — tap Edit to add one')}</div>`}
      ${mk.notes ? `<div class="card notes">${esc(mk.notes)}</div>` : ''}
      ${mk.photos.length ? `<div class="photos">${mk.photos.map((ph) => `<figure><img data-media="${esc(ph.file)}" alt=""></figure>`).join('')}</div>` : ''}
      ${mk.voices.length ? `<div class="card">${mk.voices.map((v) => `<audio controls preload="none" data-voice="${esc(v.file)}"></audio>`).join('')}</div>` : ''}
      <div class="row">
        <button class="btn" data-act="sharetext" data-v="${id}">💬 ${tr('ส่งทาง LINE / ข้อความ', 'Share as text')}</button>
        <button class="btn" data-act="sendmark" data-v="${id}">📲 ${tr('ส่งให้ผู้ใช้ PinKeep', 'Send to a PinKeep user')}</button>
      </div>
      <button class="btn danger" data-act="delmark" data-v="${id}">🗑 ${tr('ลบรายการนี้', 'Delete this item')}</button>
    </main>`,
    async mount() {
      if (p) { map = makeMap(document.getElementById('map')); drawMarks(map, [mk], site ? [site] : []); map.setView([p.lat, p.lon], 18); }
      fillMedia();
      for (const el of app.querySelectorAll('[data-voice]')) el.src = await mediaUrl(el.dataset.voice);
    },
  };
};

function startEditor(mark, isNew) {
  editor = { mark: structuredClone(mark), isNew };
  // รายการใหม่: แทนที่ #/new ในประวัติ ไม่งั้นกดกลับแล้วสร้างรายการใหม่ซ้ำ
  if (isNew) location.replace('#/edit'); else go('#/edit');
}

views.new = (kind, siteId) => {
  kind = M.kindOf(kind);
  const t = now();
  const count = (siteId ? M.marksOf(data, siteId) : M.standaloneOf(data, kind)).filter((m) => m.kind === kind).length;
  startEditor({ id: M.newId(), siteId: siteId || null, kind, label: `${M.KINDS[kind].prefix()} ${count + 1}`, latitude: null, longitude: null, accuracyMeters: null, manual: false, draft: false, notes: '', createdAt: t, updatedAt: t, photos: [], voices: [] }, true);
  return { html: '' };
};

views.edit = () => {
  if (!editor) return views.home();
  const mk = editor.mark;
  const p = M.hasLocation(mk) ? M.pointOf(mk) : null;
  return {
    html: `${header(editor.isNew ? `${tr('เพิ่ม', 'Add')} ${M.KINDS[mk.kind].label()}` : tr('แก้ไข', 'Edit'))}
    <main class="editor">
      <label class="field">${tr('ชื่อ', 'Name')}<input id="label" value="${esc(mk.label)}"></label>
      <div class="card"><b>📍 ${tr('ตำแหน่ง', 'Location')}</b>
        <p class="coords" id="loc">${p ? `${G.formatCoordinates(p)} ${mk.accuracyMeters != null ? `±${Math.round(mk.accuracyMeters)} m` : tr('(ปักบนแผนที่)', '(placed on map)')}` : tr('ยังไม่มีพิกัด', 'No location yet')}</p>
        <div class="row">
          <button class="btn primary" data-act="gps">📡 ${tr('ใช้ตำแหน่งตอนนี้', 'Use my location')}</button>
          <a class="btn" href="#/pick">🗺️ ${tr('ปักบนแผนที่', 'Pick on map')}</a>
          <button class="btn" data-act="paste">📋 ${tr('วางพิกัด', 'Paste coordinates')}</button>
        </div>
        <p class="small muted">${tr('ยืนตรงจุดนั้นแล้วกด "ใช้ตำแหน่งตอนนี้" แอปจะอ่าน GPS ไม่เกิน 15 วินาที แล้วเลือกค่าที่แม่นที่สุด', 'Stand on the spot and tap "Use my location"; it reads GPS for up to 15 s and keeps the most accurate fix')}</p>
      </div>
      <label class="field">${tr('รายละเอียด', 'Details')}<textarea id="notes" rows="4" placeholder="${esc(M.KINDS[mk.kind].hint())}">${esc(mk.notes)}</textarea></label>
      <div class="photos">${mk.photos.map((ph, i) => `<figure><img data-media="${esc(ph.file)}" alt=""><button class="icon del" data-act="delphoto" data-v="${i}">✕</button></figure>`).join('')}</div>
      <div class="row">
        <label class="btn">📷 ${tr('ถ่ายรูป', 'Take photo')}<input type="file" accept="image/*" capture="environment" hidden class="addphoto"></label>
        <label class="btn">🖼️ ${tr('จากคลังรูป', 'From photos')}<input type="file" accept="image/*" multiple hidden class="addphoto"></label>
      </div>
      <div class="savebar"><button class="btn" data-act="cancel">${tr('ยกเลิก', 'Cancel')}</button><button class="btn primary" data-act="savemark">💾 ${tr('บันทึก', 'Save')}</button></div>
    </main>`,
    mount() {
      const sync = () => { mk.label = document.getElementById('label').value; mk.notes = document.getElementById('notes').value; };
      app.querySelectorAll('input#label, textarea#notes').forEach((el) => el.addEventListener('input', sync));
      app.querySelectorAll('.addphoto').forEach((el) => el.addEventListener('change', async (e) => {
        sync(); mk.photos.push(...await addPhotos([...e.target.files])); render();
      }));
      fillMedia();
    },
  };
};

views.pick = () => {
  if (!editor) return views.home();
  const mk = editor.mark;
  return {
    html: `${header(tr('แตะแผนที่เพื่อปักหมุด', 'Tap the map to place the pin'))}
    <div id="map" class="map full"></div>
    <div class="savebar floating"><button class="btn" data-act="back">${tr('ยกเลิก', 'Cancel')}</button><button class="btn primary" data-act="usepick" disabled id="usepick">✔ ${tr('ใช้จุดนี้', 'Use this point')}</button></div>`,
    mount() {
      map = makeMap(document.getElementById('map'));
      const site = mk.siteId ? siteById(mk.siteId) : null;
      drawMarks(map, site ? M.marksOf(data, site.id) : [], site ? [site] : []);
      if (M.hasLocation(mk)) map.setView([mk.latitude, mk.longitude], 18);
      else if (here) map.setView([here.lat, here.lon], 18);
      let marker = null;
      map.on('click', (e) => {
        editor.pick = { lat: e.latlng.lat, lon: e.latlng.lng };
        marker ??= L.marker(e.latlng, { icon: emojiIcon(M.KINDS[mk.kind].symbol, 'picked') }).addTo(map);
        marker.setLatLng(e.latlng);
        document.getElementById('usepick').disabled = false;
      });
    },
  };
};

views.map = () => ({
  html: `${header(tr('แผนที่ทุกจุด', 'Everything on the map'))}<div id="map" class="map full"></div>`,
  mount() {
    map = makeMap(document.getElementById('map'));
    drawMarks(map, data.marks.filter((m) => !m.draft), data.sites);
    if (here) L.circleMarker([here.lat, here.lon], { radius: 7, color: '#2563eb', fillOpacity: 0.9 }).addTo(map);
  },
});

// เข็มทิศ: iPhone ใช้ webkitCompassHeading · Android ใช้ deviceorientationabsolute
views.find = (id) => {
  const mk = markById(id);
  if (!mk || !M.hasLocation(mk)) return views.home();
  const target = M.pointOf(mk);
  return {
    html: `${header(mk.label)}
    <main class="compass">
      <div class="dial"><div class="arrow" id="arrow">➤</div></div>
      <p class="dist big" id="cdist">—</p>
      <p class="muted" id="chint">${tr('กำลังหาตำแหน่ง…', 'Finding your location…')}</p>
      <button class="btn primary" id="compassbtn">🧭 ${tr('เปิดเข็มทิศ', 'Turn on compass')}</button>
      <p class="small muted">${tr('ถือมือถือให้ราบ หัวเครื่องชี้ไปข้างหน้า · ถ้าลูกศรไม่ตรง ให้หมุนมือถือเป็นเลข 8 สักครั้ง', 'Hold the phone flat, top pointing ahead · if the arrow is off, move the phone in a figure 8')}</p>
      <a class="btn" href="${G.directionsUrl(target)}" target="_blank" rel="noopener">🚗 ${tr('นำทางด้วย Google Maps', 'Directions in Google Maps')}</a>
    </main>`,
    mount() {
      let heading = null, sx = 0, sy = 0, buzzed = false;
      const arrow = document.getElementById('arrow');
      const update = () => {
        if (!here) return;
        const d = G.distanceMeters(here, target), b = G.bearingDegrees(here, target);
        document.getElementById('cdist').textContent = G.formatDistance(d);
        document.getElementById('chint').textContent = d < 3 ? tr('ถึงแล้ว 🎉', 'You are there 🎉') : tr(`GPS ±${Math.round(here.acc)} ม.`, `GPS ±${Math.round(here.acc)} m`);
        // ลูกศร ➤ ชี้ขวาเป็นค่าเริ่มต้น จึงลบ 90°
        const turn = heading == null ? b : G.relativeTurn(heading, b);
        arrow.style.transform = `rotate(${turn - 90}deg)`;
        if (d < 3 && !buzzed) { navigator.vibrate?.([200, 100, 200]); buzzed = true; }
        if (d > 6) buzzed = false;
      };
      const onOrient = (e) => {
        let h = null;
        if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
        else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
        if (h == null) return;
        // ค่าเฉลี่ย sin/cos กันลูกศรสั่น และไม่กระโดดตอนข้าม 0/360
        sx = sx * 0.8 + Math.sin(h * Math.PI / 180) * 0.2; sy = sy * 0.8 + Math.cos(h * Math.PI / 180) * 0.2;
        heading = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
        update();
      };
      const start = async () => {
        try {
          if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
            if (await DeviceOrientationEvent.requestPermission() !== 'granted') { toast(tr('ไม่ได้รับอนุญาตใช้เข็มทิศ', 'Compass permission denied')); return; }
          }
          const ev = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
          window.addEventListener(ev, onOrient);
          cleanups.push(() => window.removeEventListener(ev, onOrient));
          document.getElementById('compassbtn').hidden = true;
        } catch (e) { toast(e.message); }
      };
      document.getElementById('compassbtn').addEventListener('click', start);
      if (typeof DeviceOrientationEvent?.requestPermission !== 'function') start();
      document.addEventListener('here', update); cleanups.push(() => document.removeEventListener('here', update));
      update();
    },
  };
};

views.import = () => {
  if (!incoming) return views.home();
  const d = incoming.data, c = M.conflicts(data, d);
  const photos = d.sites.reduce((s, x) => s + x.deedPhotos.length, 0) + d.marks.reduce((s, x) => s + x.photos.length, 0);
  return {
    html: `${header(tr('รับข้อมูล PinKeep', 'Receive PinKeep data'))}
    <main>
      <div class="card"><b>${esc(incoming.name)}</b>
        <p>${tr(`แปลง ${d.sites.length} · รายการ ${d.marks.length} · รูป ${photos}`, `${d.sites.length} plots · ${d.marks.length} items · ${photos} photos`)}</p>
        <div class="list">${d.sites.map((s) => `<div class="item"><span class="sym">📜</span><span class="txt"><b>${esc(s.name)}</b></span></div>`).join('')}
        ${d.marks.slice(0, 30).map((m) => `<div class="item"><span class="sym">${M.KINDS[m.kind].symbol}</span><span class="txt"><b>${esc(m.label)}</b></span></div>`).join('')}</div>
      </div>
      ${c ? `<div class="warn">${tr(`มี ${c} รายการที่มีอยู่ในเครื่องแล้ว`, `${c} items already exist on this device`)}</div>
        <button class="btn primary wide" data-act="import" data-v="UPDATE">${tr('อัปเดตรายการเดิม', 'Update existing items')}</button>
        <button class="btn wide" data-act="import" data-v="KEEP_BOTH">${tr('เก็บเป็นรายการใหม่ (มีทั้งสอง)', 'Keep both (add as new)')}</button>`
        : `<button class="btn primary wide" data-act="import" data-v="UPDATE">📥 ${tr('นำเข้า', 'Import')}</button>`}
      <button class="btn wide" data-act="cancelimport">${tr('ยกเลิก', 'Cancel')}</button>
    </main>`,
  };
};

// ---------------------------------------------------------------- ปุ่มต่าง ๆ
const actions = {
  back,
  lang: () => { M.setLang(M.getLang() === 'th' ? 'en' : 'th'); document.documentElement.lang = M.getLang(); render(); },
  sort: (v) => { listSort = v; render(); },
  backup: backupAll,
  edit: (id) => startEditor(markById(id), false),
  up: (id) => { movePin(markById(id).siteId, id, -1); save(); render(); },
  down: (id) => { movePin(markById(id).siteId, id, 1); save(); render(); },
  autoorder: () => { const s = siteById(currentArgs()[0]); s.pinOrder = []; s.updatedAt = now(); save(); render(); },
  deldeedphoto: async (i) => { const s = siteById(currentArgs()[0]); s.deedPhotos.splice(Number(i), 1); s.updatedAt = now(); await save(); render(); },
  delsite: async (id) => {
    const s = siteById(id);
    if (!confirm(tr(`ลบแปลง "${s.name}" และทุกรายการในแปลง?`, `Delete plot "${s.name}" and everything in it?`))) return;
    data.sites = data.sites.filter((x) => x.id !== id); data.marks = data.marks.filter((m) => m.siteId !== id);
    await save(); DB.deleteOrphans(M.referencedFiles(data)); go('#/sites');
  },
  delmark: async (id) => {
    const mk = markById(id);
    if (!confirm(tr(`ลบ "${mk.label}"?`, `Delete "${mk.label}"?`))) return;
    data.marks = data.marks.filter((m) => m.id !== id);
    data.sites.forEach((s) => { s.pinOrder = s.pinOrder.filter((p) => p !== id); });
    await save(); DB.deleteOrphans(M.referencedFiles(data)); back();
  },
  sendmark: (id) => { const mk = markById(id); sendItems([], [mk], mk.label); },
  sendsite: (id) => { const s = siteById(id); sendItems([s], [], s.name); },
  sendcat: (kind) => sendItems([], M.standaloneOf(data, kind), `PinKeep ${M.KINDS[kind].label()}`),
  sharetext: async (id) => {
    const mk = markById(id);
    const lines = [`${M.KINDS[mk.kind].symbol} ${mk.label}`, mk.notes, M.hasLocation(mk) ? G.mapsUrl(M.pointOf(mk)) : ''].filter(Boolean);
    const text = lines.join('\n');
    if (navigator.share) { try { await navigator.share({ title: mk.label, text }); } catch { /* ยกเลิก */ } }
    else { await navigator.clipboard?.writeText(text); toast(tr('คัดลอกแล้ว', 'Copied')); }
  },
  gps: async () => {
    const loc = document.getElementById('loc');
    try {
      const fix = await captureGps((best, s) => { loc.textContent = `${tr('กำลังอ่าน GPS', 'Reading GPS')} ${s}s · ±${Math.round(best.acc)} m`; });
      Object.assign(editor.mark, { latitude: fix.lat, longitude: fix.lon, accuracyMeters: Math.round(fix.acc * 10) / 10, manual: false });
      here = fix; render();
    } catch (e) { loc.textContent = e.message; }
  },
  paste: async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* iOS อาจไม่ให้อ่าน */ }
    const typed = prompt(tr('วางพิกัดหรือลิงก์ Google Maps', 'Paste coordinates or a Google Maps link'), text);
    if (typed == null) return;
    const p = G.parseCoordinates(typed);
    if (!p) { toast(tr('อ่านพิกัดไม่ได้', 'Could not read coordinates')); return; }
    Object.assign(editor.mark, { latitude: p.lat, longitude: p.lon, accuracyMeters: null, manual: true });
    render();
  },
  usepick: () => {
    if (!editor?.pick) return;
    Object.assign(editor.mark, { latitude: editor.pick.lat, longitude: editor.pick.lon, accuracyMeters: null, manual: true });
    delete editor.pick; back();
  },
  delphoto: (i) => { editor.mark.photos.splice(Number(i), 1); render(); },
  cancel: () => { const wasNew = editor?.isNew; editor = null; if (wasNew) DB.deleteOrphans(M.referencedFiles(data)); back(); },
  savemark: async () => {
    const mk = editor.mark;
    mk.label = mk.label.trim() || `${M.KINDS[mk.kind].prefix()}`;
    mk.updatedAt = now();
    const i = data.marks.findIndex((m) => m.id === mk.id);
    if (i < 0) data.marks.push(mk); else data.marks[i] = mk;
    if (mk.siteId) { const s = siteById(mk.siteId); if (s) s.updatedAt = now(); }
    const wasNew = editor.isNew;
    editor = null; await save(); DB.deleteOrphans(M.referencedFiles(data));
    toast(tr('บันทึกแล้ว', 'Saved'));
    if (wasNew) location.replace(`#/mark/${mk.id}`); else back();
  },
  import: (mode) => confirmImport(mode),
  cancelimport: () => { incoming = null; go('#/'); },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  e.preventDefault();
  actions[el.dataset.act]?.(el.dataset.v);
});

// ---------------------------------------------------------------- เส้นทาง
const currentArgs = () => location.hash.replace(/^#\/?/, '').split('/').slice(1).map(decodeURIComponent);

function render() {
  cleanups.forEach((f) => f()); cleanups = [];
  if (map) { map.remove(); map = null; }
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const view = views[name || 'home'] || views.home;
  const out = view(...args);
  if (!out.html) return;   // หน้าที่ส่งต่อไปหน้าอื่น เช่น #/new
  app.innerHTML = out.html;
  window.scrollTo(0, 0);
  out.mount?.();
}

window.addEventListener('hashchange', render);
document.addEventListener('here', () => {
  // อัปเดตระยะในรายการเมื่อได้ตำแหน่งครั้งแรก
  if (!document.querySelector('.dist:not(:empty)') && /^#\/?(cat|$)/.test(location.hash || '#/')) {
    if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render();
  }
}, { once: true });

async function init() {
  document.documentElement.lang = M.getLang();
  try {
    const saved = await DB.loadData();
    if (saved) data = { sites: (saved.sites || []).map((s) => ({ ...s })), marks: saved.marks || [] };
  } catch (e) { toast(tr('เปิดข้อมูลในเครื่องไม่ได้: ', 'Cannot open local data: ') + e.message); }
  render();
  watchHere();
  DB.persist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
