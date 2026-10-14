# AR Notes — a Google Keep style notes app for Android (open source)

**AR Notes** is a free, open source notes app for Android that looks and works like Google Keep, but keeps everything on your phone. It has **notes, checklists, photos, colours, labels, pinning, archive, search and a trash bin**, plus two things people keep asking Google Keep for: **reminders that do not need Google Calendar**, and a **one tap import of your existing Google Keep notes**.

[![Download the APK](https://img.shields.io/badge/Download-APK-brightgreen?style=for-the-badge&logo=android)](../../releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
![Android 7.0+](https://img.shields.io/badge/Android-7.0%2B-3ddc84?style=flat-square&logo=android)
![No ads, no tracking](https://img.shields.io/badge/Ads%20%26%20tracking-none-success?style=flat-square)

---

## Download

Grab the latest `AR-Notes.apk` from the [**Releases page**](../../releases/latest) and open it on your Android phone. Android will ask you to allow installing apps from this source. The app needs **Android 7.0 or newer**.

There is no Play Store listing, so the app updates only when you install a newer APK yourself.

## Why use AR Notes instead of Google Keep?

| | AR Notes | Google Keep |
|---|---|---|
| Works fully offline | Yes, always | Needs a Google account |
| Reminders | Built in alarms, no other app needed | Routed through Google Calendar / Tasks |
| Your notes live | Only on your phone | On Google's servers |
| Ads and tracking | None | Tied to your Google account |
| Import from Google Keep | Yes, from a Google Takeout zip | — |
| Source code | Open, MIT licensed | Closed |
| Styles | 5 app styles, light and dark | 1 |

## Features

- **Notes and checklists** — write text notes or tick-box lists, with checked items grouped at the bottom.
- **Reminders without Google Calendar** — pick a date and time, and repeat daily, weekly, monthly or yearly. The alarm is set on the phone itself, so it rings offline, and tapping the notification opens the note.
- **Google Keep import** — import a Google Takeout export and keep your labels, colours, checklists, pinned and archived notes, and pictures.
- **Photos in notes** — add pictures from the gallery; they are resized so your collection stays small.
- **Labels** — create, rename and delete labels, and filter notes by label.
- **Pin, archive and trash** — trash keeps deleted notes for 7 days, with undo.
- **Search** — searches titles, note text, checklist items and labels, including notes written in other languages.
- **Right to left text** — Urdu, Arabic, Hebrew and Persian lines are laid out correctly, even mixed with English in the same note.
- **5 app styles** — Modern, Aurora, Paper, Midnight and Classic, each with a light and a dark version, plus note backgrounds (dots, grid, lined, stripes, waves, bubbles).
- **Backup** — automatic backup to the Google account on the phone, plus a backup file you can save to Drive, email to yourself or keep offline.
- **No ads, no accounts, no tracking** — the app never sends your notes anywhere.

## Import your notes from Google Keep

1. Open [takeout.google.com](https://takeout.google.com/) on your phone and sign in with your Google account.
2. Tap **Deselect all**, then tick only **Keep**.
3. Tap **Next step**, then **Create export**. Google emails you a download link, usually within a few minutes.
4. Download the `.zip` file on your phone.
5. In AR Notes, open the menu (☰) → **Import from Google Keep**, and choose that zip.

What comes across: titles, text, checklists (including ticked items), colours, labels, pinned and archived notes, pictures and drawings, and the original created and edited dates. Importing the same file twice skips notes that are already there.

What does not come across: voice recordings, notes that were in Keep's trash, and reminders — Google's export does not include them.

## Reminders that work without Google Calendar

Google Keep sends its reminders through Google Calendar and Google Tasks, so they stop working when those apps are missing. AR Notes schedules an exact alarm with Android itself (`AlarmManager`), which means reminders:

- ring at the exact minute, even with no internet and with the screen off,
- survive a reboot,
- open the note when you tap the notification,
- can repeat daily, weekly, monthly or yearly.

On phones that manage battery aggressively (Xiaomi, Redmi, Oppo, Vivo, Samsung), set the app's battery setting to **No restrictions** so alarms are not blocked.

## Backup and restore

- **Automatic** — Android backs the app's notes up to the Google account on the phone (Settings → Google → Backup). Set up a new phone with the same account, install AR Notes, and the notes come back.
- **Backup file** — menu → **Backup & restore** → **Save a backup file**, then send it to Google Drive, Gmail or anywhere you like. Restoring only adds notes, it never deletes any.

## Build it yourself

You need [Node.js](https://nodejs.org/) and Android Studio (for the Android SDK and its bundled Java).

```bash
git clone https://github.com/ABDURREHMAN629/ar-notes-google-keep-alternative.git
cd ar-notes-google-keep-alternative
npm install
npm run sync
cd android
./gradlew assembleRelease
```

The APK is written to `android/app/build/outputs/apk/release/`.

To sign your own builds, create a keystore and an `android/keystore.properties` file with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. Both are deliberately kept out of this repository — never publish a signing key.

Try the interface in a desktop browser without building anything:

```bash
npm run serve
```

Then open `http://localhost:5173`. In a browser the notes are stored in the browser itself and reminders do not ring; everything else works.

## How it is built

The whole interface is plain **HTML, CSS and JavaScript** — no framework, no bundler, no build step for the app itself. [Capacitor](https://capacitorjs.com/) wraps it as a native Android app and provides the native pieces.

| Path | What it is |
|---|---|
| `www/index.html` | The app shell |
| `www/css/app.css` | All styling, including the 5 app styles |
| `www/js/app.js` | Screens, note editor, dialogs |
| `www/js/store.js` | Saving notes and pictures |
| `www/js/native.js` | Reminders, sharing, Android back button |
| `www/js/keep-import.js` | Google Takeout importer |
| `android/` | The Android project |

Notes are stored as a single JSON file in the app's private folder, with pictures beside it — no database, easy to back up and easy to read.

## Privacy

AR Notes has no accounts, no analytics and no ads. Your notes never leave the phone unless you save a backup file or share a note yourself. The only backup that happens by itself is Android's own backup to your Google account, which you can turn off in the phone's settings.

## Frequently asked questions

**Is AR Notes free?** Yes, free and open source under the MIT licence.

**Does it need internet?** No. Writing notes, reminders, search and import all work offline.

**Can I use it without a Google account?** Yes. A Google account is only involved if you use Android's automatic backup or import from Google Takeout.

**Will my Google Keep notes change?** No. The import only reads a copy of your data from Google Takeout; nothing is sent back to Google.

**Is it on the Play Store?** No. Install the APK from the Releases page.

**Does it work on iPhone?** Not today. The app is built with Capacitor, so an iOS version is possible, but only Android is built here.

**Can I help?** Yes — bug reports and ideas are welcome in [Issues](../../issues), and pull requests are welcome too.

## Contact

- GitHub: [@ABDURREHMAN629](https://github.com/ABDURREHMAN629)
- Questions, bugs and ideas: [open an issue](../../issues)
- Email: gabdurrehman493@gmail.com

## Licence

[MIT](LICENSE) — free to use, change and share.

---

<sub>Keywords: google keep alternative, open source notes app for android, offline notes app, notes app without google account, google keep import, google takeout keep importer, android reminder app without google calendar, keep clone, free notes app apk, checklist app android, notes app with labels and colours.</sub>
