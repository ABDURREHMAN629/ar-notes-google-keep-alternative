import { icon } from './icons.js';
import * as store from './store.js';
import { isNative, uid, newNotificationId } from './store.js';
import * as native from './native.js';
import { importKeep } from './keep-import.js';

const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'cerulean', 'purple', 'pink', 'brown', 'gray'];
const COLOR_NAMES = {
  default: 'Default', red: 'Coral', orange: 'Peach', yellow: 'Sand', green: 'Mint', teal: 'Sage',
  blue: 'Fog', cerulean: 'Storm', purple: 'Dusk', pink: 'Blossom', brown: 'Clay', gray: 'Chalk',
};
const PATTERNS = ['none', 'dots', 'grid', 'lines', 'stripes', 'waves', 'bubbles'];
const PATTERN_NAMES = { none: 'None', dots: 'Dots', grid: 'Grid', lines: 'Lined', stripes: 'Stripes', waves: 'Waves', bubbles: 'Bubbles' };
// Each preview is drawn with fixed colors so every tile shows its own style.
const THEMES = [
  { id: 'modern', name: 'Modern', desc: 'Soft & rounded', bg: '#f4f5f9', radius: 9, cards: ['#ffffff', '#fff1b5', '#d9e8ff'], shadow: '0 2px 6px rgba(20,24,40,.12)' },
  { id: 'aurora', name: 'Aurora', desc: 'Colorful glass', bg: 'radial-gradient(at 10% 10%,#ffd3ee,transparent 60%),radial-gradient(at 90% 10%,#c9defe,transparent 60%),radial-gradient(at 70% 90%,#d9cbff,transparent 60%),#eef0ff', radius: 10, cards: ['rgba(255,255,255,.6)', 'rgba(255,236,140,.6)', 'rgba(168,204,255,.65)'], border: '1px solid rgba(255,255,255,.8)' },
  { id: 'paper', name: 'Paper', desc: 'Warm sticky notes', bg: '#efe8dc', radius: 2, cards: ['#fffcf5', '#fce893', '#f7c6ba'], shadow: '0 3px 6px -2px rgba(60,40,10,.35)', tilt: true },
  { id: 'midnight', name: 'Midnight', desc: 'Dark neon', bg: 'radial-gradient(at 50% 0%,rgba(0,229,255,.18),transparent 70%),#05060a', radius: 8, cards: ['#0e1017', '#0e1017', '#0e1017'], borders: ['#3a4257', '#ffd23f', '#ff6ad5'] },
  { id: 'classic', name: 'Classic', desc: 'Like Google Keep', bg: '#ffffff', radius: 4, cards: ['#ffffff', '#fff8b8', '#d4e4ed'], border: '1px solid #e0e0e0' },
];
const TRASH_DAYS = 7;
const DAY = 86400000;

let db;
const ui = { view: { type: 'notes' }, searching: false, query: '', selected: new Set(), drawerOpen: false };
let editor = null; // { note, isNew, doneCollapsed }

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorVar = (c) => `var(--c-${COLORS.includes(c) ? c : 'default'})`;
const pad = (n) => String(n).padStart(2, '0');

function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}

// ---------- Saving ----------

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
function flushSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  store.saveDb(db);
}

// ---------- Notes ----------

function blankNote(type = 'text') {
  const now = Date.now();
  return {
    id: uid(), nid: newNotificationId(), type, title: '', text: '',
    items: type === 'list' ? [{ id: uid(), text: '', checked: false }] : [],
    color: 'default', labels: [], images: [], pinned: false, archived: false, trashed: false,
    created: now, updated: now, reminder: null,
  };
}

function normalizeNote(n) {
  n.title ??= ''; n.text ??= ''; n.items ??= []; n.labels ??= []; n.images ??= [];
  n.color ??= 'default'; n.type ??= n.items.length ? 'list' : 'text';
  n.nid ??= newNotificationId();
  return n;
}

const isEmpty = (n) => !n.title.trim() && !n.text.trim() && !n.items.some((i) => i.text.trim()) && !n.images.length && !n.reminder;
const findNote = (id) => db.notes.find((n) => n.id === id);

