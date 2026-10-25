const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const media = require('./media');
const lookup = require('./lookup');
const { FORMATS } = require('./formats');

// ── Paths: portable builds keep their data beside the exe ──────────────────
const portableExe = process.env.PORTABLE_EXECUTABLE_FILE;
if (portableExe) {
  const dataDir = path.join(path.dirname(portableExe), `${path.basename(portableExe, '.exe')} Data`);
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
  app.setPath('userData', dataDir);
}
const DATA_DIR = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const res = (name) => (app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, 'resources', name));
media.setBinaries(res('ffmpeg.exe'), res('ffprobe.exe'));

const GITHUB_REPO = 'sunnycrafts/tuneforge';

// Automated checks paint an off-screen window; stop Windows treating it as hidden.
if (process.env.TF_DEVHOOK && !app.isPackaged) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

const AUDIO_EXTS = /\.(mp3|m4a|m4b|m4p|aac|flac|wav|wave|aif|aiff|aifc|ogg|oga|opus|wma|ac3|eac3|dts|ape|wv|mka|caf|amr|tta|mp2|mpc|au|snd|alac|dsf|dff|w64|spx|ra|3gp|mp4|mkv|mov|webm|avi|flv|wmv|ts|mts|m2ts|m4v)$/i;
const AUDIO_EXT_LIST = AUDIO_EXTS.source.match(/\(([^)]+)\)/)[1].split('|');

// ── Settings ───────────────────────────────────────────────────────────────
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; } }
function writeJson(p, data) { try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {} }
let settings = readJson(SETTINGS_FILE, {});

// ── History log ────────────────────────────────────────────────────────────
let history = readJson(HISTORY_FILE, []);
let historyTimer = null;
function log(type, msg, detail) {
  const entry = { t: Date.now(), type, msg, detail: detail || '' };
  history.push(entry);
  if (history.length > 4000) history = history.slice(-4000);
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => writeJson(HISTORY_FILE, history), 600);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log-added', entry);
}

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow;
function createWindow() {
  const b = settings.windowBounds || {};
  let bounds = { width: b.width || 1100, height: b.height || 800 };
  if (b.x != null && b.y != null) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 100 && b.y < a.y + a.height - 100;
    });
    if (visible) bounds = { ...bounds, x: b.x, y: b.y };
  }
  mainWindow = new BrowserWindow({
    ...bounds, minWidth: 820, minHeight: 600,
    frame: false, backgroundColor: nativeTheme.shouldUseDarkColors && settings.theme !== 'light' ? '#202020' : '#f3f3f3',
    alwaysOnTop: !!settings.alwaysOnTop,
    title: 'TuneForge',
    // automated checks run invisibly so they never pop up over the user's work
    ...(process.env.TF_DEVHOOK && !app.isPackaged ? { x: -20000, y: 0, width: 1100, height: 800, show: false, skipTaskbar: true } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });
  if (b.maximized) mainWindow.maximize();
  mainWindow.loadFile('index.html');
  // Development only: TF_DEVHOOK=<script.js> drives the window for automated checks.
  if (process.env.TF_DEVHOOK && !app.isPackaged) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.showInactive(); // painted off-screen, so captures are current
      try { require(process.env.TF_DEVHOOK)(mainWindow); } catch (e) { console.error(e); app.quit(); }
    });
  }
  const sendState = () => mainWindow.webContents.send('window-state', { maximized: mainWindow.isMaximized(), pinned: mainWindow.isAlwaysOnTop() });
  mainWindow.on('maximize', sendState);
  mainWindow.on('unmaximize', sendState);
  mainWindow.on('close', () => {
    const maximized = mainWindow.isMaximized();
    settings.windowBounds = { ...(maximized ? (settings.windowBounds || {}) : mainWindow.getBounds()), maximized };
    writeJson(SETTINGS_FILE, settings);
    writeJson(HISTORY_FILE, history);
  });
}

