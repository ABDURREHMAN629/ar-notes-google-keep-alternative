// Thin wrappers around the Capacitor plugins. Reminders are scheduled with the
// phone's own alarm system, so they need neither Google Calendar nor internet.
import { isNative } from './store.js';

const P = isNative ? window.Capacitor.Plugins : {};
const CHANNEL = 'reminders';

export async function initNotifications(onOpenNote) {
  if (!isNative) return;
  const LN = P.LocalNotifications;
  await LN.createChannel({
    id: CHANNEL,
    name: 'Reminders',
    description: 'Note reminders',
    importance: 5,
    visibility: 1,
    vibration: true,
  }).catch(() => {});
  LN.addListener('localNotificationActionPerformed', (e) => {
    const id = e?.notification?.extra?.noteId;
    if (id) onOpenNote(id);
  });
}

// Asks for notification permission (Android 13+) and makes sure exact alarms
// are allowed. Returns false if the user refused notifications.
export async function ensureReminderPermission() {
  if (!isNative) return true;
  const LN = P.LocalNotifications;
  let perm = await LN.checkPermissions();
  if (perm.display !== 'granted') perm = await LN.requestPermissions();
  if (perm.display !== 'granted') return false;
  try {
    const exact = await LN.checkExactNotificationSetting();
    if (exact.exact_alarm !== 'granted') await LN.changeExactNotificationSetting();
  } catch { /* older Android: always allowed */ }
  return true;
}

function preview(note) {
  if (note.type === 'list') {
    return note.items.filter((i) => !i.checked).map((i) => '• ' + i.text).join('\n').slice(0, 300);
  }
  return (note.text || '').slice(0, 300);
}

function scheduleFor(reminder) {
  const d = new Date(reminder.at);
  const time = { hour: d.getHours(), minute: d.getMinutes() };
  switch (reminder.repeat) {
    case 'daily': return { on: time, allowWhileIdle: true };
    case 'weekly': return { on: { weekday: d.getDay() + 1, ...time }, allowWhileIdle: true };
    case 'monthly': return { on: { day: d.getDate(), ...time }, allowWhileIdle: true };
    // Android's plugin uses 0-based months, same as JavaScript.
    case 'yearly': return { on: { month: d.getMonth(), day: d.getDate(), ...time }, allowWhileIdle: true };
    default: return { at: d, allowWhileIdle: true };
  }
}

export function reminderIsActive(note) {
  const r = note.reminder;
  if (!r || note.trashed) return false;
  return (r.repeat && r.repeat !== 'none') || r.at > Date.now();
}

function toNotification(note) {
  return {
    id: note.nid,
    title: note.title || (note.type === 'list' ? 'Checklist reminder' : 'Reminder'),
    body: preview(note) || 'Tap to open note',
    largeBody: preview(note) || undefined,
    channelId: CHANNEL,
    smallIcon: 'ic_stat_note',
    iconColor: '#F9AB00',
    schedule: scheduleFor(note.reminder),
    extra: { noteId: note.id },
  };
}

export async function scheduleReminder(note) {
  if (!isNative) return;
  const LN = P.LocalNotifications;
  await LN.cancel({ notifications: [{ id: note.nid }] }).catch(() => {});
  if (reminderIsActive(note)) await LN.schedule({ notifications: [toNotification(note)] });
}

export async function cancelReminder(note) {
  if (!isNative || !note.nid) return;
  await P.LocalNotifications.cancel({ notifications: [{ id: note.nid }] }).catch(() => {});
}

// Makes the phone's alarm list match the notes exactly (run at startup and after restores).
export async function resyncReminders(notes) {
  if (!isNative) return;
  const LN = P.LocalNotifications;
  const pending = await LN.getPending().catch(() => ({ notifications: [] }));
  if (pending.notifications.length) {
    await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) }).catch(() => {});
  }
  const active = notes.filter(reminderIsActive);
  if (!active.length) return;
  const perm = await LN.checkPermissions();
  if (perm.display !== 'granted') return;
  for (let i = 0; i < active.length; i += 50) {
    await LN.schedule({ notifications: active.slice(i, i + 50).map(toNotification) }).catch((e) => console.error(e));
  }
}

export async function shareText(title, text) {
  if (isNative) return P.Share.share({ title, text, dialogTitle: 'Send note' });
  if (navigator.share) return navigator.share({ title, text });
  await navigator.clipboard?.writeText(`${title}\n${text}`);
}

export async function shareFile(title, uri) {
  return P.Share.share({ title, files: [uri], dialogTitle: title });
}

// Light status-bar icons on dark backgrounds, dark icons on light ones.
export function setStatusBarDark(dark) {
  if (!isNative) return;
  P.SystemBars?.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
}

export function onBackButton(handler) {
  if (isNative) P.App.addListener('backButton', handler);
  else window.addEventListener('keydown', (e) => { if (e.key === 'Escape') handler(); });
}

export function onPause(handler) {
  if (isNative) P.App.addListener('pause', handler);
  window.addEventListener('pagehide', handler);
}

export function onResume(handler) {
  if (isNative) P.App.addListener('resume', handler);
}

export function exitApp() {
  if (isNative) P.App.minimizeApp();
}