function nextOccurrence(r, now = Date.now()) {
  if (!r.repeat || r.repeat === 'none' || r.at > now) return r.at;
  const d = new Date(r.at);
  while (d.getTime() <= now) {
    if (r.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (r.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (r.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
  }
  return d.getTime();
}
const reminderPast = (r) => (!r.repeat || r.repeat === 'none') && r.at <= Date.now();

async function deleteForever(notes) {
  for (const n of notes) {
    native.cancelReminder(n);
    n.images.forEach((img) => store.deleteImage(img.path));
  }
  const ids = new Set(notes.map((n) => n.id));
  db.notes = db.notes.filter((n) => !ids.has(n.id));
  persist();
}

function moveToTrash(notes) {
  const prev = notes.map((n) => ({ n, pinned: n.pinned }));
  for (const n of notes) {
    n.trashed = true; n.trashedAt = Date.now(); n.pinned = false;
    native.cancelReminder(n);
  }
  persist(); render();
  toast(notes.length > 1 ? `${notes.length} notes moved to Trash` : 'Note moved to Trash', 'Undo', () => {
    for (const { n, pinned } of prev) { n.trashed = false; n.pinned = pinned; delete n.trashedAt; native.scheduleReminder(n); }
    persist(); render();
  });
}

function restoreFromTrash(notes) {
  for (const n of notes) { n.trashed = false; delete n.trashedAt; native.scheduleReminder(n); }
  persist(); render();
  toast(notes.length > 1 ? `${notes.length} notes restored` : 'Note restored');
}

function setArchived(notes, archived) {
  const prev = notes.map((n) => ({ n, archived: n.archived, pinned: n.pinned }));
  for (const n of notes) { n.archived = archived; if (archived) n.pinned = false; }
  persist(); render();
  const what = notes.length > 1 ? `${notes.length} notes` : 'Note';
  toast(`${what} ${archived ? 'archived' : 'unarchived'}`, 'Undo', () => {
    for (const p of prev) { p.n.archived = p.archived; p.n.pinned = p.pinned; }
    persist(); render();
  });
}

function copyNote(n) {
  const copy = normalizeNote(JSON.parse(JSON.stringify(n)));
  Object.assign(copy, { id: uid(), nid: newNotificationId(), created: Date.now(), updated: Date.now(), reminder: null, importKey: undefined });
  copy.items = copy.items.map((i) => ({ ...i, id: uid() }));
  // Images are shared by path; give the copy its own files so deleting one note can't break the other.
  copy.images = [];
  db.notes.push(copy);
  Promise.all(n.images.map(async (img) => {
    const data = await store.readImageBase64(img.path);
    if (!data) return null;
    const path = `images/${uid()}.jpg`;
    await store.writeImageBase64(path, data);
    return { ...img, path };
  })).then((imgs) => { copy.images = imgs.filter(Boolean); persist(); render(); });
  persist();
  return copy;
}

function emptyOldTrash() {
  const cutoff = Date.now() - TRASH_DAYS * DAY;
  const old = db.notes.filter((n) => n.trashed && (n.trashedAt || 0) < cutoff);
  if (old.length) deleteForever(old);
}

// ---------- Formatting ----------

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function dayLabel(d) {
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

function reminderLabel(r) {
  const d = new Date(nextOccurrence(r));
  return `${dayLabel(d)}, ${fmtTime(d)}`;
}

function editedLabel(ts) {
  const d = new Date(ts);
  const label = dayLabel(d);
  return label === 'Today' ? `Edited ${fmtTime(d)}` : `Edited ${label}`;
}

// ---------- Filtering ----------

function matchesQuery(n, q) {
  const hay = [n.title, n.text, ...n.items.map((i) => i.text), ...n.labels].join('\n').toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function visibleNotes() {
  const v = ui.view;
  const q = ui.query.trim().toLowerCase();
  let list;
  if (ui.searching) list = q ? db.notes.filter((n) => !n.trashed && matchesQuery(n, q)) : [];
  else if (v.type === 'notes') list = db.notes.filter((n) => !n.trashed && !n.archived);
  else if (v.type === 'reminders') list = db.notes.filter((n) => !n.trashed && n.reminder);
  else if (v.type === 'archive') list = db.notes.filter((n) => !n.trashed && n.archived);
  else if (v.type === 'trash') list = db.notes.filter((n) => n.trashed);
  else list = db.notes.filter((n) => !n.trashed && n.labels.includes(v.name));

  if (v.type === 'reminders' && !ui.searching) list.sort((a, b) => nextOccurrence(a.reminder) - nextOccurrence(b.reminder));
  else if (v.type === 'trash') list.sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  else list.sort((a, b) => b.created - a.created);
  return list;
}

function sections(notes) {
  if (ui.searching || ui.view.type === 'trash' || ui.view.type === 'archive') return [{ notes }];
  if (ui.view.type === 'reminders') {
    const upcoming = notes.filter((n) => !reminderPast(n.reminder));
    const past = notes.filter((n) => reminderPast(n.reminder)).reverse();
    return [{ title: past.length && upcoming.length ? 'Upcoming' : '', notes: upcoming }, { title: 'Sent', notes: past }];
  }
  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);
  if (!pinned.length) return [{ notes: others }];
  return [{ title: 'Pinned', notes: pinned }, { title: others.length ? 'Others' : '', notes: others }];
}

// ---------- Rendering: top bar, drawer, bottom bar ----------

function viewTitle() {
  const v = ui.view;
  return { notes: 'Notes', reminders: 'Reminders', archive: 'Archive', trash: 'Trash' }[v.type] || v.name;
}

function renderTopbar() {
  const bar = $('#topbar');
  const viewBtn = `<button class="icon-btn" data-act="toggle-view" aria-label="Change layout">${icon(db.settings.view === 'grid' ? 'listView' : 'grid')}</button>`;
  if (ui.selected.size) {
    const sel = selectedNotes();
    const allPinned = sel.every((n) => n.pinned);
    const inTrash = ui.view.type === 'trash';
    bar.innerHTML = `<div class="selectbar">
      <button class="icon-btn on" data-act="sel-clear" aria-label="Cancel">${icon('close')}</button>
      <div class="count">${ui.selected.size}</div>
      ${inTrash ? `
        <button class="icon-btn on" data-act="sel-restore" aria-label="Restore">${icon('restore')}</button>
        <button class="icon-btn on" data-act="sel-delete-forever" aria-label="Delete forever">${icon('deleteForever')}</button>` : `
        <button class="icon-btn on" data-act="sel-pin" aria-label="Pin">${icon(allPinned ? 'pinFilled' : 'pin')}</button>
        <button class="icon-btn on" data-act="sel-color" aria-label="Color">${icon('palette')}</button>
        <button class="icon-btn on" data-act="sel-archive" aria-label="Archive">${icon(ui.view.type === 'archive' ? 'unarchive' : 'archive')}</button>
        <button class="icon-btn on" data-act="sel-more" aria-label="More">${icon('more')}</button>`}
    </div>`;
  } else if (ui.searching) {
    bar.innerHTML = `<div class="searchbar">
      <button class="icon-btn" data-act="search-close" aria-label="Back">${icon('back')}</button>
      <input id="search" type="search" placeholder="Search your notes" enterkeyhint="search" autocomplete="off" value="${esc(ui.query)}">
      <button class="icon-btn" data-act="search-clear" aria-label="Clear" ${ui.query ? '' : 'hidden'}>${icon('close')}</button>
    </div>`;
  } else if (ui.view.type === 'notes') {
    bar.innerHTML = `<div class="searchbar">
      <button class="icon-btn" data-act="drawer" aria-label="Menu">${icon('menu')}</button>
      <input readonly data-act="search-open" placeholder="Search your notes" aria-label="Search your notes">
      ${viewBtn}
    </div>`;
  } else {
    bar.innerHTML = `<div class="titlebar">
      <button class="icon-btn" data-act="drawer" aria-label="Menu">${icon('menu')}</button>
      <h1>${esc(viewTitle())}</h1>
      <button class="icon-btn" data-act="search-open" aria-label="Search">${icon('search')}</button>
      ${viewBtn}
    </div>`;
  }
}

function renderDrawer() {
  const v = ui.view;
  const item = (type, ic, label, extra = '') => {
    const active = !ui.searching && v.type === type && (type !== 'label' || v.name === extra);
    return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${type}" data-name="${esc(extra)}">${icon(ic)}<span>${esc(label)}</span></button>`;
  };
  $('#drawer').innerHTML = `
    <div class="drawer-brand"><div class="logo"><svg viewBox="36 30 36 48" width="20" height="26" aria-hidden="true">
      <path fill="#fff" d="M38,32 H62 L72,42 V74 Q72,76 70,76 H38 Q36,76 36,74 V34 Q36,32 38,32 Z"/>
      <path fill="#FFE08A" d="M62,32 V40 Q62,42 64,42 H72 Z"/>
      <path fill="#F29900" d="M42,50 H66 V53.5 H42 Z M42,58 H66 V61.5 H42 Z M42,66 H58 V69.5 H42 Z"/></svg></div>AR Notes</div>
    ${item('notes', 'bulb', 'Notes')}
    ${item('reminders', 'bell', 'Reminders')}
    <div class="nav-sep"></div>
    ${db.labels.length ? `<div class="nav-head"><span>Labels</span></div>` : ''}
    ${db.labels.map((l) => item('label', 'label', l, l)).join('')}
    <button class="nav-item" data-act="edit-labels">${icon('edit')}<span>${db.labels.length ? 'Edit labels' : 'Create new label'}</span></button>
    <div class="nav-sep"></div>
    ${item('archive', 'archive', 'Archive')}
    ${item('trash', 'trash', 'Trash')}
    <div class="nav-sep"></div>
    <button class="nav-item" data-act="appearance">${icon('palette')}<span>Appearance</span></button>
    <button class="nav-item" data-act="import-keep">${icon('download')}<span>Import from Google Keep</span></button>
    <button class="nav-item" data-act="backup">${icon('cloud')}<span>Backup &amp; restore</span></button>
  `;
}

function renderBottombar() {
  const show = !ui.searching && !ui.selected.size && ['notes', 'label', 'reminders'].includes(ui.view.type);
  const bar = $('#bottombar');
  bar.hidden = !show;
  if (!show) return;
  bar.innerHTML = `
    <button class="take-note" data-act="new-note">Take a note…</button>
    <button class="icon-btn" data-act="new-list" aria-label="New list">${icon('checklist')}</button>
    <button class="icon-btn" data-act="new-image" aria-label="New note with image">${icon('image')}</button>
    <div class="grow"></div>
    <button class="fab" data-act="new-note" aria-label="New note">${icon('add')}</button>`;
}

// ---------- Appearance ----------

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const theme = THEMES.some((t) => t.id === db.settings.theme) ? db.settings.theme : 'modern';
  const mode = db.settings.mode || 'system';
  const dark = theme === 'midnight' || mode === 'dark' || (mode === 'system' && darkQuery.matches);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', dark);
  native.setStatusBarDark(dark);
}

function themePreview(t) {
  const cards = t.cards.map((c, i) => {
    const border = t.borders ? `1px solid ${t.borders[i]}` : t.border || 'none';
    const tilt = t.tilt ? `transform:rotate(${i % 2 ? 1.5 : -1.5}deg);` : '';
    return `<i style="background:${c};border:${border};border-radius:${t.radius}px;box-shadow:${t.shadow || 'none'};${tilt}"></i>`;
  }).join('');
  return `<div class="pv" style="background:${t.bg}">${cards}</div>`;
}

function appearanceDialog() {
  const d = openDialog(`
    <h2>Appearance</h2>
    <p>Choose a style for the whole app.</p>
    <div class="themes"></div>
    <h3 style="margin:0 0 8px;font-size:13px;color:var(--muted)">Light or dark</h3>
    <div class="segmented"></div>
    <div class="actions"><button class="text-btn" data-close>Done</button></div>`);
  const draw = () => {
    const theme = document.documentElement.dataset.theme;
    const mode = db.settings.mode || 'system';
    d.el.querySelector('.themes').innerHTML = THEMES.map((t) => `
      <button class="theme-tile ${t.id === theme ? 'on' : ''}" data-theme-id="${t.id}">
        ${themePreview(t)}<b>${t.name}</b><small>${t.desc}</small>
      </button>`).join('');
    const locked = theme === 'midnight';
    d.el.querySelector('.segmented').innerHTML = [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]
      .map(([m, label]) => `<button data-mode="${m}" class="${!locked && m === mode ? 'on' : ''}${locked && m === 'dark' ? 'on' : ''}" ${locked ? 'disabled' : ''}>${label}</button>`).join('');
  };
  d.el.addEventListener('click', (e) => {
    const tile = e.target.closest('[data-theme-id]');
    const modeBtn = e.target.closest('[data-mode]');
    if (tile) db.settings.theme = tile.dataset.themeId;
    else if (modeBtn) db.settings.mode = modeBtn.dataset.mode;
    else return;
    applyTheme();
    persist();
    render();
    draw();
  });
  draw();
}

function setDrawer(open) {
  ui.drawerOpen = open;
  $('#drawer').classList.toggle('open', open);
  $('#scrim').hidden = !open;
}

// ---------- Rendering: notes ----------

function columnCount() {
  if (db.settings.view === 'list') return 1;
  const w = $('#main').clientWidth;
  return w < 600 ? 2 : w < 900 ? 3 : w < 1200 ? 4 : 5;
}

function estimateHeight(n, colW) {
  const inner = Math.max(60, colW - 28);
  const cpl = inner / 7.4;
  let h = 24;
  if (n.images.length === 1) h += colW * (n.images[0].h / n.images[0].w || 0.75);
  else if (n.images.length > 1) h += Math.ceil(Math.min(n.images.length, 4) / 2) * (colW / 2);
  if (n.title) h += Math.ceil(n.title.length / (inner / 9)) * 23 + 6;
  if (n.type === 'list') {
    const shown = n.items.filter((i) => !i.checked).slice(0, 8);
    h += shown.reduce((s, i) => s + Math.ceil((i.text.length || 1) / (cpl - 4)) * 20, 0);
    if (n.items.length > shown.length) h += 20;
  } else if (n.text) {
    const lines = n.text.split('\n').reduce((s, p) => s + Math.max(1, Math.ceil(p.length / cpl)), 0);
    h += Math.min(lines, 11) * 20;
  }
  if (n.reminder || n.labels.length) h += 34;
  return h;
}

function cardHtml(n) {
  const imgs = n.images.slice(0, 4);
  const imgHtml = imgs.length
    ? `<div class="card-images ${imgs.length > 1 ? 'multi' : ''}">${imgs.map((im) =>
      `<img loading="lazy" src="${esc(store.imageSrc(im.path))}" width="${im.w || 400}" height="${im.h || 300}" alt="">`).join('')}</div>`
    : '';
  let body = '';
  if (n.title) body += `<h3 class="card-title">${esc(n.title)}</h3>`;
  if (n.type === 'list') {
    const unchecked = n.items.filter((i) => !i.checked && i.text.trim());
    const checked = n.items.filter((i) => i.checked && i.text.trim());
    const shown = unchecked.slice(0, 8);
    let li = shown.map((i) => `<li>${icon('boxBlank', 'sm')}<span>${esc(i.text)}</span></li>`).join('');
    if (!shown.length && checked.length) li = checked.slice(0, 3).map((i) => `<li class="done">${icon('boxChecked', 'sm')}<span>${esc(i.text)}</span></li>`).join('');
    const hidden = unchecked.length - shown.length;
    const extra = [hidden > 0 ? `+${hidden} more` : '', checked.length && shown.length ? `+${checked.length} checked item${checked.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
    if (li) body += `<ul class="card-list">${li}${extra ? `<li class="more">${extra}</li>` : ''}</ul>`;
  } else if (n.text.trim()) {
    const big = !n.title && !n.images.length && n.text.length < 50 && !n.text.includes('\n');
    body += `<div class="card-text ${big ? 'big' : ''}">${esc(n.text.length > 1200 ? n.text.slice(0, 1200) + '…' : n.text)}</div>`;
  }
  const chips = [];
  if (n.reminder) {
    const rep = n.reminder.repeat && n.reminder.repeat !== 'none';
    chips.push(`<span class="chip ${reminderPast(n.reminder) ? 'past' : ''}">${icon(rep ? 'repeat' : 'clock', 'xs')}<span>${esc(reminderLabel(n.reminder))}</span></span>`);
  }
  n.labels.slice(0, 3).forEach((l) => chips.push(`<span class="chip">${esc(l)}</span>`));
  if (n.labels.length > 3) chips.push(`<span class="chip">+${n.labels.length - 3}</span>`);
  if (chips.length) body += `<div class="chips">${chips.join('')}</div>`;
  if (!body && !imgHtml) body = `<div class="card-text" style="color:var(--muted)">Empty note</div>`;
  const sel = ui.selected.has(n.id) ? 'selected' : '';
  const pat = PATTERNS.includes(n.pattern) && n.pattern !== 'none' ? ` data-pat="${n.pattern}"` : '';
  return `<article class="card ${sel}" data-id="${n.id}" data-color="${esc(n.color)}"${pat} style="--note-bg:${colorVar(n.color)}">${imgHtml}<div class="card-body">${body}</div></article>`;
}

function masonryHtml(notes) {
  const cols = columnCount();
  const width = $('#main').clientWidth - 16;
  const colW = (width - (cols - 1) * 8) / cols;
  const heights = new Array(cols).fill(0);
  const buckets = Array.from({ length: cols }, () => []);
  for (const n of notes) {
    const i = heights.indexOf(Math.min(...heights));
    buckets[i].push(cardHtml(n));
    heights[i] += estimateHeight(n, colW) + 8;
  }
  return `<div class="masonry">${buckets.map((b) => `<div class="col">${b.join('')}</div>`).join('')}</div>`;
}

function emptyHtml() {
  if (ui.searching) {
    return `<div class="empty">${icon('search')}<div>${ui.query.trim() ? 'No matching notes' : 'Search titles, text, checklists and labels'}</div></div>`;
  }
  const v = ui.view.type;
  const map = {
    notes: ['bulb', 'Notes you add appear here'],
    reminders: ['bell', 'Notes with reminders appear here'],
    archive: ['archive', 'Your archived notes appear here'],
    trash: ['trash', 'No notes in Trash'],
    label: ['label', 'No notes with this label yet'],
  };
  const [ic, text] = map[v];
  const importBtn = v === 'notes' && !db.notes.length
    ? `<button class="text-btn" data-act="import-keep">Import your notes from Google Keep</button>` : '';
  return `<div class="empty">${icon(ic)}<div>${text}</div>${importBtn}</div>`;
}

function renderMain() {
  document.body.classList.toggle('list-mode', db.settings.view === 'list');
  const main = $('#main');
  const notes = visibleNotes();
  let html = '';
  if (ui.view.type === 'notes' && !ui.searching) {
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const count = db.notes.filter((n) => !n.trashed && !n.archived).length;
    html += `<header class="page-head"><p>${greet}</p><h1>AR Notes${count ? `<small>${count} note${count === 1 ? '' : 's'}</small>` : ''}</h1></header>`;
  }
  if (ui.view.type === 'trash' && !ui.searching) {
    html += `<div class="banner"><span>Notes in Trash are deleted after ${TRASH_DAYS} days.</span>${notes.length ? '<button class="text-btn" data-act="empty-trash">Empty Trash</button>' : ''}</div>`;
  }
  if (!notes.length) {
    main.innerHTML = html + emptyHtml();
    return;
  }
  for (const s of sections(notes)) {
    if (!s.notes.length) continue;
    if (s.title) html += `<div class="section-title">${s.title}</div>`;
    html += masonryHtml(s.notes);
  }
  main.innerHTML = html;
}

function render() {
  renderTopbar();
  renderMain();
  renderBottombar();
  renderDrawer();
}

// ---------- Card interaction (tap / long-press to select) ----------

function selectedNotes() {
  return [...ui.selected].map(findNote).filter(Boolean);
}

function toggleSelect(id) {
  if (ui.selected.has(id)) ui.selected.delete(id);
  else ui.selected.add(id);
  const card = $(`.card[data-id="${id}"]`);
  card?.classList.toggle('selected', ui.selected.has(id));
  renderTopbar();
  renderBottombar();
}

function clearSelection() {
  ui.selected.clear();
  render();
}

function bindCards() {
  const main = $('#main');
  let press = null;
  main.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    press = { id, x: e.clientX, y: e.clientY, long: false };
    press.timer = setTimeout(() => {
      press.long = true;
      navigator.vibrate?.(15);
      toggleSelect(id);
    }, 480);
  });
  main.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); if (!press.long) press = null; }
  });
  const end = () => press && clearTimeout(press.timer);
  main.addEventListener('pointerup', end);
  main.addEventListener('pointercancel', () => { end(); press = null; });
  main.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
  main.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    if (press?.long) { press = null; return; }
    press = null;
    if (ui.selected.size) toggleSelect(card.dataset.id);
    else openEditor(findNote(card.dataset.id));
  });
}

// ---------- Layers: menus, sheets, dialogs ----------

const layers = [];
function pushLayer(el, onClose) {
  $('#overlay-root').append(el);
  const layer = { el, onClose };
  layers.push(layer);
  return () => closeLayer(layer);
}
function closeLayer(layer) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  layer.el.remove();
  layer.onClose?.();
}
function closeTopLayer() {
  const top = layers[layers.length - 1];
  if (!top) return false;
  closeLayer(top);
  return true;
}

function showMenu(anchor, items) {
  const layer = h('div', 'menu-layer');
  const menu = h('div', 'menu');
  layer.append(menu);
  const close = pushLayer(layer);
  for (const it of items.filter(Boolean)) {
    const b = h('button', '', `${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>`);
    b.onclick = () => { close(); it.onClick(); };
    menu.append(b);
  }
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
  const top = r.bottom + mh + 8 < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - mh - 4);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function openDialog(html, onClose) {
  const layer = h('div', 'dialog-layer');
  const box = h('div', 'dialog', html);
  layer.append(box);
  const close = pushLayer(layer, onClose);
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  return { el: box, close };
}

function openSheet(html, onClose) {
  const layer = h('div', 'sheet-layer');
  const box = h('div', 'sheet', html);
  layer.append(box);
  const close = pushLayer(layer, onClose);
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  return { el: box, close };
}

function confirmDialog(title, text, okLabel, onOk) {
  const d = openDialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="actions"><button class="text-btn" data-close>Cancel</button><button class="text-btn danger" data-ok>${esc(okLabel)}</button></div>`);
  d.el.querySelector('[data-ok]').onclick = () => { d.close(); onOk(); };
}

let toastTimer;
function toast(msg, actionLabel, onAction) {
  const bar = $('#snackbar');
  bar.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  bar.hidden = false;
  if (actionLabel) bar.querySelector('button').onclick = () => { bar.hidden = true; onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (bar.hidden = true), actionLabel ? 6000 : 3000);
}

// ---------- Color / reminder / label pickers ----------

// Bottom sheet for a note's color and background pattern. `current` is
// { color, pattern } (either may be null when several notes differ).
function styleSheet(current, onChange) {
  let { color, pattern } = current;
  const draw = () => {
    s.el.querySelector('.swatches').innerHTML = COLORS.map((c) => `<button class="swatch ${c === color ? 'on' : ''}" data-color="${c}" style="--sw:${colorVar(c)}" aria-label="${COLOR_NAMES[c]}">
      ${c === color ? icon('check') : c === 'default' ? icon('noColor') : ''}</button>`).join('');
    s.el.querySelector('.patterns').innerHTML = PATTERNS.map((p) => `<button class="pattern ${p === (pattern || 'none') ? 'on' : ''}" data-pattern="${p}"
      ${p === 'none' ? '' : `data-pat="${p}"`} style="--sw:${colorVar(color || 'default')}">${PATTERN_NAMES[p]}</button>`).join('');
  };
  const s = openSheet(`<h3>Color</h3><div class="swatches"></div><h3>Background</h3><div class="patterns"></div>`);
  s.el.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    const pt = e.target.closest('[data-pattern]');
    if (sw) { color = sw.dataset.color; onChange({ color }); }
    else if (pt) { pattern = pt.dataset.pattern; onChange({ pattern }); }
    else return;
    draw();
  });
  draw();
}

function reminderDialog(current, onSave) {
  const now = new Date();
  const at = (days, hour, minute = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, minute, 0, 0); return d; };
  const quick = [];
  if (now.getHours() < 17) quick.push(['Later today', at(0, 18)]);
  else if (now.getHours() < 19) quick.push(['Tonight', at(0, 20)]);
  quick.push(['Tomorrow', at(1, 8)]);
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  quick.push(['Next week', at(toMonday, 8)]);

  const start = current ? new Date(nextOccurrence(current)) : at(1, 8);
  const dateVal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const timeVal = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const repeat = current?.repeat || 'none';
  const opt = (v, l) => `<option value="${v}" ${repeat === v ? 'selected' : ''}>${l}</option>`;

  const d = openDialog(`
    <h2>${current ? 'Edit reminder' : 'Add reminder'}</h2>
    <div class="quick">${quick.map(([l, dt], i) => `<button data-quick="${i}"><span>${l}</span><span>${dt.toLocaleDateString([], { weekday: 'short' })}, ${fmtTime(dt)}</span></button>`).join('')}</div>
    <div class="row2">
      <div class="field"><label>Date</label><input type="date" id="r-date" value="${dateVal}"></div>
      <div class="field"><label>Time</label><input type="time" id="r-time" value="${timeVal}"></div>
    </div>
    <div class="field"><label>Repeat</label><select id="r-repeat">
      ${opt('none', 'Does not repeat')}${opt('daily', 'Daily')}${opt('weekly', 'Weekly')}${opt('monthly', 'Monthly')}${opt('yearly', 'Yearly')}
    </select></div>
    <p id="r-error" hidden style="color:#d93025"></p>
    <div class="actions">
      ${current ? '<button class="text-btn danger left" data-remove>Delete</button>' : ''}
      <button class="text-btn" data-close>Cancel</button>
      <button class="text-btn" data-save>Save</button>
    </div>`);

  const finish = async (reminder) => {
    if (reminder && !(await native.ensureReminderPermission())) {
      toast('Notifications are blocked. Allow them for AR Notes in phone Settings to get reminders.');
    }
    d.close();
    onSave(reminder);
  };
  d.el.querySelectorAll('[data-quick]').forEach((b) => {
    b.onclick = () => finish({ at: quick[+b.dataset.quick][1].getTime(), repeat: 'none' });
  });
  d.el.querySelector('[data-save]').onclick = () => {
    const date = d.el.querySelector('#r-date').value;
    const time = d.el.querySelector('#r-time').value;
    const rep = d.el.querySelector('#r-repeat').value;
    const err = d.el.querySelector('#r-error');
    const when = new Date(`${date}T${time || '08:00'}`);
    if (!date || isNaN(when)) { err.textContent = 'Pick a date and time.'; err.hidden = false; return; }
    if (rep === 'none' && when.getTime() <= Date.now()) { err.textContent = 'That time has already passed.'; err.hidden = false; return; }
    finish({ at: when.getTime(), repeat: rep });
  };
  d.el.querySelector('[data-remove]')?.addEventListener('click', () => { d.close(); onSave(null); });
}

function addLabel(name) {
  name = name.trim();
  if (name && !db.labels.some((l) => l.toLowerCase() === name.toLowerCase())) {
    db.labels.push(name);
    db.labels.sort((a, b) => a.localeCompare(b));
  }
  return db.labels.find((l) => l.toLowerCase() === name.toLowerCase()) || name;
}

function labelDialog(notes, onChange) {
  let filter = '';
  const d = openDialog(`
    <h2>Label note</h2>
    <div class="label-new">${icon('search', 'sm')}<input id="l-filter" placeholder="Enter label name" autocomplete="off"></div>
    <div id="l-list"></div>
    <div class="actions"><button class="text-btn" data-close>Done</button></div>`);
  const list = d.el.querySelector('#l-list');
  const draw = () => {
    const f = filter.trim().toLowerCase();
    const labels = db.labels.filter((l) => l.toLowerCase().includes(f));
    const exact = db.labels.some((l) => l.toLowerCase() === f);
    list.innerHTML = labels.map((l) => {
      const on = notes.every((n) => n.labels.includes(l));
      return `<button class="label-check" data-label="${esc(l)}">${icon('label')}<span>${esc(l)}</span>${icon(on ? 'boxChecked' : 'boxBlank')}</button>`;
    }).join('') + (f && !exact ? `<button class="label-check" data-create>${icon('add')}<span>Create "${esc(filter.trim())}"</span></button>` : '');
  };
  const toggle = (label) => {
    const on = notes.every((n) => n.labels.includes(label));
    for (const n of notes) {
      n.labels = on ? n.labels.filter((l) => l !== label) : [...new Set([...n.labels, label])];
    }
    onChange();
    draw();
  };
  d.el.querySelector('#l-filter').addEventListener('input', (e) => { filter = e.target.value; draw(); });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-create')) {
      const label = addLabel(filter);
      filter = '';
      d.el.querySelector('#l-filter').value = '';
      toggle(label);
      renderDrawer();
    } else toggle(b.dataset.label);
  });
  draw();
}

