// ที่เก็บในเบราว์เซอร์: IndexedDB — "kv" เก็บข้อมูลแอป (JSON) · "media" เก็บรูป/เสียงเป็น Blob ตามชื่อไฟล์
const DB_NAME = 'pinkeep';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const loadData = () => run('kv', 'readonly', (s) => s.get('data'));
export const saveData = (data) => run('kv', 'readwrite', (s) => s.put(data, 'data'));
export const getMedia = (name) => run('media', 'readonly', (s) => s.get(name));
export const putMedia = (name, blob) => run('media', 'readwrite', (s) => s.put(blob, name));
export const mediaNames = () => run('media', 'readonly', (s) => s.getAllKeys());

/** ลบไฟล์ที่ไม่มีรายการไหนอ้างถึงแล้ว */
export async function deleteOrphans(keep) {
  const names = await mediaNames();
  const orphans = names.filter((n) => !keep.has(n));
  if (orphans.length) await run('media', 'readwrite', (s) => { orphans.forEach((n) => s.delete(n)); return null; });
  return orphans.length;
}

/** ขอให้เบราว์เซอร์ไม่ลบข้อมูลเองเมื่อพื้นที่เหลือน้อย */
export async function persist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
