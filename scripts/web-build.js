#!/usr/bin/env node
'use strict';

// node scripts/web-build.js   (npm run build:web; Vercel runs it)
//
// NEO on the web: Pocket's page and bridge (pocket/www, filled by
// pocket-www.js) with web/ laid over them, written to web/dist. The
// library lives in the browser (web/capacitor-shim.js) and syncs with
// OneDrive (web/onedrive.js, web/sync.js). NEO_ONEDRIVE_CLIENT_ID, when
// set, is the Microsoft app id that sign-in uses (web/README.md).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const www = path.join(root, 'pocket', 'www');
const web = path.join(root, 'web');
const dist = path.join(web, 'dist');

execFileSync(process.execPath, [path.join(__dirname, 'pocket-www.js')], { stdio: 'inherit' });

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(www, dist, { recursive: true });
const copy = (from, to) => fs.cpSync(from, path.join(dist, to || path.basename(from)), { recursive: true });
for (const f of ['capacitor-shim.js', 'onedrive.js', 'sync.js', 'library-zip.js', 'web-bridge.js', 'web.css', 'manifest.webmanifest', 'icons']) copy(path.join(web, f));
copy(path.join(root, 'import-parse.js'));

// The page: Pocket's, with the web's files around its bridge. Its own
// script moves to a file, so the site can forbid inline scripts.
let html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error('pocket/www/index.html changed shape: no ' + from);
  html = html.replace(from, to);
};
const inline = html.match(/<script>\n([\s\S]*?)\n\s*<\/script>/);
if (!inline) throw new Error('pocket/www/index.html changed shape: no page script');
fs.writeFileSync(path.join(dist, 'pocket-page.js'), inline[1].replace(/^ {4}/gm, '') + '\n');
swap(inline[0], '<script src="pocket-page.js"></script>');
swap('<title>NEO Pocket</title>', [
  '<title>NEO</title>',
  '  <meta name="description" content="A word processor for books." />',
  '  <meta name="theme-color" content="#191919" />',
  '  <meta name="apple-mobile-web-app-capable" content="yes" />',
  '  <meta name="mobile-web-app-capable" content="yes" />',
  '  <meta name="apple-mobile-web-app-title" content="NEO" />',
  '  <meta name="apple-mobile-web-app-status-bar-style" content="black" />',
  '  <link rel="manifest" href="manifest.webmanifest" />',
  '  <link rel="apple-touch-icon" href="icons/icon-180.png" />',
  '  <link rel="icon" type="image/png" href="icons/icon-192.png" />'
].join('\n'));
swap('<link rel="stylesheet" href="pocket.css" />', '<link rel="stylesheet" href="pocket.css" />\n  <link rel="stylesheet" href="web.css" />');
swap('<script src="pocket-bridge.js"></script>', [
  '<script src="config.js"></script>',
  '  <script src="capacitor-shim.js"></script>',
  '  <script src="pocket-bridge.js"></script>',
  '  <script src="import-parse.js"></script>',
  '  <script src="onedrive.js"></script>',
  '  <script src="sync.js"></script>',
  '  <script src="library-zip.js"></script>',
  '  <script src="web-bridge.js"></script>'
].join('\n'));
fs.writeFileSync(path.join(dist, 'index.html'), html);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = { onedriveClientId: (process.env.NEO_ONEDRIVE_CLIENT_ID || '').trim(), version: pkg.version };
fs.writeFileSync(path.join(dist, 'config.js'), 'window.NEO_CONFIG = ' + JSON.stringify(config) + ';\n');

// The offline copy: every file but the fonts and dictionaries, which are
// kept as they're first used. Its version is the files' own fingerprint,
// so any change makes browsers fetch the new NEO whole.
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else files.push(path.relative(dist, full).split(path.sep).join('/'));
  }
};
walk(dist);
const shell = files.filter((f) => !/^(fonts|dict)\//.test(f) || f === 'dict/languages.json').sort();
const hash = crypto.createHash('sha256');
for (const f of shell) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
const version = hash.digest('hex').slice(0, 12);
const sw = fs.readFileSync(path.join(web, 'sw.js'), 'utf8')
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('__SHELL__', JSON.stringify(['./', ...shell.filter((f) => f !== 'index.html')]));
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

console.log(`web/dist is ready (${files.length} files, version ${version}${config.onedriveClientId ? ', OneDrive on' : ', OneDrive not set up: NEO_ONEDRIVE_CLIENT_ID is empty'}).`);