function editLabelsDialog() {
  const d = openDialog(`
    <h2>Edit labels</h2>
    <div class="label-new">${icon('add', 'sm')}<input id="l-new" placeholder="Create new label" autocomplete="off" enterkeyhint="done">
      <button class="icon-btn" data-add aria-label="Create">${icon('check')}</button></div>
    <div id="l-list"></div>
    <div class="actions"><button class="text-btn" data-close>Done</button></div>`, () => { persist(); render(); });
  const list = d.el.querySelector('#l-list');
  const draw = () => {
    list.innerHTML = db.labels.map((l, i) => `<div class="label-row" data-i="${i}">
      <button class="icon-btn" data-del aria-label="Delete label">${icon('trash')}</button>
      <input type="text" value="${esc(l)}" data-rename>
    </div>`).join('') || '<p>No labels yet.</p>';
  };
  const create = () => {
    const input = d.el.querySelector('#l-new');
    if (input.value.trim()) { addLabel(input.value); input.value = ''; draw(); persist(); }
  };
  d.el.querySelector('[data-add]').onclick = create;
  d.el.querySelector('#l-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.label-row');
    if (!row || !e.target.closest('[data-del]')) return;
    const label = db.labels[+row.dataset.i];
    confirmDialog('Delete label?', `"${label}" will be removed from all notes. The notes stay.`, 'Delete', () => {
      db.labels = db.labels.filter((l) => l !== label);
      db.notes.forEach((n) => (n.labels = n.labels.filter((l) => l !== label)));
      if (ui.view.type === 'label' && ui.view.name === label) ui.view = { type: 'notes' };
      persist(); draw(); render();
    });
  });
  list.addEventListener('change', (e) => {
    if (!e.target.matches('[data-rename]')) return;
    const i = +e.target.closest('.label-row').dataset.i;
    const oldName = db.labels[i];
    const newName = e.target.value.trim();
    if (!newName || newName === oldName) { e.target.value = oldName; return; }
    if (db.labels.some((l, j) => j !== i && l.toLowerCase() === newName.toLowerCase())) {
      toast('A label with that name already exists'); e.target.value = oldName; return;
    }
    db.labels[i] = newName;
    db.notes.forEach((n) => (n.labels = n.labels.map((l) => (l === oldName ? newName : l))));
    if (ui.view.type === 'label' && ui.view.name === oldName) ui.view.name = newName;
    persist();
  });
  draw();
}

