// แคชไฟล์แอปให้เปิดได้แม้ไม่มีเน็ต · แก้ไฟล์แอปแล้วต้องเปลี่ยน CACHE ไม่งั้นเครื่องผู้ใช้ยังได้ไฟล์เก่า
const CACHE = 'pinkeep-web-0.1.0';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/model.js', 'js/geo.js', 'js/db.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// ไฟล์แอป: ใช้แคชก่อน · แผ่นแผนที่: ใช้เน็ต (ไม่เก็บ เพราะเยอะและเปลี่ยนตามตำแหน่ง)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('arcgisonline') || url.hostname.includes('openstreetmap')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
