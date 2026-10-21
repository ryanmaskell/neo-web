# NEO on the web

NEO in a browser, made for the iPad first. It is NEO Pocket's page and
editor (`pocket/www`, which is desktop NEO's own `app.js`) running on a
library kept in the browser, with two free ways to carry books in and out:

- **OneDrive sync.** Sign in with any Microsoft account. The library is kept
  as plain files in **OneDrive → Apps → NEO**, the same folders desktop NEO
  uses, and stays in step on every device that signs in. Desktop NEO can use
  that folder too: File → Library Folder… → `OneDrive/Apps/NEO`.
- **Files app (iCloud Drive).** Sync & Files → Save library to Files writes the
  whole library as one `.zip`; Open library from Files reads it back on
  another device. A desktop NEO backup (`Backups/neo-backup-….zip`) opens too.

Manuscripts come in with Import on the shelf (`.docx`, `.txt`, `.md`), the
same reader desktop NEO uses (`import-parse.js`). Exports go out through the
share sheet or a download; a PDF through the browser's Print → Save as PDF.

It works offline once opened. On an iPad, **Share → Add to Home Screen**: it
then opens like an app, and Safari doesn't clear its storage after a week
unused (which it may do for a site that isn't on the Home Screen).

## Putting it on Vercel

1. In Vercel: **Add New… → Project**, import this repository. `vercel.json`
   already sets the build (`npm run build:web`) and the output (`web/dist`).
   Deploy. NEO works now, with Files save/open but no OneDrive.
2. For OneDrive, register NEO with Microsoft (free, a few minutes):
   1. Go to <https://entra.microsoft.com> (sign in with any Microsoft account)
      → **App registrations → New registration**.
   2. Name: **NEO** (this becomes the folder name, Apps → NEO).
   3. Supported account types: **Accounts in any organizational directory and
      personal Microsoft accounts**.
   4. Redirect URI: platform **Single-page application (SPA)**, URI: your
      site's address with a trailing slash, e.g. `https://neo-web.vercel.app/`.
      (Add your own domain too, if you use one. Each must match exactly.)
   5. Register, then copy the **Application (client) ID**.
   6. Under **API permissions**, check that Microsoft Graph →
      `Files.ReadWrite.AppFolder` is there (add it, Delegated, if not).
3. In Vercel: **Project → Settings → Environment Variables**, add
   `NEO_ONEDRIVE_CLIENT_ID` = the client ID. Redeploy.

Nothing else: there is no server and no database. Each writer's books are in
their own browser and their own OneDrive.

## Building locally

    npm install
    npm run build:web                      # → web/dist
    NEO_ONEDRIVE_CLIENT_ID=… npm run build:web
    npx serve web/dist                     # or any static server

Microsoft only signs in to `https://` addresses and `http://localhost`, so
add `http://localhost:3000/` (or your port) as a second SPA redirect URI to
try OneDrive locally.

## How it fits together

| File | Role |
|---|---|
| `web/capacitor-shim.js` | `window.Capacitor` over IndexedDB, so `pocket/www/pocket-bridge.js` runs unchanged. `NeoStore` is the library itself |
| `web/web-bridge.js` | What a browser does differently: import, export, PDF, covers, the shelf's Sync & Files sheet |
| `web/onedrive.js` | Microsoft sign-in (OAuth with PKCE, no library, no server) and the Graph calls |
| `web/sync.js` | The library ↔ OneDrive, whole files, eTags so nothing is written over unseen |
| `web/library-zip.js` | The library as a `.zip`, saved and opened |
| `web/sw.js` | Offline copy, and cover pictures served from the library |
| `scripts/web-build.js` | Assembles `web/dist` from `pocket/www` and `web/` |

Sync's rules, tested in `scripts/web-sync.test.js` (`npm run test:web`):
a file changed on two devices before they synced keeps both, the newer under
its own name and the other beside it as `<name>.sync-conflict-<when>-<where>`.
A file deleted here goes to OneDrive's recycle bin (30 days). On a first
sign-in OneDrive's library comes first, and every book this browser had
stays on a shelf. A chapter changed on another device is then taken in by
app.js's own `refreshFromDisk`, as with iCloud or Syncthing on a Mac.

Microsoft lets a web page stay signed in for a day at a time; after that
NEO renews it with a quick, invisible trip to Microsoft when it opens on
the shelf, never while the writer is writing.