// ---------- Images ----------

let imagePickTarget = null;
function pickImages(onDone) {
  imagePickTarget = onDone;
  const input = $('#pick-image');
  input.value = '';
  input.click();
}

async function addImageFiles(files) {
  const out = [];
  for (const f of files) {
    try { out.push(await store.saveImage(f)); } catch { toast(`Couldn't add ${f.name}`); }
  }
  return out;
}

function viewImage(src) {
  const layer = h('div', 'dialog-layer', `<img src="${esc(src)}" style="max-width:100%;max-height:100%;border-radius:4px">`);
  const close = pushLayer(layer);
  layer.onclick = close;
}

// ---------- Editor ----------

function openEditor(note, isNew = false) {
  if (!note) return;
  editor = { note, isNew, doneCollapsed: false };
  document.body.classList.add('editor-open');
  $('#editor').hidden = false;
  renderEditor();
  if (isNew) {
    requestAnimationFrame(() => {
      const target = note.type === 'list' ? $('#editor .li-row textarea') : $('#editor .ed-text');
      target?.focus();
    });
  }
}

function closeEditor() {
  if (!editor) return;
  const { note } = editor;
  document.activeElement?.blur?.();
  if (note.type === 'list') {
    const filled = note.items.filter((i) => i.text.trim());
    if (filled.length !== note.items.length) note.items = filled;
  }
  const inDb = db.notes.includes(note);
  if (isEmpty(note)) {
    if (inDb) { db.notes = db.notes.filter((n) => n !== note); native.cancelReminder(note); }
    if (!editor.isNew || inDb) toast('Empty note discarded');
  } else if (note.reminder) {
    native.scheduleReminder(note); // refresh the notification text
  }
  editor = null;
  document.body.classList.remove('editor-open');
  $('#editor').hidden = true;
  $('#editor').innerHTML = '';
  persist();
  flushSave();
  render();
}