// Files dropped on the exe / "Open with"
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && AUDIO_EXTS.test(a) && fs.existsSync(a));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const files = filesFromArgv(argv);
    if (files.length) mainWindow.webContents.send('open-files', files);
  });
  app.whenReady().then(() => {
    createWindow();
    const files = filesFromArgv(process.argv);
    if (files.length) mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send('open-files', files));
  });
}
app.on('window-all-closed', () => { media.killAll(); app.quit(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close', () => mainWindow.close());
ipcMain.handle('window-pin', (_, on) => {
  mainWindow.setAlwaysOnTop(!!on);
  settings.alwaysOnTop = !!on; writeJson(SETTINGS_FILE, settings);
  return mainWindow.isAlwaysOnTop();
});
ipcMain.handle('window-state', () => ({ maximized: mainWindow.isMaximized(), pinned: mainWindow.isAlwaysOnTop() }));

// ── App info, settings, history ────────────────────────────────────────────
ipcMain.handle('get-app-info', () => {
  let changelog = '';
  try { changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch (_) {}
  const version = app.getVersion();
  const lastSeen = settings.lastSeenVersion;
  if (lastSeen !== version) {
    log('info', lastSeen ? `Updated from ${lastSeen} to ${version}` : `TuneForge ${version} first run`);
    settings.lastSeenVersion = version; writeJson(SETTINGS_FILE, settings);
  }
  return {
    version, changelog, justUpdated: !!lastSeen && lastSeen !== version, firstRun: !lastSeen,
    portable: !!portableExe, dataDir: DATA_DIR, ffmpeg: res('ffmpeg.exe'),
    darkSystem: nativeTheme.shouldUseDarkColors,
  };
});
ipcMain.handle('settings-get', () => settings);
ipcMain.handle('settings-set', (_, partial) => { settings = { ...settings, ...partial }; writeJson(SETTINGS_FILE, settings); return settings; });
ipcMain.handle('history-get', () => history);
ipcMain.handle('history-clear', () => { history = []; writeJson(HISTORY_FILE, history); return true; });
ipcMain.handle('history-export', async () => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Export log', defaultPath: path.join(app.getPath('documents'), `TuneForge log ${new Date().toISOString().slice(0, 10)}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (!r.filePath) return null;
  const lines = history.map((h) => `${new Date(h.t).toLocaleString()}  [${h.type.toUpperCase()}]  ${h.msg}${h.detail ? `\n    ${String(h.detail).replace(/\n/g, '\n    ')}` : ''}`);
  fs.writeFileSync(r.filePath, lines.join('\n'), 'utf8');
  return r.filePath;
});
ipcMain.on('log', (_, { type, msg, detail }) => log(type, msg, detail));

// ── Update check (GitHub releases) ─────────────────────────────────────────
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
ipcMain.handle('check-update', async () => {
  const current = app.getVersion();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: ctl.signal, headers: { 'User-Agent': 'TuneForge', Accept: 'application/vnd.github+json' },
    });
    clearTimeout(t);
    settings.lastUpdateCheck = Date.now(); writeJson(SETTINGS_FILE, settings);
    if (r.status === 404) return { status: 'none', current, message: 'No releases have been published yet.' };
    if (!r.ok) return { status: 'error', current, message: `GitHub answered ${r.status}` };
    const j = await r.json();
    const latest = (j.tag_name || '').replace(/^v/, '');
    if (latest && newer(latest, current)) {
      log('update', `Version ${latest} is available (you have ${current})`);
      return { status: 'available', current, latest, url: j.html_url, notes: j.body || '', published: j.published_at };
    }
    return { status: 'current', current, latest: latest || current };
  } catch (e) {
    return { status: 'error', current, message: e.name === 'AbortError' ? 'No answer from GitHub' : e.message };
  }
});
ipcMain.handle('open-external', (_, url) => {
  if (/^https:\/\/(github\.com|acoustid\.org|www\.apple\.com|support\.apple\.com|ffmpeg\.org)\//.test(url)) shell.openExternal(url);
});

// ── Files & dialogs ────────────────────────────────────────────────────────
function scanDir(dir, root, out, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !/^\$RECYCLE/i.test(e.name)) scanDir(full, root, out, depth + 1); }
    else if (AUDIO_EXTS.test(e.name) && !e.name.startsWith('.tftmp_')) out.push({ path: full, root });
  }
}
ipcMain.handle('expand-paths', (_, paths) => {
  const out = [];
  for (const p of paths || []) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) scanDir(p, p, out);
      else if (AUDIO_EXTS.test(p)) out.push({ path: p, root: null });
    } catch (_) {}
  }
  return out;
});
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Add audio files', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio & video', extensions: AUDIO_EXT_LIST }, { name: 'All files', extensions: ['*'] }],
  });
  return r.filePaths || [];
});
ipcMain.handle('pick-folders', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Add folders', properties: ['openDirectory', 'multiSelections'] });
  return r.filePaths || [];
});
ipcMain.handle('pick-folder', async (_, { title, defaultPath } = {}) => {
  const r = await dialog.showOpenDialog(mainWindow, { title: title || 'Choose folder', defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return (r.filePaths && r.filePaths[0]) || null;
});
ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose album art', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
  });
  const p = r.filePaths && r.filePaths[0];
  if (!p) return null;
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'image/jpeg';
  return { path: p, dataUrl: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` };
});
ipcMain.handle('show-in-folder', (_, p) => shell.showItemInFolder(p));
ipcMain.handle('open-path', (_, p) => shell.openPath(p));

function itunesFolders() {
  const music = app.getPath('music');
  const cands = [
    path.join(music, 'iTunes', 'iTunes Media', 'Automatically Add to iTunes'),
    path.join(music, 'iTunes', 'iTunes Music', 'Automatically Add to iTunes'),
    path.join(music, 'iTunes', 'Automatically Add to iTunes'),
    path.join(music, 'Apple Music', 'Media', 'Automatically Add to Music'),
    path.join(music, 'Music', 'Media', 'Automatically Add to Music'),
  ];
  return cands.filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } });
}
ipcMain.handle('itunes-folder', () => {
  if (settings.itunesFolder && fs.existsSync(settings.itunesFolder)) return settings.itunesFolder;
  return itunesFolders()[0] || null;
});

// ── Probe ──────────────────────────────────────────────────────────────────
ipcMain.handle('probe', async (_, p, withThumb) => {
  const info = await media.probe(p);
  if (info.ok && withThumb && info.cover) info.thumb = await media.coverThumb(p, info.cover.index, 160);
  return info;
});
ipcMain.handle('cover-full', async (_, p) => {
  const info = await media.probe(p);
  if (!info.ok || !info.cover) return null;
  return media.coverThumb(p, info.cover.index, 600);
});

// ── Naming ─────────────────────────────────────────────────────────────────
function cleanSegment(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 150);
}
function fillTemplate(tpl, tags, srcPath) {
  const t = tags || {};
  const num = (v) => { const n = parseInt(String(v || '').split('/')[0], 10); return n ? String(n).padStart(2, '0') : ''; };
  const map = {
    name: path.parse(srcPath).name, artist: t.artist, title: t.title, album: t.album,
    albumartist: t.album_artist || t.artist, year: String(t.date || '').slice(0, 4), track: num(t.track),
    disc: num(t.disc).replace(/^0/, ''), genre: t.genre, composer: t.composer,
  };
  let missing = false;
  const filled = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = map[k.toLowerCase()];
    if (v == null || v === '') { if (k !== 'track' && k !== 'disc' && k !== 'year') missing = true; return ''; }
    return String(v);
  });
  return { filled, missing };
}
// Builds a relative path (may include folders) from a template; falls back to the original name.
function nameFromTemplate(tpl, tags, srcPath) {
  if (!tpl || !tpl.trim()) return path.parse(srcPath).name;
  const { filled, missing } = fillTemplate(tpl, tags, srcPath);
  const segs = filled.split(/[\\/]+/).map((s) => cleanSegment(s.replace(/^\s*[-–.]\s*|\s*[-–]\s*$/g, ''))).filter(Boolean);
  // a tag the template needs is empty: keep the original name rather than invent "- .mp3"
  if (missing || !segs.length) return path.parse(srcPath).name;
  return segs.join(path.sep);
}
// Output names handed out during the current batch. Parallel jobs can't see each
// other's files until they finish, so two songs with the same tags would collide.
const claimed = new Set();
const taken = (p) => fs.existsSync(p) || claimed.has(p.toLowerCase());
function uniquePath(p) {
  if (!taken(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  let i = 2;
  while (taken(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function removeSource(p) {
  try { await shell.trashItem(p); return 'recycled'; } catch (_) {
    try { fs.unlinkSync(p); return 'deleted'; } catch (e) { return `could not remove: ${e.message}`; }
  }
}

// ── Convert ────────────────────────────────────────────────────────────────
let cancelRequested = false;
ipcMain.handle('convert-begin', () => { cancelRequested = false; claimed.clear(); return true; });
ipcMain.handle('convert-cancel', () => { cancelRequested = true; media.killAll(); log('info', 'Conversion stopped by user'); return true; });

ipcMain.handle('convert-one', async (_, { id, input, root, settings: s }) => {
  if (cancelRequested) throw new Error('Canceled');
  const f = FORMATS[s.format];
  if (!f) throw new Error(`Unknown format ${s.format}`);
  const info = await media.probe(input);
  if (!info.ok) { log('error', `Could not read ${path.basename(input)}`, info.error); throw new Error(info.error); }

  // Where the file goes
  const srcDir = path.dirname(input);
  let dir = srcDir;
  if (s.outMode === 'folder' && s.outDir) {
    dir = s.outDir;
    if (s.keepStructure && root) dir = path.join(s.outDir, path.basename(root), path.relative(root, srcDir));
  }
  const rel = nameFromTemplate(s.nameTemplate, info.tags, input);
  const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  const fileName = cleanSegment(`${s.prefix || ''}${path.basename(rel)}${s.suffix || ''}`) || 'audio';
  let out = path.join(dir, relDir, `${fileName}.${f.ext}`);
  const replacingSource = samePath(out, input);

  if (claimed.has(out.toLowerCase())) {
    // another file in this batch already makes this name: never overwrite or skip a sibling
    out = uniquePath(out);
  } else if (fs.existsSync(out)) {
    if (s.conflict === 'skip') {
      log('convert', `Skipped ${path.basename(input)}`, `${out} already exists`);
      return { status: 'skipped', output: out, reason: 'Already exists' };
    }
    if (s.conflict !== 'overwrite') out = uniquePath(out);
  }
  claimed.add(out.toLowerCase());
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const tmpOut = path.join(path.dirname(out), `.tftmp_${id}_${Date.now()}.${f.ext}`);
  const { args, cleanup } = await media.buildConvertArgs(input, tmpOut, info, s);
  const started = Date.now();
  try {
    await media.runFfmpeg(args, (sec) => mainWindow.webContents.send('convert-progress', { id, sec }));
    if (cancelRequested) throw new Error('Canceled');
    media.replaceFile(tmpOut, out);
  } catch (e) {
    media.rmQuiet(tmpOut);
    if (cancelRequested || /Canceled/.test(e.message)) throw new Error('Canceled');
    log('error', `Failed: ${path.basename(input)} → ${f.label}`, `${e.message}\n\nffmpeg ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    throw e;
  } finally { cleanup.forEach(media.rmQuiet); }

  // Check the result really is complete and kept what it should have
  const outInfo = await media.probe(out);
  const warnings = [];
  if (!outInfo.ok) warnings.push('Output could not be read back');
  else {
    if (!s.trimSilence && info.duration > 2 && outInfo.duration < info.duration * 0.97) warnings.push(`Output is shorter (${outInfo.duration.toFixed(1)}s vs ${info.duration.toFixed(1)}s)`);
    if (s.keepCover !== false && info.cover && f.cover && !outInfo.cover) warnings.push('Album art did not carry over');
    if (s.keepCover !== false && info.cover && !f.cover) warnings.push(`${f.label} can't hold album art`);
  }
  if (!info.lossless && f.kind !== 'lossy') warnings.push('Source was lossy: this lossless copy is bigger but not better');

  let sourceNote = '';
  if (s.deleteSource && !replacingSource && outInfo.ok) sourceNote = await removeSource(input);

  let itunesNote = '';
  if (s.addToItunes && f.itunes) {
    const dest = settings.itunesFolder && fs.existsSync(settings.itunesFolder) ? settings.itunesFolder : itunesFolders()[0];
    if (dest) {
      try { fs.copyFileSync(out, uniquePath(path.join(dest, path.basename(out)))); itunesNote = 'sent to iTunes'; }
      catch (e) { warnings.push(`Could not copy to iTunes: ${e.message}`); }
    } else warnings.push('iTunes "Automatically Add" folder not found');
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log('convert', `${path.basename(input)} → ${path.basename(out)}`,
    [`${f.label}, ${secs}s, ${(outInfo.size / 1048576).toFixed(2)} MB (was ${(info.size / 1048576).toFixed(2)} MB)`,
      replacingSource ? 'replaced the source file' : '', sourceNote ? `source ${sourceNote}` : '', itunesNote, ...warnings].filter(Boolean).join('\n'));
  return { status: 'done', output: out, size: outInfo.size, warnings, sourceNote, replacedSource: replacingSource };
});

