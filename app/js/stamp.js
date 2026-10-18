// ประทับข้อความ + QR นำทางลงรูป — แปลงจาก media/Images.kt ของ Android ให้หน้าตาเหมือนกัน
import { formatCoordinates, directionsUrl } from './geo.js';

export const WATERMARK = 'PinKeep Free';
const FONT = '-apple-system, BlinkMacSystemFont, "Leelawadee UI", Tahoma, sans-serif';

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (t) => { const d = new Date(t); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/** ข้อความที่จะประทับ ตามตัวเลือกของรูป */
export function stampLines(opt, title, point, acc, takenAt, notes) {
  if (!opt.enabled) return [];
  const lines = [];
  if (opt.label && title.trim()) lines.push(title);
  if (opt.coordinates && point) lines.push(formatCoordinates(point) + (acc != null ? ` ±${Math.round(acc)} m` : ''));
  if (opt.dateTime) lines.push(fmtDate(takenAt));
  if (opt.notes && notes.trim()) notes.split('\n').filter((l) => l.trim()).slice(0, 6).forEach((l) => lines.push(l.trim()));
  if (opt.customText.trim()) lines.push(opt.customText.slice(0, 60));
  return lines;
}

/** ตาราง QR (true = จุดดำ) ของลิงก์นำทาง — ใช้ qrcode-generator */
export function qrMatrix(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

// ตัดบรรทัด: ตัดตามคำ (Intl.Segmenter รู้จักคำไทย) ถ้าคำเดียวยาวเกินจึงตัดตามตัวอักษร
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
function wrap(ctx, line, maxWidth) {
  if (maxWidth <= 0 || ctx.measureText(line).width <= maxWidth) return [line];
  const words = segmenter ? [...segmenter.segment(line)].map((s) => s.segment) : line.split(/(\s+)/);
  const out = []; let cur = '';
  for (const w of words) {
    if (ctx.measureText(cur + w).width <= maxWidth) { cur += w; continue; }
    if (cur.trim()) out.push(cur.trimEnd());
    cur = w.trimStart();
    // คำเดียวยาวกว่าบรรทัด — ตัดตามตัวอักษร (ไม่แยกสระ/วรรณยุกต์ออกจากพยัญชนะ)
    if (ctx.measureText(cur).width > maxWidth) {
      const chars = graphemes ? [...graphemes.segment(cur)].map((s) => s.segment) : [...cur];
      let piece = '';
      for (const ch of chars) {
        if (ctx.measureText(piece + ch).width > maxWidth && piece) { out.push(piece); piece = ''; }
        piece += ch;
      }
      cur = piece;
    }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

function drawQr(ctx, m, left, top, size) {
  const quiet = 2, cell = size / (m.length + quiet * 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(left, top, size, size);
  ctx.fillStyle = '#000';
  m.forEach((row, r) => row.forEach((on, c) => {
    if (on) ctx.fillRect(left + (c + quiet) * cell, top + (r + quiet) * cell, cell + 0.5, cell + 0.5);
  }));
}

/**
 * วาดรูปพร้อมข้อความตามตัวเลือก — ใช้ทั้งตัวอย่างบนจอและไฟล์ที่แชร์
 * @param img รูปที่โหลดแล้ว (HTMLImageElement หรือ ImageBitmap)
 * @param watermark ข้อความลายน้ำ (รุ่นฟรีใส่เมื่อมี QR) หรือ null
 */
export function render(img, opt, { title = '', point = null, acc = null, takenAt = Date.now(), notes = '', watermark = null } = {}) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const lines = stampLines(opt, title, point, acc, takenAt, notes);
  const qr = opt.enabled && opt.qr && point ? qrMatrix(directionsUrl(point)) : null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!lines.length && !qr) { canvas.width = w; canvas.height = h; ctx.drawImage(img, 0, 0); return canvas; }

  const textSize = Math.max(w, h) * 0.028 * opt.scale;
  const pad = textSize * 0.6, lineHeight = textSize * 1.3;
  const setFont = (c) => { c.font = `bold ${textSize}px ${FONT}`; c.textBaseline = 'alphabetic'; };
  setFont(ctx);
  const text = (wrapped, left, top, color, shadow) => {
    setFont(ctx); ctx.fillStyle = color;
    ctx.shadowColor = shadow ? 'rgba(0,0,0,1)' : 'transparent'; ctx.shadowBlur = shadow ? textSize * 0.16 : 0;
    wrapped.forEach((l, i) => ctx.fillText(l, left, top + textSize * 0.95 + i * lineHeight));
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  };

  if (opt.layout === 'BOTTOM') {
    const qrSize = qr ? Math.min(textSize * 7, w * 0.35) : 0;
    const wrapped = lines.flatMap((l) => wrap(ctx, l, w - pad * 2 - (qr ? qrSize + pad : 0)));
    const panel = Math.max(wrapped.length * lineHeight, qrSize) + pad * 2;
    canvas.width = w; canvas.height = Math.round(h + panel);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, w, h);
    text(wrapped, pad, h + pad, '#141414', false);
    if (qr) drawQr(ctx, qr, w - pad - qrSize, h + pad, qrSize);
  } else if (opt.layout === 'SIDE') {
    const qrWanted = qr ? textSize * 8 : 0;
    const panelWidth = Math.max(textSize * 16, qrWanted + pad * 2);
    const qrSize = Math.min(qrWanted, panelWidth - pad * 2);
    const wrapped = lines.flatMap((l) => wrap(ctx, l, panelWidth - pad * 2));
    const content = wrapped.length * lineHeight + (qr ? (wrapped.length ? pad : 0) + qrSize : 0);
    const height = Math.max(h, content + pad * 2);
    canvas.width = Math.round(w + panelWidth); canvas.height = Math.round(height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, (height - h) / 2, w, h);
    text(wrapped, w + pad, pad, '#141414', false);
    if (qr) drawQr(ctx, qr, w + (panelWidth - qrSize) / 2, pad + wrapped.length * lineHeight + (wrapped.length ? pad : 0), qrSize);
  } else {
    canvas.width = w; canvas.height = h;   // ตั้งขนาด canvas ล้างค่า font — ต้องตั้งใหม่ก่อนวัดข้อความ
    setFont(ctx);
    ctx.drawImage(img, 0, 0, w, h);
    const margin = textSize * 0.6;
    const qrSize = qr ? textSize * 6 : 0;
    const qrGap = qr && lines.length ? pad : 0;
    const wrapped = lines.flatMap((l) => wrap(ctx, l, w - margin * 2 - pad * 2 - qrSize - qrGap));
    const textWidth = wrapped.reduce((mx, l) => Math.max(mx, ctx.measureText(l).width), 0);
    const contentHeight = Math.max(wrapped.length * lineHeight, qrSize);
    const boxW = Math.min(textWidth + qrGap + qrSize + pad * 2, w);
    const boxH = Math.min(contentHeight + pad * 2, h);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const left = margin + Math.max(0, w - boxW - margin * 2) * clamp(opt.x);
    const top = margin + Math.max(0, h - boxH - margin * 2) * clamp(opt.y);
    ctx.fillStyle = 'rgba(0,0,0,0.59)';
    roundRect(ctx, left, top, boxW, boxH, textSize * 0.4); ctx.fill();
    text(wrapped, left + pad, top + pad + (contentHeight - wrapped.length * lineHeight) / 2, '#fff', true);
    if (qr) drawQr(ctx, qr, left + boxW - pad - qrSize, top + pad, qrSize);
  }

  if (qr && watermark) {
    const size = Math.max(canvas.width, canvas.height) * 0.022;
    ctx.font = `bold ${size}px ${FONT}`; ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.78)'; ctx.shadowColor = '#000'; ctx.shadowBlur = size * 0.3;
    ctx.fillText(watermark, canvas.width - size * 0.6, canvas.height - size * 0.6);
    ctx.textAlign = 'left'; ctx.shadowBlur = 0;
  }
  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** โหลด Blob เป็นรูป (ตั้งตรงตาม EXIF — เบราว์เซอร์หมุนให้เอง) */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

export const toJpeg = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