function touch() {
  const n = editor.note;
  n.updated = Date.now();
  if (editor.isNew && !db.notes.includes(n)) db.notes.push(n);
  persist();
  const ed = $('#editor .edited');
  if (ed) ed.textContent = editedLabel(n.updated);
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function listRowsHtml(items) {
  return items.map((i) => `<div class="li-row ${i.checked ? 'done' : ''}" data-item="${i.id}">
    <button class="check" aria-label="${i.checked ? 'Uncheck' : 'Check'}">${icon(i.checked ? 'boxChecked' : 'boxBlank')}</button>
    <textarea rows="1" enterkeyhint="next" placeholder="List item">${esc(i.text)}</textarea>
    <button class="del" aria-label="Delete item">${icon('close', 'sm')}</button>
  </div>`).join('');
}

function listHtml(note) {
  const unchecked = note.items.filter((i) => !i.checked);
  const checked = note.items.filter((i) => i.checked);
  const readonly = note.trashed;
  return `${listRowsHtml(unchecked)}
    ${readonly ? '' : `<button class="li-add">${icon('add')}<span>List item</span></button>`}
    ${checked.length ? `<button class="li-done-head ${editor.doneCollapsed ? 'collapsed' : ''}">${icon('expand')}<span>${checked.length} checked item${checked.length > 1 ? 's' : ''}</span></button>
      ${editor.doneCollapsed ? '' : listRowsHtml(checked)}` : ''}`;
}

function chipsHtml(note) {
  const chips = [];
  if (note.reminder) {
    const rep = note.reminder.repeat && note.reminder.repeat !== 'none';
    chips.push(`<span class="chip ${reminderPast(note.reminder) ? 'past' : ''}" data-act="ed-reminder">${icon(rep ? 'repeat' : 'clock', 'xs')}<span>${esc(reminderLabel(note.reminder))}</span></span>`);
  }
  note.labels.forEach((l) => chips.push(`<span class="chip" data-act="ed-labels">${esc(l)}</span>`));
  return chips.join('');
}

function renderEditor() {
  const { note } = editor;
  const el = $('#editor');
  const ro = note.trashed;
  applyEditorStyle(note);
  el.classList.toggle('ed-readonly', ro);
  const imgs = note.images;
  el.innerHTML = `
    <div class="ed-top">
      <button class="icon-btn on" data-act="ed-close" aria-label="Back">${icon('back')}</button>
      <div class="grow"></div>
      ${ro ? '' : `
        <button class="icon-btn on" data-act="ed-pin" aria-label="Pin">${icon(note.pinned ? 'pinFilled' : 'pin')}</button>
        <button class="icon-btn on" data-act="ed-reminder" aria-label="Reminder">${icon('bell')}</button>
        <button class="icon-btn on" data-act="ed-archive" aria-label="Archive">${icon(note.archived ? 'unarchive' : 'archive')}</button>`}
    </div>
    <div class="ed-scroll">
      ${imgs.length ? `<div class="ed-images ${imgs.length === 1 ? 'single' : ''}">${imgs.map((im, i) => `<figure>
        <img src="${esc(store.imageSrc(im.path))}" data-img="${i}" alt="">
        ${ro ? '' : `<button data-remove-img="${i}" aria-label="Remove image">${icon('trash', 'sm')}</button>`}</figure>`).join('')}</div>` : ''}
      <div class="ed-fields">
        <textarea class="ed-title" rows="1" placeholder="Title" enterkeyhint="next" ${ro ? 'readonly' : ''}>${esc(note.title)}</textarea>
        ${note.type === 'list'
          ? `<div class="ed-list">${listHtml(note)}</div>`
          : `<textarea class="ed-text" placeholder="Note" ${ro ? 'readonly' : ''}>${esc(note.text)}</textarea>`}
      </div>
      <div class="ed-chips">${chipsHtml(note)}</div>
    </div>
    <div class="ed-bottom">
      ${ro ? '' : `<button class="icon-btn on" data-act="ed-add" aria-label="Add">${icon('addBox')}</button>
      <button class="icon-btn on" data-act="ed-color" aria-label="Color">${icon('palette')}</button>`}
      <span class="edited">${ro ? "Can't edit a note in Trash" : editedLabel(note.updated)}</span>
      <button class="icon-btn on" data-act="ed-more" aria-label="More">${icon('more')}</button>
    </div>`;
  el.querySelectorAll('textarea').forEach(autosize);
}

function applyEditorStyle(note) {
  const el = $('#editor');
  el.style.setProperty('--note-bg', colorVar(note.color));
  el.dataset.color = note.color;
  if (PATTERNS.includes(note.pattern) && note.pattern !== 'none') el.dataset.pat = note.pattern;
  else delete el.dataset.pat;
}

function rerenderList(focusId, caret) {
  const box = $('#editor .ed-list');
  if (!box) return;
  box.innerHTML = listHtml(editor.note);
  box.querySelectorAll('textarea').forEach(autosize);
  if (focusId) {
    const ta = box.querySelector(`[data-item="${focusId}"] textarea`);
    if (ta) {
      ta.focus();
      const pos = caret === 'end' || caret == null ? ta.value.length : caret;
      ta.setSelectionRange(pos, pos);
    }
  }
}

function refreshChips() {
  const c = $('#editor .ed-chips');
  if (c) c.innerHTML = chipsHtml(editor.note);
}

function setNoteType(note, type) {
  if (note.type === type) return;
  if (type === 'list') {
    const lines = note.text.split('\n').map((s) => s.trim()).filter(Boolean);
    note.items = (lines.length ? lines : ['']).map((text) => ({ id: uid(), text, checked: false }));
    note.text = '';
  } else {
    note.text = note.items.map((i) => i.text).filter(Boolean).join('\n');
    note.items = [];
  }
  note.type = type;
}

function bindEditor() {
  const el = $('#editor');

  el.addEventListener('input', (e) => {
    if (!editor) return;
    const t = e.target;
    const note = editor.note;
    if (t.classList.contains('ed-title')) note.title = t.value;
    else if (t.classList.contains('ed-text')) note.text = t.value;
    else if (t.closest('.li-row')) {
      const item = note.items.find((i) => i.id === t.closest('.li-row').dataset.item);
      if (item) item.text = t.value;
    } else return;
    autosize(t);
    touch();
  });

  el.addEventListener('keydown', (e) => {
    if (!editor) return;
    const t = e.target;
    const note = editor.note;
    if (t.classList.contains('ed-title') && e.key === 'Enter') {
      e.preventDefault();
      const next = note.type === 'list' ? el.querySelector('.li-row textarea') : el.querySelector('.ed-text');
      next?.focus();
      return;
    }
    const row = t.closest('.li-row');
    if (!row) return;
    const idx = note.items.findIndex((i) => i.id === row.dataset.item);
    const item = note.items[idx];
    if (e.key === 'Enter') {
      e.preventDefault();
      const pos = t.selectionStart;
      const after = item.text.slice(pos);
      item.text = item.text.slice(0, pos);
      const fresh = { id: uid(), text: after, checked: item.checked };
      note.items.splice(idx + 1, 0, fresh);
      touch();
      rerenderList(fresh.id, 0);
    } else if (e.key === 'Backspace' && t.selectionStart === 0 && t.selectionEnd === 0) {
      const group = note.items.filter((i) => i.checked === item.checked);
      const prev = group[group.indexOf(item) - 1];
      if (!prev) return;
      e.preventDefault();
      const caret = prev.text.length;
      prev.text += item.text;
      note.items.splice(idx, 1);
      touch();
      rerenderList(prev.id, caret);
    }
  });

  el.addEventListener('paste', (e) => {
    const row = e.target.closest?.('.li-row');
    if (!row || !editor) return;
    const text = e.clipboardData?.getData('text') || '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    const note = editor.note;
    const idx = note.items.findIndex((i) => i.id === row.dataset.item);
    const item = note.items[idx];
    const t = e.target;
    const before = item.text.slice(0, t.selectionStart);
    const after = item.text.slice(t.selectionEnd);
    const lines = text.split(/\r?\n/);
    item.text = before + lines[0];
    const added = lines.slice(1).map((line) => ({ id: uid(), text: line, checked: item.checked }));
    if (added.length) added[added.length - 1].text += after;
    note.items.splice(idx + 1, 0, ...added);
    touch();
    rerenderList((added[added.length - 1] || item).id, 'end');
  });

  el.addEventListener('click', async (e) => {
    if (!editor) return;
    const note = editor.note;
    const t = e.target;

    const row = t.closest('.li-row');
    if (row && !note.trashed) {
      const item = note.items.find((i) => i.id === row.dataset.item);
      if (t.closest('.check')) { item.checked = !item.checked; touch(); rerenderList(); return; }
      if (t.closest('.del')) { note.items = note.items.filter((i) => i !== item); touch(); rerenderList(); return; }
    }
    if (t.closest('.li-add')) {
      const fresh = { id: uid(), text: '', checked: false };
      const lastUnchecked = note.items.map((i) => i.checked).lastIndexOf(false);
      note.items.splice(lastUnchecked + 1, 0, fresh);
      rerenderList(fresh.id);
      return;
    }
    if (t.closest('.li-done-head')) { editor.doneCollapsed = !editor.doneCollapsed; rerenderList(); return; }

    const img = t.closest('[data-img]');
    if (img) { viewImage(img.src); return; }
    const rm = t.closest('[data-remove-img]');
    if (rm) {
      const [removed] = note.images.splice(+rm.dataset.removeImg, 1);
      touch(); renderEditor();
      toast('Image removed', 'Undo', () => { note.images.push(removed); persist(); if (editor?.note === note) renderEditor(); });
      setTimeout(() => { if (!note.images.includes(removed)) store.deleteImage(removed.path); }, 7000);
      return;
    }

    const act = t.closest('[data-act]')?.dataset.act;
    if (!act) {
      if (t.closest('.ed-scroll') && !t.closest('textarea, button, .chip') && !note.trashed) {
        // Tapping empty space below the text puts the cursor at the end, like Keep.
        const body = note.type === 'list' ? null : el.querySelector('.ed-text');
        if (body && e.target === el.querySelector('.ed-scroll')) { body.focus(); body.setSelectionRange(body.value.length, body.value.length); }
      }
      return;
    }
    switch (act) {
      case 'ed-close': closeEditor(); break;
      case 'ed-pin':
        note.pinned = !note.pinned;
        if (note.pinned && note.archived) note.archived = false;
        touch(); renderEditor();
        break;
      case 'ed-archive': {
        const archive = !note.archived;
        if (editor.isNew && !db.notes.includes(note)) db.notes.push(note);
        closeEditor();
        if (!isEmpty(note)) setArchived([note], archive);
        break;
      }
      case 'ed-reminder':
        reminderDialog(note.reminder, (r) => {
          note.reminder = r;
          touch(); refreshChips();
          native.scheduleReminder(note);
          if (r) toast(`Reminder set for ${reminderLabel(r)}`);
        });
        break;
      case 'ed-labels':
        labelDialog([note], () => { touch(); refreshChips(); });
        break;
      case 'ed-color':
        styleSheet({ color: note.color, pattern: note.pattern }, (patch) => { Object.assign(note, patch); touch(); applyEditorStyle(note); });
        break;
      case 'ed-add':
        showMenu(t.closest('button'), [
          { label: 'Add image', icon: 'image', onClick: () => pickImages(async (files) => {
            const added = await addImageFiles(files);
            if (!added.length || editor?.note !== note) return;
            note.images.push(...added); touch(); renderEditor();
          }) },
          { label: note.type === 'list' ? 'Hide checkboxes' : 'Show checkboxes', icon: 'checklist', onClick: () => {
            setNoteType(note, note.type === 'list' ? 'text' : 'list'); touch(); renderEditor();
          } },
        ]);
        break;
      case 'ed-more':
        showMenu(t.closest('button'), note.trashed ? [
          { label: 'Restore', icon: 'restore', onClick: () => { closeEditor(); restoreFromTrash([note]); } },
          { label: 'Delete forever', icon: 'deleteForever', onClick: () => confirmDialog('Delete note forever?', 'This can\'t be undone.', 'Delete', () => { closeEditor(); deleteForever([note]); render(); }) },
        ] : [
          { label: 'Delete', icon: 'trash', onClick: () => {
            if (editor.isNew && !db.notes.includes(note)) db.notes.push(note);
            closeEditor();
            if (db.notes.includes(note)) moveToTrash([note]);
          } },
          { label: 'Make a copy', icon: 'copy', onClick: () => { const c = copyNote(note); closeEditor(); openEditor(c); } },
          { label: 'Send', icon: 'share', onClick: () => native.shareText(note.title, note.type === 'list'
            ? note.items.map((i) => `${i.checked ? '☑' : '☐'} ${i.text}`).join('\n') : note.text) },
          { label: 'Labels', icon: 'label', onClick: () => labelDialog([note], () => { touch(); refreshChips(); }) },
        ]);
        break;
    }
  });
}

// ---------- Google Keep import ----------

function importDialog() {
  const d = openDialog(`
    <h2>Import from Google Keep</h2>
    <p>Bring in all your Google Keep notes, including labels, colors, checklists and pictures.</p>
    <ol>
      <li>Open <a href="https://takeout.google.com/" style="color:var(--link)">takeout.google.com</a> and sign in with your Gmail account.</li>
      <li>Tap <b>Deselect all</b>, then tick only <b>Keep</b>.</li>
      <li>Tap <b>Next step</b>, then <b>Create export</b>. Google emails you a download link, usually within a few minutes.</li>
      <li>Open that email on this phone and download the <b>.zip</b> file.</li>
      <li>Come back here and tap the button below.</li>
    </ol>
    <button class="btn" data-pick>${icon('download')}<div>Choose the Takeout .zip file<small>You can also pick the extracted .json files</small></div></button>
    <div id="imp-status"></div>
    <div class="actions"><button class="text-btn" data-close>Close</button></div>`);
  const status = d.el.querySelector('#imp-status');
  d.el.querySelector('[data-pick]').onclick = () => {
    const input = $('#pick-keep');
    input.value = '';
    input.onchange = async () => {
      const files = [...input.files];
      if (!files.length) return;
      status.innerHTML = `<div class="progress">Starting…</div>`;
      try {
        const res = await importKeep(files, db.notes, { onProgress: (m) => (status.innerHTML = `<div class="progress">${esc(m)}</div>`) });
        res.labels.forEach(addLabel);
        // Match label spelling to the existing label list.
        for (const n of res.notes) n.labels = [...new Set(n.labels.map(addLabel))];
        db.notes.push(...res.notes);
        persist(); flushSave(); render();
        const skipped = [
          res.duplicates && `${res.duplicates} already imported`,
          res.skippedTrashed && `${res.skippedTrashed} from Keep's trash`,
          res.skippedAudio && `${res.skippedAudio} voice recording${res.skippedAudio > 1 ? 's' : ''} (not supported)`,
          res.failedImages && `${res.failedImages} picture${res.failedImages > 1 ? 's' : ''} missing from the file`,
        ].filter(Boolean);
        status.innerHTML = res.foundJson === 0
          ? `<div class="result">No Google Keep notes were found in that file. Make sure you picked the Takeout .zip that includes <b>Keep</b>.</div>`
          : `<div class="result">Imported <b>${res.notes.length}</b> note${res.notes.length === 1 ? '' : 's'}, <b>${res.images}</b> picture${res.images === 1 ? '' : 's'} and <b>${res.labels.length}</b> label${res.labels.length === 1 ? '' : 's'}.
             ${skipped.length ? `<br>Skipped: ${skipped.join(', ')}.` : ''}</div>`;
      } catch (err) {
        console.error(err);
        status.innerHTML = `<div class="result">Couldn't read that file: ${esc(err.message || err)}</div>`;
      }
    };
    input.click();
  };
}

// ---------- Backup & restore ----------

async function exportBackup() {
  const images = {};
  for (const n of db.notes) {
    for (const im of n.images) {
      const data = await store.readImageBase64(im.path);
      if (data) images[im.path] = data;
    }
  }
  const payload = JSON.stringify({ app: 'my-notes', format: 1, exportedAt: Date.now(), labels: db.labels, notes: db.notes, images });
  const d = new Date();
  const name = `ARNotes-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  if (isNative) {
    const uri = await store.writeCacheFile(name, payload);
    await native.shareFile('Save notes backup', uri);
  } else {
    const a = h('a');
    a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    a.download = name;
    a.click();
  }
  db.settings.lastBackup = Date.now();
  persist();
}

async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'my-notes' || !Array.isArray(data.notes)) throw new Error('This is not an AR Notes backup file.');
  let added = 0;
  let updated = 0;
  for (const raw of data.notes) {
    const n = normalizeNote(raw);
    for (const im of n.images) {
      if (data.images?.[im.path]) await store.writeImageBase64(im.path, data.images[im.path]);
    }
    const existing = findNote(n.id);
    if (!existing) { db.notes.push(n); added++; }
    else if ((n.updated || 0) > (existing.updated || 0)) { Object.assign(existing, n); updated++; }
  }
  (data.labels || []).forEach(addLabel);
  persist(); flushSave(); render();
  native.resyncReminders(db.notes);
  return { added, updated };
}

function backupDialog() {
  const last = db.settings.lastBackup ? new Date(db.settings.lastBackup).toLocaleString() : 'never';
  const d = openDialog(`
    <h2>Backup &amp; restore</h2>
    <p><b style="color:var(--fg)">Automatic backup to your Google account.</b> Android backs up this app's notes to the Google account on this phone (Settings → Google → Backup). When you set up a new phone with the same Google account and install AR Notes, your notes come back.</p>
    <p>For extra safety, save a backup file to Google Drive or email it to yourself. Last backup file: ${esc(last)}.</p>
    <button class="btn" data-export>${icon('cloud')}<div>Save a backup file<small>Save to Google Drive, send to your Gmail, or keep on the phone</small></div></button>
    <button class="btn" data-restore>${icon('restore')}<div>Restore from a backup file<small>Adds the notes from the file. Nothing gets deleted.</small></div></button>
    <div id="bk-status"></div>
    <div class="actions"><button class="text-btn" data-close>Close</button></div>`);
  const status = d.el.querySelector('#bk-status');
  d.el.querySelector('[data-export]').onclick = async () => {
    status.innerHTML = '<div class="progress">Preparing backup…</div>';
    try { await exportBackup(); status.innerHTML = '<div class="result">Backup file ready.</div>'; }
    catch (err) { status.innerHTML = `<div class="result">Backup failed: ${esc(err.message || err)}</div>`; }
  };
  d.el.querySelector('[data-restore]').onclick = () => {
    const input = $('#pick-backup');
    input.value = '';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      status.innerHTML = '<div class="progress">Restoring…</div>';
      try {
        const r = await restoreBackup(file);
        status.innerHTML = `<div class="result">Restored <b>${r.added}</b> note${r.added === 1 ? '' : 's'}${r.updated ? `, updated ${r.updated}` : ''}.</div>`;
      } catch (err) {
        status.innerHTML = `<div class="result">Couldn't restore: ${esc(err.message || err)}</div>`;
      }
    };
    input.click();
  };
}

