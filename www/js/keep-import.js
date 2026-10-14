// Imports notes from a Google Takeout export of Google Keep.
// Accepts the Takeout .zip itself, or the extracted .json files (plus their images).
import { uid, newNotificationId, saveImage } from './store.js';

const KEEP_COLORS = {
  DEFAULT: 'default', RED: 'red', ORANGE: 'orange', YELLOW: 'yellow', GREEN: 'green',
  TEAL: 'teal', BLUE: 'blue', CERULEAN: 'cerulean', PURPLE: 'purple', PINK: 'pink',
  BROWN: 'brown', GRAY: 'gray',
};

const baseName = (p) => p.split('/').pop();
const stem = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();
const usecToMs = (v) => (v ? Math.round(Number(v) / 1000) : 0);

function isKeepNote(obj) {
  return obj && typeof obj === 'object' &&
    ('textContent' in obj || 'listContent' in obj) &&
    ('userEditedTimestampUsec' in obj || 'createdTimestampUsec' in obj);
}

// Collects every file from the picked files/zips as { name, path, blob() }.
async function collectEntries(files, onProgress) {
  const entries = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      onProgress?.(`Opening ${file.name}…`);
      const zip = await window.JSZip.loadAsync(file);
      zip.forEach((path, entry) => {
        if (entry.dir) return;
        entries.push({ name: baseName(path), path, text: () => entry.async('string'), blob: () => entry.async('blob') });
      });
    } else {
      entries.push({ name: file.name, path: file.name, text: () => file.text(), blob: async () => file });
    }
  }
  return entries;
}

function findAttachment(byName, byStem, filePath) {
  const name = baseName(filePath || '').toLowerCase();
  // Takeout sometimes lists "x.jpeg" while the file inside the zip is "x.jpg".
  return byName.get(name) || byStem.get(stem(name));
}

export async function importKeep(files, existingNotes, { onProgress } = {}) {
  const entries = await collectEntries(files, onProgress);
  const byName = new Map();
  const byStem = new Map();
  for (const e of entries) {
    byName.set(e.name.toLowerCase(), e);
    if (!/\.(json|html|txt)$/i.test(e.name)) byStem.set(stem(e.name), e);
  }

  const seen = new Set(existingNotes.map((n) => n.importKey).filter(Boolean));
  const result = { notes: [], labels: new Set(), skippedTrashed: 0, duplicates: 0, images: 0, failedImages: 0, skippedAudio: 0 };

  const labelFile = entries.find((e) => e.name === 'Labels.txt' && /keep/i.test(e.path));
  if (labelFile) {
    (await labelFile.text()).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((l) => result.labels.add(l));
  }

  const jsonEntries = entries.filter((e) => /\.json$/i.test(e.name));
  let done = 0;
  for (const entry of jsonEntries) {
    done++;
    if (done % 20 === 0) onProgress?.(`Reading notes… ${done} / ${jsonEntries.length}`);
    let k;
    try {
      k = JSON.parse(await entry.text());
    } catch {
      continue;
    }
    if (!isKeepNote(k)) continue;
    if (k.isTrashed) { result.skippedTrashed++; continue; }

    const importKey = `keep:${stem(entry.name)}:${k.createdTimestampUsec || k.userEditedTimestampUsec}`;
    if (seen.has(importKey)) { result.duplicates++; continue; }
    seen.add(importKey);

    const created = usecToMs(k.createdTimestampUsec) || usecToMs(k.userEditedTimestampUsec) || Date.now();
    const note = {
      id: uid(),
      nid: newNotificationId(),
      importKey,
      type: 'text',
      title: k.title || '',
      text: '',
      items: [],
      color: KEEP_COLORS[k.color] || 'default',
      labels: [],
      images: [],
      pinned: !!k.isPinned,
      archived: !!k.isArchived,
      trashed: false,
      created,
      updated: usecToMs(k.userEditedTimestampUsec) || created,
      reminder: null,
    };

    if (Array.isArray(k.listContent) && k.listContent.length) {
      note.type = 'list';
      note.items = k.listContent.map((i) => ({ id: uid(), text: i.text || '', checked: !!i.isChecked }));
    } else {
      note.text = k.textContent || '';
    }

    for (const a of k.annotations || []) {
      if (a.url && !note.text.includes(a.url) && note.type === 'text') {
        note.text += (note.text ? '\n' : '') + a.url;
      }
    }

    for (const l of k.labels || []) {
      if (l.name) { note.labels.push(l.name); result.labels.add(l.name); }
    }

    for (const att of k.attachments || []) {
      if (!/^image\//.test(att.mimetype || '') && !/\.(jpe?g|png|gif|webp)$/i.test(att.filePath || '')) {
        result.skippedAudio++;
        continue;
      }
      const file = findAttachment(byName, byStem, att.filePath);
      if (!file) { result.failedImages++; continue; }
      try {
        note.images.push(await saveImage(await file.blob()));
        result.images++;
      } catch {
        result.failedImages++;
      }
    }

    result.notes.push(note);
  }

  result.labels = [...result.labels];
  result.foundJson = jsonEntries.length;
  return result;
}
