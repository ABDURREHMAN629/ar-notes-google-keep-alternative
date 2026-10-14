// Persistence. On the phone, notes live in the app's private files folder
// (files/notes.json + files/images/), which Android's Google-account backup
// includes. In a desktop browser (for development) it falls back to localStorage.

const Cap = window.Capacitor;
export const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const FS = isNative ? Cap.Plugins.Filesystem : null;
const DATA = 'DATA';
const DB_FILE = 'notes.json';
const BAK_FILE = 'notes.previous.json';
const LS_DB = 'mynotes.db';
const LS_IMG = 'mynotes.img.';

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function newNotificationId() {
  return 1 + Math.floor(Math.random() * 2147483000);
}

export function emptyDb() {
  return { version: 1, notes: [], labels: [], settings: { view: 'grid' } };
}

function parseDb(text) {
  if (!text) return null;
  try {
    const db = JSON.parse(text);
    if (!db || !Array.isArray(db.notes)) return null;
    db.labels = Array.isArray(db.labels) ? db.labels : [];
    db.settings = { view: 'grid', ...(db.settings || {}) };
    return db;
  } catch {
    return null;
  }
}

async function readText(path) {
  try {
    const r = await FS.readFile({ path, directory: DATA, encoding: 'utf8' });
    return r.data;
  } catch {
    return null;
  }
}

async function writeText(path, data) {
  await FS.writeFile({ path, data, directory: DATA, encoding: 'utf8', recursive: true });
}

export async function loadDb() {
  if (!isNative) return parseDb(localStorage.getItem(LS_DB)) || emptyDb();

  const main = await readText(DB_FILE);
  let db = parseDb(main);
  if (db) {
    // Keep a copy of the last good state in case a later write is interrupted.
    writeText(BAK_FILE, main).catch(() => {});
    return db;
  }
  db = parseDb(await readText(BAK_FILE));
  return db || emptyDb();
}

// Writes are serialized so a slow write can never land after a newer one.
let writeChain = Promise.resolve();
export function saveDb(db) {
  const text = JSON.stringify(db);
  writeChain = writeChain
    .then(() => (isNative ? writeText(DB_FILE, text) : localStorage.setItem(LS_DB, text)))
    .catch((e) => console.error('Save failed', e));
  return writeChain;
}

// ---------- Images ----------

let dataDirUri = null;
const webImages = new Map();

export async function initImages() {
  if (isNative) {
    const r = await FS.getUri({ path: '', directory: DATA });
    dataDirUri = r.uri.replace(/\/$/, '');
  }
}

export function imageSrc(path) {
  if (isNative) return Cap.convertFileSrc(`${dataDirUri}/${path}`);
  if (!webImages.has(path)) webImages.set(path, localStorage.getItem(LS_IMG + path) || '');
  return webImages.get(path);
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); };
    img.src = url;
  });
}

// Shrinks the picture to at most 1600px and stores it as JPEG, so the whole
// note collection stays small enough for Android's 25 MB backup limit.
export async function saveImage(blob) {
  const img = await loadImage(blob);
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const path = `images/${uid()}.jpg`;
  await writeImageBase64(path, dataUrl.split(',')[1]);
  return { path, w, h };
}

export async function writeImageBase64(path, base64) {
  if (isNative) {
    await FS.writeFile({ path, data: base64, directory: DATA, recursive: true });
  } else {
    const url = 'data:image/jpeg;base64,' + base64;
    webImages.set(path, url);
    try { localStorage.setItem(LS_IMG + path, url); } catch { /* quota: keep in memory only */ }
  }
}

export async function readImageBase64(path) {
  if (isNative) {
    try {
      return (await FS.readFile({ path, directory: DATA })).data;
    } catch {
      return null;
    }
  }
  const url = imageSrc(path);
  return url ? url.split(',')[1] : null;
}

export async function deleteImage(path) {
  if (isNative) {
    await FS.deleteFile({ path, directory: DATA }).catch(() => {});
  } else {
    webImages.delete(path);
    localStorage.removeItem(LS_IMG + path);
  }
}

// ---------- Backup files ----------

// Writes a file to the cache folder and returns its URI (for the share sheet).
export async function writeCacheFile(name, text) {
  const r = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  return r.uri;
}