// ---------- Global actions ----------

function newNote(type, withImages) {
  const note = blankNote(type);
  if (ui.view.type === 'label') note.labels = [ui.view.name];
  if (withImages) {
    pickImages(async (files) => {
      const added = await addImageFiles(files);
      if (!added.length) return;
      note.images.push(...added);
      db.notes.push(note);
      persist();
      openEditor(note, true);
    });
    return;
  }
  openEditor(note, true);
}

function goTo(view) {
  ui.view = view;
  ui.searching = false;
  ui.query = '';
  ui.selected.clear();
  setDrawer(false);
  render();
  window.scrollTo(0, 0);
}

function handleAction(act, target) {
  const sel = selectedNotes();
  switch (act) {
    case 'drawer': setDrawer(true); break;
    case 'toggle-view':
      db.settings.view = db.settings.view === 'grid' ? 'list' : 'grid';
      persist(); render();
      break;
    case 'search-open':
      ui.searching = true; ui.query = ''; render();
      $('#search')?.focus();
      break;
    case 'search-close': ui.searching = false; ui.query = ''; render(); break;
    case 'search-clear': ui.query = ''; render(); $('#search')?.focus(); break;
    case 'new-note': newNote('text'); break;
    case 'new-list': newNote('list'); break;
    case 'new-image': newNote('text', true); break;
    case 'sel-clear': clearSelection(); break;
    case 'sel-pin': {
      const pin = !sel.every((n) => n.pinned);
      sel.forEach((n) => { n.pinned = pin; if (pin) n.archived = false; });
      ui.selected.clear(); persist(); render();
      break;
    }
    case 'sel-color':
      styleSheet(sel.length === 1 ? { color: sel[0].color, pattern: sel[0].pattern } : { color: null, pattern: null },
        (patch) => { sel.forEach((n) => Object.assign(n, patch)); persist(); renderMain(); });
      break;
    case 'sel-archive':
      ui.selected.clear();
      setArchived(sel, ui.view.type !== 'archive');
      break;
    case 'sel-more':
      showMenu(target, [
        { label: 'Delete', icon: 'trash', onClick: () => { ui.selected.clear(); moveToTrash(sel); } },
        { label: 'Add reminder', icon: 'bell', onClick: () => reminderDialog(null, (r) => {
          sel.forEach((n) => { n.reminder = r ? { ...r } : null; native.scheduleReminder(n); });
          ui.selected.clear(); persist(); render();
        }) },
        { label: 'Labels', icon: 'label', onClick: () => labelDialog(sel, () => { persist(); renderMain(); }) },
        sel.length === 1 && { label: 'Make a copy', icon: 'copy', onClick: () => { copyNote(sel[0]); ui.selected.clear(); render(); } },
      ]);
      break;
    case 'sel-restore': ui.selected.clear(); restoreFromTrash(sel); break;
    case 'sel-delete-forever':
      confirmDialog(`Delete ${sel.length > 1 ? `${sel.length} notes` : 'note'} forever?`, "This can't be undone.", 'Delete', () => {
        ui.selected.clear(); deleteForever(sel); render();
      });
      break;
    case 'empty-trash':
      confirmDialog('Empty Trash?', "All notes in Trash will be permanently deleted. This can't be undone.", 'Empty Trash', () => {
        deleteForever(db.notes.filter((n) => n.trashed)); render();
      });
      break;
    case 'edit-labels': setDrawer(false); editLabelsDialog(); break;
    case 'import-keep': setDrawer(false); importDialog(); break;
    case 'backup': setDrawer(false); backupDialog(); break;
    case 'appearance': setDrawer(false); appearanceDialog(); break;
  }
}