// ── Tag Fixer ──────────────────────────────────────────────────────────────
let fpcache = new Map();
ipcMain.handle('identify', async (_, { filePath, override }) => {
  const info = await media.probe(filePath);
  if (!info.ok) return { error: info.error, candidates: [], covers: [] };
  let fp = null;
  if (settings.acoustidKey && settings.useFingerprint !== false && !override) {
    fp = fpcache.get(filePath) || await media.fingerprint(filePath);
    if (fp) fpcache.set(filePath, fp);
  }
  const r = await lookup.identify({
    fileName: path.basename(filePath), tags: info.tags, duration: info.duration, fingerprint: fp,
    acoustidKey: settings.acoustidKey, country: settings.storeCountry || 'us', override,
  });
  if (r.fingerprint && r.fingerprint.error) log('error', `AcoustID lookup failed for ${path.basename(filePath)}`, r.fingerprint.error);
  return r;
});
ipcMain.handle('complete-candidate', async (_, c) => lookup.completeDeezer(c));

async function downloadImage(url) {
  if (!/^https:\/\//.test(url)) throw new Error('Bad image address');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'TuneForge' } });
    if (!r.ok) throw new Error(`Image download failed (HTTP ${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const p = media.tmpFile(isPng ? 'png' : 'jpg');
    fs.writeFileSync(p, buf);
    return p;
  } finally { clearTimeout(t); }
}

ipcMain.handle('tags-write', async (_, { filePath, tags, cover, rename }) => {
  let coverArg = { mode: 'keep' };
  let tmpImg = null;
  try {
    if (cover && cover.mode === 'url') { tmpImg = await downloadImage(cover.url); coverArg = { mode: 'file', path: tmpImg }; }
    else if (cover && cover.mode === 'file') coverArg = { mode: 'file', path: cover.path };
    else if (cover && cover.mode === 'remove') coverArg = { mode: 'remove' };
    const before = (await media.probe(filePath)).tags || {};
    await media.writeTags(filePath, tags, coverArg);

    let finalPath = filePath;
    if (rename && rename.mode && rename.mode !== 'keep') {
      const merged = { ...before, ...tags };
      const ext = path.extname(filePath);
      const tpl = rename.mode === 'organize' ? (rename.organizeTemplate || '{albumartist}/{album}/{track} {title}') : (rename.template || '{artist} - {title}');
      const rel = nameFromTemplate(tpl, merged, filePath);
      const baseDir = rename.mode === 'organize' && rename.root ? rename.root : path.dirname(filePath);
      let target = path.join(baseDir, `${rel}${ext}`);
      if (!samePath(target, filePath)) {
        if (fs.existsSync(target)) target = uniquePath(target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try { fs.renameSync(filePath, target); } catch (_) { fs.copyFileSync(filePath, target); fs.unlinkSync(filePath); }
        finalPath = target;
      }
    }
    const changed = Object.keys(tags).filter((k) => String(before[k] || '') !== String(tags[k] || ''))
      .map((k) => `${k}: "${before[k] || ''}" → "${tags[k] || ''}"`);
    if (cover && cover.mode !== 'keep') changed.push(`album art: ${cover.mode === 'remove' ? 'removed' : 'replaced'}`);
    if (finalPath !== filePath) changed.push(`renamed to ${finalPath}`);
    log('tags', `Saved tags: ${path.basename(finalPath)}`, changed.join('\n') || 'no changes');
    return { ok: true, path: finalPath };
  } catch (e) {
    log('error', `Could not save tags for ${path.basename(filePath)}`, e.message);
    throw e;
  } finally { media.rmQuiet(tmpImg); }
});