function bindGlobal() {
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const type = nav.dataset.nav;
      goTo(type === 'label' ? { type, name: nav.dataset.name } : { type });
      return;
    }
    if (e.target.closest('#editor') || e.target.closest('#overlay-root')) return;
    const actEl = e.target.closest('[data-act]');
    if (actEl) handleAction(actEl.dataset.act, actEl);
  });
  $('#scrim').addEventListener('click', () => setDrawer(false));
  $('#topbar').addEventListener('input', (e) => {
    if (e.target.id !== 'search') return;
    ui.query = e.target.value;
    $('#topbar [data-act="search-clear"]').hidden = !ui.query;
    renderMain();
  });
  $('#topbar').addEventListener('keydown', (e) => { if (e.target.id === 'search' && e.key === 'Enter') e.target.blur(); });
  $('#pick-image').addEventListener('change', (e) => {
    const files = [...e.target.files];
    const cb = imagePickTarget;
    imagePickTarget = null;
    if (files.length && cb) cb(files);
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!editor) renderMain(); }, 150);
  });

  native.onBackButton(() => {
    if (closeTopLayer()) return;
    if (editor) return closeEditor();
    if (ui.drawerOpen) return setDrawer(false);
    if (ui.selected.size) return clearSelection();
    if (ui.searching) { ui.searching = false; ui.query = ''; return render(); }
    if (ui.view.type !== 'notes') return goTo({ type: 'notes' });
    native.exitApp();
  });
  native.onPause(flushSave);
  native.onResume(() => { if (!editor) renderMain(); });
}

function openNoteById(id) {
  const note = findNote(id);
  if (!note) return;
  while (closeTopLayer());
  if (editor) closeEditor();
  setDrawer(false);
  openEditor(note);
}

async function start() {
  await store.initImages();
  db = await store.loadDb();
  db.notes.forEach(normalizeNote);
  applyTheme();
  darkQuery.addEventListener('change', applyTheme);
  emptyOldTrash();
  bindCards();
  bindEditor();
  bindGlobal();
  render();
  await native.initNotifications(openNoteById);
  native.resyncReminders(db.notes);
}

start().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<p style="padding:24px">Something went wrong while starting: ${esc(err.message || err)}</p>`;
});
