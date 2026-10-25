/* global Formats */
const { FORMATS, describeQuality, estimateBytes, qualityPlan } = Formats;

// ═══ Utilities ═══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseName = (p) => p.split(/[\\/]/).pop();
const dirName = (p) => p.replace(/[\\/][^\\/]*$/, '');
function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtSize(b) {
  if (!b) return '0 MB';
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(2)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
let toastTimer;
function toast(msg, type = '', ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.className = `show ${type}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, ms);
}
let uid = 0;
const nextId = () => `f${++uid}`;

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}

// ═══ Modals ═════════════════════════════════════════════════════════════════
function openModal(id) { $(id).classList.add('active'); }
function closeModal(id) { $(id).classList.remove('active'); }
document.querySelectorAll('.overlay').forEach((ov) => {
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) closeModal(ov.id); });
});
function confirmBox(title, html, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-body').innerHTML = html;
    const ok = $('confirm-ok');
    ok.textContent = okLabel; ok.className = `btn small${danger ? ' danger' : ''}`;
    const done = (v) => { closeModal('modal-confirm'); ok.onclick = null; obs.disconnect(); resolve(v); };
    ok.onclick = () => done(true);
    const obs = new MutationObserver(() => { if (!$('modal-confirm').classList.contains('active')) done(false); });
    obs.observe($('modal-confirm'), { attributes: true, attributeFilter: ['class'] });
    openModal('modal-confirm');
    ok.focus();
  });
}

// ═══ Floating tips ══════════════════════════════════════════════════════════
const tipEl = $('tip');
let tipTimer = null, tipTarget = null;
function placeTip(el) {
  const r = el.getBoundingClientRect();
  tipEl.style.left = '0px'; tipEl.style.top = '0px';
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  let x = Math.min(window.innerWidth - tw - 10, Math.max(10, r.left + r.width / 2 - tw / 2));
  let y = r.bottom + 8;
  if (y + th > window.innerHeight - 10) y = r.top - th - 8;
  tipEl.style.left = `${x}px`; tipEl.style.top = `${Math.max(10, y)}px`;
}
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el === tipTarget) return;
  tipTarget = el;
  clearTimeout(tipTimer);
  tipEl.classList.remove('show');
  if (!el) return;
  tipTimer = setTimeout(() => {
    const txt = el.getAttribute('data-tip');
    if (!txt || !document.body.contains(el)) return;
    tipEl.textContent = txt;
    placeTip(el);
    tipEl.classList.add('show');
  }, el.classList.contains('info') ? 120 : 450);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tipEl.classList.remove('show'); });

// ═══ Window, tabs, theme ════════════════════════════════════════════════════
$('btn-min').onclick = () => api.minimize();
$('btn-max').onclick = () => api.maximize();
$('btn-close').onclick = () => api.close();
async function setPin(on) {
  const st = await api.pin(on);
  $('btn-pin').classList.toggle('on', st);
  $('btn-pin').setAttribute('data-tip', st ? 'Pinned on top. Click to unpin' : 'Keep TuneForge on top of other windows');
  $('set-pin').checked = st;
}
$('btn-pin').onclick = () => setPin(!$('btn-pin').classList.contains('on'));
api.onWindowState((s) => { $('btn-max').innerHTML = s.maximized ? '&#x2750;' : '&#x25A1;'; });
$('titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) api.maximize(); });

let activeTab = 'convert';
function showTab(name) {
  activeTab = name;
  clearTimeout(tipTimer); tipEl.classList.remove('show'); tipTarget = null;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'history') { unseenErrors = 0; $('hist-badge').textContent = ''; renderHistory(); }
}
document.querySelectorAll('.tab-btn').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('btn-theme').textContent = dark ? '☾' : '☀';
  $('btn-theme').setAttribute('data-tip', dark ? 'Dark mode. Click for light mode' : 'Light mode. Click for dark mode');
  if ($('set-theme')) $('set-theme').value = t;
}
darkQuery.addEventListener('change', applyTheme);
$('btn-theme').onclick = () => {
  persist({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
  applyTheme();
};

// ═══ Settings ═══════════════════════════════════════════════════════════════
let settings = {};
let appInfo = {};
const saveSettings = debounce((partial) => api.setSettings(partial), 300);
function persist(partial) { Object.assign(settings, partial); saveSettings(partial); }

const CPU = navigator.hardwareConcurrency || 4;
const DEFAULTS = {
  preset: 'itunes-aac', format: 'aac', quality: 86, mode: 'vbr', sampleRate: 'keep', channels: 'keep', bitDepth: 'keep', flacLevel: 5,
  normalize: false, loudness: -14, trimSilence: false, keepTags: true, keepCover: true, autoTags: false,
  outMode: 'source', outDir: '', keepStructure: true, nameTemplate: '', customTemplate: '{artist} - {title}', prefix: '', suffix: '',
  conflict: 'number', deleteSource: false, openFolder: true, addToItunes: false, parallel: Math.max(1, Math.min(4, Math.floor(CPU / 2))),
};
let S = { ...DEFAULTS };
const SOUND_KEYS = ['format', 'quality', 'mode', 'sampleRate', 'channels', 'bitDepth', 'flacLevel', 'normalize', 'loudness', 'trimSilence'];
const saveConvert = debounce(() => api.setSettings({ convert: S }), 400);

// ═══ Presets ════════════════════════════════════════════════════════════════
const SOUND_DEFAULTS = { mode: 'vbr', sampleRate: 'keep', channels: 'keep', bitDepth: 'keep', flacLevel: 5, normalize: false, loudness: -14, trimSilence: false };
const BUILTIN_PRESETS = [
  { id: 'itunes-aac', icon: '🍎', name: 'iTunes AAC 256', tip: 'AAC at 256 kbps in an .m4a: exactly what the iTunes Store sells. Plays on every Apple device and almost everything else.', s: { format: 'aac', quality: 86 } },
  { id: 'alac', icon: '💿', name: 'Apple Lossless', tip: 'A perfect copy that iTunes, iPhone and Apple Music can play. Use it to bring FLAC or WAV into iTunes without losing anything.', s: { format: 'alac' } },
  { id: 'mp3-v0', icon: '🎧', name: 'MP3 V0', tip: 'Best-quality MP3 (variable, about 245 kbps). Plays on absolutely anything.', s: { format: 'mp3', mode: 'vbr', quality: 100 } },
  { id: 'mp3-320', icon: '🔊', name: 'MP3 320', tip: 'MP3 at a constant 320 kbps, the maximum. For players or DJ software that want a fixed bitrate. V0 sounds the same and is smaller.', s: { format: 'mp3', mode: 'cbr', quality: 100 } },
  { id: 'mp3-small', icon: '📱', name: 'MP3 small', tip: 'MP3 V5 (about 130 kbps). Half the size of V0, fine for phones and the car.', s: { format: 'mp3', mode: 'vbr', quality: 45 } },
  { id: 'flac', icon: '📦', name: 'FLAC archive', tip: 'FLAC at maximum compression: the smallest perfect copy, for keeping a master library. Not playable in iTunes.', s: { format: 'flac', flacLevel: 8 } },
  { id: 'wav-cd', icon: '🎚️', name: 'WAV (CD)', tip: '16-bit, 44.1 kHz stereo WAV: CD quality, for burning discs or editing software.', s: { format: 'wav', bitDepth: '16', sampleRate: '44100', channels: '2' } },
  { id: 'opus', icon: '🌐', name: 'Opus 128', tip: 'Opus at 128 kbps: sounds as good as a 256 kbps MP3 at half the size. Not playable in iTunes.', s: { format: 'opus', quality: 57 } },
  { id: 'voice', icon: '🎙️', name: 'Podcast / voice', tip: 'Mono MP3 at 96 kbps with loudness evened out to -16 LUFS (the podcast standard).', s: { format: 'mp3', mode: 'cbr', quality: 14, channels: '1', normalize: true, loudness: -16 } },
  { id: 'audiobook', icon: '📚', name: 'Audiobook', tip: 'Mono 64 kbps AAC in .m4b. iTunes files it under Audiobooks and remembers where you stopped.', s: { format: 'm4b', quality: 40, channels: '1' } },
];
function allPresets() { return [...BUILTIN_PRESETS, ...(settings.customPresets || []).map((p) => ({ ...p, custom: true }))]; }
function presetMatches(p) { const full = { ...SOUND_DEFAULTS, ...p.s }; return SOUND_KEYS.every((k) => full[k] === undefined || String(full[k]) === String(S[k])); }
function renderPresets() {
  const row = $('preset-row');
  row.innerHTML = '';
  for (const p of allPresets()) {
    const b = document.createElement('button');
    b.className = `preset-btn${presetMatches(p) ? ' active' : ''}`;
    b.setAttribute('data-tip', p.tip || summarizeSound(p.s));
    b.innerHTML = `${esc(p.icon || '★')} ${esc(p.name)}${p.custom ? '<span class="del" data-del="1">✕</span>' : ''}`;
    b.onclick = async (e) => {
      if (e.target.dataset.del) {
        if (await confirmBox('Delete preset', `Delete the preset <strong>${esc(p.name)}</strong>?`, 'Delete', true)) {
          persist({ customPresets: (settings.customPresets || []).filter((x) => x.id !== p.id) });
          renderPresets();
        }
        return;
      }
      Object.assign(S, SOUND_DEFAULTS, p.s);
      syncControls(); onSettingsChanged();
      toast(`Preset: ${p.name}`);
    };
    row.appendChild(b);
  }
}
function summarizeSound(s) {
  const f = FORMATS[s.format];
  if (!f) return '';
  const parts = [f.label];
  if (f.kind === 'lossy') parts.push(qualityPlan(s.format, s.quality, s.mode).label);
  if (s.channels && s.channels !== 'keep') parts.push({ 1: 'mono', 2: 'stereo', 6: '5.1' }[s.channels]);
  if (s.sampleRate && s.sampleRate !== 'keep') parts.push(`${s.sampleRate / 1000} kHz`);
  if (s.bitDepth && s.bitDepth !== 'keep' && f.kind !== 'lossy') parts.push(`${s.bitDepth}-bit`);
  if (s.normalize) parts.push(`${s.loudness} LUFS`);
  if (s.trimSilence) parts.push('trim silence');
  return parts.join(' · ');
}
$('preset-save').onclick = () => {
  $('preset-name').value = '';
  $('preset-summary').textContent = `Saves: ${summarizeSound(S)}`;
  openModal('modal-preset');
  setTimeout(() => $('preset-name').focus(), 50);
};
function savePreset() {
  const name = $('preset-name').value.trim();
  if (!name) { $('preset-name').focus(); return; }
  const s = {}; SOUND_KEYS.forEach((k) => { s[k] = S[k]; });
  const list = (settings.customPresets || []).filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  list.push({ id: `c${Date.now()}`, name, icon: '★', s, tip: summarizeSound(s) });
  persist({ customPresets: list });
  closeModal('modal-preset'); renderPresets(); toast(`Saved preset “${name}”`, 'success');
}
$('preset-name-ok').onclick = savePreset;
$('preset-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); });

// ═══ Convert settings controls ══════════════════════════════════════════════
const fmtSel = $('s-format');
fmtSel.innerHTML = `<optgroup label="iTunes / Apple">${['aac', 'alac', 'mp3', 'aiff', 'wav', 'm4b'].map((k) => `<option value="${k}">${FORMATS[k].label}</option>`).join('')}</optgroup>` +
  `<optgroup label="Other">${['flac', 'opus', 'ogg', 'wma', 'ac3'].map((k) => `<option value="${k}">${FORMATS[k].label}</option>`).join('')}</optgroup>`;

function bindSeg(id, key) {
  $(id).querySelectorAll('button').forEach((b) => { b.onclick = () => { S[key] = b.dataset.v; syncControls(); onSettingsChanged(); }; });
}
bindSeg('s-mode', 'mode');
bindSeg('s-outmode', 'outMode');
const bindings = [
  ['s-format', 'format'], ['s-rate', 'sampleRate'], ['s-channels', 'channels'], ['s-bits', 'bitDepth'], ['s-flac', 'flacLevel', Number],
  ['s-loud', 'loudness', Number], ['s-conflict', 'conflict'], ['s-parallel', 'parallel', Number], ['s-prefix', 'prefix'], ['s-suffix', 'suffix'],
  ['s-template-custom', 'customTemplate'],
];
for (const [id, key, cast] of bindings) {
  const el = $(id);
  const ev = el.tagName === 'INPUT' ? 'input' : 'change';
  el.addEventListener(ev, () => { S[key] = cast ? cast(el.value) : el.value; if (id === 's-format') syncControls(); else updateDerived(); onSettingsChanged(); });
}
const checks = [['s-normalize', 'normalize'], ['s-trim', 'trimSilence'], ['s-keeptags', 'keepTags'], ['s-keepcover', 'keepCover'], ['s-autotags', 'autoTags'],
  ['s-structure', 'keepStructure'], ['s-delete', 'deleteSource'], ['s-open', 'openFolder'], ['s-itunes', 'addToItunes']];
for (const [id, key] of checks) $(id).addEventListener('change', () => { S[key] = $(id).checked; updateDerived(); onSettingsChanged(); });
$('s-template').addEventListener('change', () => { S.nameTemplate = $('s-template').value; updateDerived(); onSettingsChanged(); });
$('s-quality').addEventListener('input', () => { S.quality = +$('s-quality').value; $('s-quality-num').value = S.quality; updateDerived(); onSettingsChanged(); });
$('s-quality-num').addEventListener('change', () => { S.quality = Math.max(0, Math.min(100, +$('s-quality-num').value || 0)); $('s-quality').value = S.quality; updateDerived(); onSettingsChanged(); });
$('s-outdir').onclick = async () => {
  const p = await api.pickFolder({ title: 'Save converted files to', defaultPath: S.outDir || undefined });
  if (p) { S.outDir = p; syncControls(); onSettingsChanged(); }
};
$('s-outdir-open').onclick = () => { if (S.outDir) api.openPath(S.outDir); };

function syncControls() {
  const f = FORMATS[S.format];
  if (f && f.modes && !f.modes.includes(S.mode)) S.mode = f.modes[0];
  fmtSel.value = S.format;
  $('s-quality').value = S.quality; $('s-quality-num').value = S.quality;
  $('s-rate').value = String(S.sampleRate); $('s-channels').value = String(S.channels); $('s-bits').value = String(S.bitDepth);
  $('s-flac').value = String(S.flacLevel); $('s-loud').value = String(S.loudness);
  $('s-conflict').value = S.conflict; $('s-parallel').value = String(S.parallel);
  $('s-prefix').value = S.prefix; $('s-suffix').value = S.suffix;
  const known = [...$('s-template').options].some((o) => o.value === S.nameTemplate);
  $('s-template').value = known ? S.nameTemplate : 'custom';
  if (!known) S.customTemplate = S.nameTemplate || S.customTemplate;
  $('s-template-custom').value = S.customTemplate || '';
  $('s-outdir').value = S.outDir || '';
  for (const [id, key] of checks) $(id).checked = !!S[key];
  $('s-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === S.mode));
  $('s-outmode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === S.outMode));
  updateDerived();
}

function effectiveTemplate() { return S.nameTemplate === 'custom' ? (S.customTemplate || '') : S.nameTemplate; }

function updateDerived() {
  const f = FORMATS[S.format];
  const lossy = f.kind === 'lossy';
  $('f-mode').classList.toggle('hidden', !lossy || (f.modes || []).length < 2);
  $('f-quality').style.opacity = lossy ? '1' : '0.4';
  $('s-quality').disabled = !lossy; $('s-quality-num').disabled = !lossy;
  $('f-flac').classList.toggle('hidden', S.format !== 'flac');
  $('f-bits').classList.toggle('hidden', lossy);
  $('f-loud').classList.toggle('hidden', !S.normalize);
  $('f-outdir').classList.toggle('hidden', S.outMode !== 'folder');
  $('s-template-custom').classList.toggle('hidden', $('s-template').value !== 'custom');
  const qe = $('quality-explain');
  qe.textContent = describeQuality(S.format, S.quality, S.mode);
  qe.classList.toggle('lossless', !lossy);

  const it = f.itunes ? '<span class="badge ok">✓ iTunes</span>' : '<span class="badge no">✗ not in iTunes</span>';
  const art = f.cover ? '<span class="badge ok">art</span>' : '<span class="badge warn">no art</span>';
  $('fmt-blurb').innerHTML = `${esc(f.blurb)}<br><span style="display:inline-flex;gap:5px;margin-top:5px">${it}${art}${f.tags ? '' : '<span class="badge warn">no tags</span>'}</span>`;

  const warn = [];
  if (!f.tags) warn.push(`${f.label} can't store tags, so artist/title/album will be lost.`);
  else if (!f.cover && S.keepCover) warn.push(`${f.label} can't store album art. Pick AIFF instead of WAV to keep it.`);
  $('tags-warn').textContent = warn.join(' ');
  $('tags-warn').classList.toggle('hidden', !warn.length);

  // iTunes option only makes sense for formats iTunes plays
  $('lbl-itunes').style.opacity = f.itunes && itunesFolder ? '1' : '0.45';
  $('s-itunes').disabled = !f.itunes || !itunesFolder;
  $('itunes-tip').setAttribute('data-tip', itunesFolder
    ? `Copies each finished file into:\n${itunesFolder}\n\niTunes picks files up from there and adds them to your library by artist and album, artwork included.\n\nOnly for formats iTunes plays: MP3, AAC, Apple Lossless, AIFF, WAV.`
    : 'iTunes\' "Automatically Add to iTunes" folder was not found. Set it in Settings if iTunes is installed somewhere unusual.');

  $('sum-format').textContent = summarizeSound(S).split(' · ').slice(0, 2).join(' · ');
  const snd = [];
  if (S.sampleRate !== 'keep') snd.push(`${S.sampleRate / 1000}k`);
  if (S.channels !== 'keep') snd.push({ 1: 'mono', 2: 'stereo', 6: '5.1' }[S.channels]);
  if (!lossy && S.bitDepth !== 'keep') snd.push(`${S.bitDepth}-bit`);
  if (S.normalize) snd.push(`${S.loudness} LUFS`);
  if (S.trimSilence) snd.push('trim');
  $('sum-sound').textContent = snd.join(' · ') || 'as source';
  $('sum-tags').textContent = [S.keepTags && f.tags ? 'tags' : '', S.keepCover && f.cover ? 'art' : ''].filter(Boolean).join(' + ') || 'none kept';
  $('sum-output').textContent = S.outMode === 'folder' ? (S.outDir ? baseName(S.outDir) : 'choose folder') : 'next to source';

  renderNameExample();
  renderPresets();
  renderConvTotals();
  refreshConvBadges();
}

function onSettingsChanged() { saveConvert(); updateGo(); }

// Same rules as main.js nameFromTemplate, for the preview line.
function previewName(tpl, tags, srcPath) {
  const orig = baseName(srcPath).replace(/\.[^.]+$/, '');
  if (!tpl || !tpl.trim()) return orig;
  const num = (v) => { const n = parseInt(String(v || '').split('/')[0], 10); return n ? String(n).padStart(2, '0') : ''; };
  const t = tags || {};
  const map = { name: orig, artist: t.artist, title: t.title, album: t.album, albumartist: t.album_artist || t.artist, year: String(t.date || '').slice(0, 4),
    track: num(t.track), disc: num(t.disc).replace(/^0/, ''), genre: t.genre, composer: t.composer };
  let missing = false;
  const filled = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = map[k.toLowerCase()];
    if (v == null || v === '') { if (!['track', 'disc', 'year'].includes(k)) missing = true; return ''; }
    return String(v);
  });
  const segs = filled.split(/[\\/]+/).map((s) => s.replace(/[<>:"|?*]/g, '_').replace(/^\s*[-–.]\s*|\s*[-–]\s*$/g, '').trim()).filter(Boolean);
  return missing || !segs.length ? orig : segs.join('\\');
}
function outputPathFor(item) {
  const f = FORMATS[S.format];
  const rel = previewName(effectiveTemplate(), item.info && item.info.tags, item.path);
  const parts = rel.split('\\');
  const file = `${S.prefix || ''}${parts.pop()}${S.suffix || ''}.${f.ext}`;
  let dir = dirName(item.path);
  if (S.outMode === 'folder') {
    dir = S.outDir || '(choose a folder)';
    if (S.keepStructure && item.root && S.outDir) {
      const rootName = baseName(item.root);
      const sub = dirName(item.path).slice(item.root.length).replace(/^[\\/]/, '');
      dir = [S.outDir, rootName, sub].filter(Boolean).join('\\');
    }
  }
  return [dir, ...parts, file].join('\\');
}
function renderNameExample() {
  const item = convQueue.find((q) => q.info && q.info.ok);
  const sample = item || { path: 'C:\\Music\\01 Yellow.flac', info: { tags: { artist: 'Coldplay', title: 'Yellow', album: 'Parachutes', album_artist: 'Coldplay', track: '5/10', date: '2000' } } };
  const out = outputPathFor(sample);
  const same = item && out.toLowerCase() === item.path.toLowerCase();
  $('name-example').innerHTML = `<span>${item ? 'First file becomes' : 'Example'}:</span><br>${esc(out)}` +
    (same ? `<br><span style="color:var(--warn)">⚠ same name as the original: ${S.conflict === 'overwrite' ? 'it will be replaced' : S.conflict === 'skip' ? 'it will be skipped' : 'a number is added'}</span>` : '');
}

// ═══ Convert queue ══════════════════════════════════════════════════════════
let convQueue = [];
let converting = false;
let itunesFolder = null;

async function addToConvert(paths) {
  const found = await api.expandPaths(paths);
  const have = new Set(convQueue.map((q) => q.path.toLowerCase()));
  const fresh = found.filter((f) => !have.has(f.path.toLowerCase()) && have.add(f.path.toLowerCase()));
  if (!fresh.length) { toast(found.length ? 'Those files are already in the queue' : 'No audio files found there'); return; }
  const items = fresh.map((f) => ({ id: nextId(), path: f.path, root: f.root, info: null, status: 'pending', progress: 0 }));
  convQueue.push(...items);
  renderConvList();
  toast(`Added ${items.length} file${items.length > 1 ? 's' : ''}`);
  await pool(items, 4, async (it) => {
    it.info = await api.probe(it.path, true);
    if (!it.info.ok) { it.status = 'error'; it.error = it.info.error; }
    renderConvRow(it);
    renderConvTotalsDebounced();
  });
  renderNameExample();
  updateGo();
}

function convBadges(it) {
  const f = FORMATS[S.format];
  const i = it.info;
  if (!i || !i.ok) return '';
  const b = [];
  const plan = f.kind === 'lossy' ? qualityPlan(S.format, S.quality, S.mode) : null;
  if (i.hasVideo) b.push('<span class="badge info" data-tip="This is a video file. Only its sound is converted.">video → audio</span>');
  if (!i.lossless && f.kind !== 'lossy') b.push('<span class="badge warn" data-tip="The original is already lossy (MP3/AAC…). A lossless copy is bigger but sounds exactly like the original, not better.">lossy → lossless</span>');
  else if (plan && !i.lossless && i.bitrate && plan.kbps > i.bitrate * 1.15) b.push(`<span class="badge warn" data-tip="The original is only ${i.bitrate} kbps. Converting it at ${plan.kbps} kbps makes a bigger file but can't bring back detail that's already gone.">source ${i.bitrate}k</span>`);
  if (i.cover) b.push(f.cover && S.keepCover ? '<span class="badge ok" data-tip="Has album art. It will be copied into the new file.">🖼 art</span>'
    : `<span class="badge warn" data-tip="${f.cover ? 'Keep album art is off.' : `${f.label} can't hold album art.`}">art dropped</span>`);
  else b.push('<span class="badge muted" data-tip="No album art in this file. The Tag Fixer can find one.">no art</span>');
  return b.join(' ');
}

function convRowHtml(it) {
  const i = it.info;
  const thumb = i && i.thumb ? `<img src="${i.thumb}">` : (i && i.hasVideo ? '🎬' : '🎵');
  let tagsLine = '<span style="opacity:.5">reading…</span>', meta = '', tagsCls = '';
  if (i && i.ok) {
    const t = i.tags;
    if (t.artist || t.title) tagsLine = esc([t.artist, t.title].filter(Boolean).join(' — ') + (t.album ? ` · ${t.album}` : ''));
    else { tagsLine = 'No artist or title tags'; tagsCls = ' missing'; }
    meta = [(i.codec || '').toUpperCase(), i.bitrate ? `${i.bitrate} kbps` : '', i.sampleRate ? `${(i.sampleRate / 1000).toFixed(1).replace('.0', '')} kHz` : '',
      i.bits && i.lossless ? `${i.bits}-bit` : '', i.channels === 1 ? 'mono' : i.channels > 2 ? `${i.channels}ch` : '', fmtDur(i.duration), fmtSize(i.size)].filter(Boolean).join(' · ');
  } else if (i && !i.ok) { tagsLine = esc(i.error); tagsCls = ' missing'; }
  const st = {
    pending: '<span class="status pending">queued</span>',
    working: `<span class="status working">${Math.round(it.progress * 100)}%</span>`,
    done: `<span class="status done" data-tip="${esc(it.output || '')}${it.warnings && it.warnings.length ? `\n\n⚠ ${esc(it.warnings.join('\n⚠ '))}` : ''}\n\nClick to show in folder">${it.warnings && it.warnings.length ? '✓ done ⚠' : '✓ done'}</span>`,
    skipped: `<span class="status skipped" data-tip="${esc(it.reason || '')}">skipped</span>`,
    error: `<span class="status error" data-tip="${esc(it.error || 'Failed')}\n\nThe full message is in History.">failed</span>`,
  }[it.status];
  return `<div class="thumb">${thumb}</div>
    <div class="file-info">
      <div class="file-name" title="${esc(it.path)}">${esc(baseName(it.path))}</div>
      <div class="file-tags${tagsCls}">${tagsLine}</div>
      <div class="file-meta">${meta}</div>
    </div>
    <div class="conv-badges" style="display:flex;gap:4px;flex-shrink:0">${convBadges(it)}</div>
    ${st}
    <button class="remove-btn" data-tip="Remove from queue">✕</button>
    <div class="row-progress" style="width:${it.status === 'working' ? it.progress * 100 : 0}%"></div>`;
}
function renderConvRow(it) {
  const li = document.querySelector(`#conv-list li[data-id="${it.id}"]`);
  if (!li) return;
  li.innerHTML = convRowHtml(it);
}
function renderConvList() {
  const ul = $('conv-list');
  if (!convQueue.length) {
    ul.innerHTML = `<li class="empty-state"><div class="empty-icon">🎵</div><div class="empty-title">Nothing queued yet</div>
      <div class="empty-sub">Drop songs or folders anywhere on this window,<br>or press Ctrl+O</div></li>`;
  } else {
    ul.innerHTML = '';
    for (const it of convQueue) {
      const li = document.createElement('li');
      li.className = 'file-item'; li.dataset.id = it.id;
      li.innerHTML = convRowHtml(it);
      ul.appendChild(li);
    }
  }
  renderConvTotals(); updateGo();
}
$('conv-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const it = convQueue.find((q) => q.id === li.dataset.id);
  if (!it) return;
  if (e.target.closest('.remove-btn')) {
    if (converting && it.status === 'working') return toast('That file is converting right now');
    convQueue = convQueue.filter((q) => q !== it); renderConvList(); renderNameExample();
  } else if (e.target.closest('.status.done') && it.output) api.showInFolder(it.output);
});
function refreshConvBadges() {
  for (const it of convQueue) {
    const el = document.querySelector(`#conv-list li[data-id="${it.id}"] .conv-badges`);
    if (el) el.innerHTML = convBadges(it);
  }
}
function renderConvTotals() {
  const ready = convQueue.filter((q) => q.info && q.info.ok);
  $('conv-title').textContent = `Queue — ${convQueue.length} file${convQueue.length === 1 ? '' : 's'}`;
  const el = $('conv-totals');
  if (!ready.length) { el.classList.add('hidden'); return; }
  const dur = ready.reduce((a, q) => a + (q.info.duration || 0), 0);
  const inSize = ready.reduce((a, q) => a + (q.info.size || 0), 0);
  const est = ready.reduce((a, q) => a + estimateBytes(S.format, S.quality, S.mode, q.info, S), 0);
  const noArt = ready.filter((q) => !q.info.cover).length;
  const noTags = ready.filter((q) => !q.info.tags.artist && !q.info.tags.title).length;
  el.innerHTML = `<span>Length <strong>${fmtDur(dur)}</strong></span><span>Now <strong>${fmtSize(inSize)}</strong></span>` +
    `<span data-tip="Estimate. Lossless sizes depend on the music itself.">After ≈ <strong>${fmtSize(est)}</strong></span>` +
    (noArt ? `<span class="warn" data-tip="These files have no album art. Tick 'Check tags in the Tag Fixer when done' to look covers up online.">${noArt} without art</span>` : '') +
    (noTags ? `<span class="warn">${noTags} without tags</span>` : '');
  el.classList.remove('hidden');
}
const renderConvTotalsDebounced = debounce(renderConvTotals, 150);

$('conv-add-files').onclick = async () => { const p = await api.pickFiles(); if (p.length) addToConvert(p); };
$('conv-add-folder').onclick = async () => { const p = await api.pickFolders(); if (p.length) addToConvert(p); };
$('conv-drop').addEventListener('click', (e) => { if (!e.target.closest('button')) $('conv-add-files').click(); });
$('conv-clear').onclick = () => { if (converting) return; convQueue = []; renderConvList(); renderNameExample(); };
$('conv-clear-done').onclick = () => { convQueue = convQueue.filter((q) => q.status !== 'done' && q.status !== 'skipped'); renderConvList(); };
$('conv-to-tags').onclick = () => {
  const paths = convQueue.filter((q) => q.info && q.info.ok).map((q) => (q.status === 'done' && q.output ? q.output : q.path));
  if (!paths.length) return toast('Nothing in the queue to send');
  addToTags(paths); showTab('tags');
};

function updateGo() {
  const btn = $('conv-go');
  if (converting) { btn.disabled = false; return; }
  const todo = convQueue.filter((q) => q.info && q.info.ok && (q.status === 'pending' || q.status === 'error'));
  const reading = convQueue.some((q) => !q.info);
  const needDir = S.outMode === 'folder' && !S.outDir;
  btn.disabled = !todo.length || needDir;
  btn.textContent = todo.length ? `Convert ${todo.length === 1 ? '1 file' : `${todo.length} files`}` : 'Convert All';
  const st = $('conv-status');
  st.classList.toggle('ready', !!todo.length && !needDir);
  if (!convQueue.length) st.textContent = 'Add some audio to get started';
  else if (reading) st.textContent = 'Reading files…';
  else if (needDir) st.textContent = 'Choose an output folder (Output & naming)';
  else if (!todo.length) st.textContent = 'Everything in the queue is finished';
  else st.textContent = `Ready: ${todo.length} → ${summarizeSound(S)}`;
}

// Progress
let runStart = 0, runTotalSec = 0, runDoneSec = 0;
const workingSec = new Map();
api.onConvertProgress(({ id, sec }) => {
  const it = convQueue.find((q) => q.id === id);
  if (!it || it.status !== 'working') return;
  const dur = (it.info && it.info.duration) || 1;
  it.progress = Math.min(1, sec / dur);
  workingSec.set(id, Math.min(sec, dur));
  const li = document.querySelector(`#conv-list li[data-id="${id}"]`);
  if (li) {
    const st = li.querySelector('.status'); if (st) st.textContent = `${Math.round(it.progress * 100)}%`;
    const bar = li.querySelector('.row-progress'); if (bar) bar.style.width = `${it.progress * 100}%`;
  }
  updateProgress();
});
function updateProgress() {
  let cur = runDoneSec; workingSec.forEach((v) => { cur += v; });
  const frac = runTotalSec ? Math.min(1, cur / runTotalSec) : 0;
  $('conv-progress-fill').style.width = `${frac * 100}%`;
  const el = (Date.now() - runStart) / 1000;
  $('conv-elapsed').textContent = fmtDur(el);
  $('conv-left').textContent = frac > 0.02 ? fmtDur(el / frac - el) : '—';
}
let elapsedTimer = null;

async function startConvert() {
  if (converting) return;
  const jobs = convQueue.filter((q) => q.info && q.info.ok && (q.status === 'pending' || q.status === 'error'));
  if (!jobs.length) return;
  const f = FORMATS[S.format];
  const replacing = jobs.filter((q) => outputPathFor(q).toLowerCase() === q.path.toLowerCase());
  if (replacing.length && S.conflict === 'overwrite') {
    if (!await confirmBox('Replace the originals?', `<strong>${replacing.length}</strong> file${replacing.length > 1 ? 's' : ''} will be converted <em>in place</em>: the new ${esc(f.label)} file replaces the original of the same name.<br><br>The new file is written first, so a failed conversion leaves the original untouched.`, 'Replace originals', true)) return;
  }
  if (S.deleteSource) {
    if (!await confirmBox('Delete originals?', `After each file converts successfully, its original goes to the <strong>Recycle Bin</strong>.<br><br>${jobs.length} file${jobs.length > 1 ? 's' : ''} queued. Files that fail are left alone.`, 'Convert and delete', true)) return;
  }
  const settingsForRun = { ...S, nameTemplate: effectiveTemplate(), addToItunes: S.addToItunes && f.itunes && !!itunesFolder };
  converting = true;
  await api.convertBegin();
  jobs.forEach((q) => { q.status = 'pending'; q.progress = 0; q.error = null; renderConvRow(q); });
  runStart = Date.now(); runDoneSec = 0; workingSec.clear();
  runTotalSec = jobs.reduce((a, q) => a + (q.info.duration || 1), 0);
  $('conv-progress').classList.remove('hidden');
  const btn = $('conv-go');
  btn.textContent = '■ Stop'; btn.classList.add('stop'); btn.disabled = false;
  elapsedTimer = setInterval(updateProgress, 1000);
  let done = 0, failed = 0, skipped = 0, canceled = false;
  const outputs = [];
  const total = jobs.length;
  const count = () => { $('conv-count').textContent = `${done + failed + skipped} of ${total}`; $('conv-status').textContent = `Converting to ${summarizeSound(S)}…`; };
  count();

  await pool(jobs, S.parallel, async (q) => {
    if (canceled) return;
    q.status = 'working'; q.progress = 0; renderConvRow(q);
    try {
      const r = await api.convertOne({ id: q.id, input: q.path, root: q.root, settings: settingsForRun });
      q.status = r.status; q.output = r.output; q.warnings = r.warnings || []; q.reason = r.reason;
      if (r.status === 'done') { done++; outputs.push(r.output); } else skipped++;
    } catch (e) {
      const msg = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (/Canceled/.test(msg)) { canceled = true; q.status = 'pending'; }
      else { q.status = 'error'; q.error = msg; failed++; }
    }
    workingSec.delete(q.id);
    runDoneSec += q.info.duration || 1;
    renderConvRow(q); count(); updateProgress();
  });

  clearInterval(elapsedTimer);
  converting = false;
  btn.classList.remove('stop');
  $('conv-progress').classList.add('hidden');
  updateGo();
  const secs = Math.round((Date.now() - runStart) / 1000);
  const summary = canceled ? `Stopped. ${done} converted` : `${done} converted${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''} in ${fmtDur(secs)}`;
  api.log(failed ? 'error' : 'info', `Batch finished: ${summary}`, `${summarizeSound(S)}`);
  toast(summary, failed ? 'error' : 'success', 5000);
  $('conv-status').textContent = summary;
  if (outputs.length && S.openFolder && !canceled) api.showInFolder(outputs[0]);
  if (outputs.length && S.autoTags && f.tags) { await addToTags(outputs, true); toast(`${summary}. Checking tags…`, 'success'); }
}
$('conv-go').onclick = () => {
  if (converting) { api.convertCancel(); $('conv-go').disabled = true; $('conv-go').textContent = 'Stopping…'; }
  else startConvert();
};

// ═══ Drag and drop anywhere ═════════════════════════════════════════════════
let dragDepth = 0;
const dropZoneFor = () => (activeTab === 'tags' ? $('tags-drop') : $('conv-drop'));
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropZoneFor().classList.add('drag-over'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.querySelectorAll('.drop-zone').forEach((z) => z.classList.remove('drag-over')); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0;
  document.querySelectorAll('.drop-zone').forEach((z) => z.classList.remove('drag-over'));
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  if (activeTab === 'tags') addToTags(paths);
  else { if (activeTab !== 'convert') showTab('convert'); addToConvert(paths); }
});
api.onOpenFiles((files) => { showTab('convert'); addToConvert(files); });

// ═══ Tag Fixer ══════════════════════════════════════════════════════════════
const TAG_FIELDS = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['album_artist', 'Album artist'], ['genre', 'Genre'],
  ['date', 'Year'], ['track', 'Track #'], ['disc', 'Disc #'], ['composer', 'Composer']];
let tagFiles = [];
let selectedTag = null;
let scanning = false;

function needsOf(tf) {
  const i = tf.info;
  if (!i || !i.ok) return [];
  const n = [];
  if (!i.tags.title) n.push('title');
  if (!i.tags.artist) n.push('artist');
  if (!i.tags.album) n.push('album');
  if (!i.cover) n.push('art');
  return n;
}

async function addToTags(paths, autoScan) {
  const found = await api.expandPaths(paths);
  const have = new Set(tagFiles.map((t) => t.path.toLowerCase()));
  const fresh = found.filter((f) => !have.has(f.path.toLowerCase()) && have.add(f.path.toLowerCase()));
  const items = fresh.map((f) => ({ id: nextId(), path: f.path, info: null, state: 'idle', result: null, edits: {}, coverChoice: { mode: 'keep' } }));
  tagFiles.push(...items);
  renderTagList();
  await pool(items, 4, async (tf) => {
    tf.info = await api.probe(tf.path, true);
    if (!tf.info.ok) { tf.state = 'error'; tf.error = tf.info.error; }
    else resetEdits(tf);
    renderTagRow(tf);
  });
  updateTagButtons();
  if (items.length && !selectedTag) selectTag(items[0]);
  if (autoScan) scanTags(items);
  return items;
}

function resetEdits(tf) {
  tf.edits = {};
  for (const [k] of TAG_FIELDS) tf.edits[k] = (tf.info && tf.info.tags[k]) || '';
  tf.coverChoice = { mode: 'keep' };
}

function confClass(c) { return c >= 90 ? 'high' : c >= 70 ? 'mid' : 'low'; }
function tagStateBadge(tf) {
  switch (tf.state) {
    case 'searching': return '<span class="status working">searching…</span>';
    case 'suggested': return `<span class="status ${tf.result.confidence >= 90 ? 'done' : tf.result.confidence >= 70 ? 'skipped' : 'error'}" style="cursor:pointer">${tf.result.confidence}% match</span>`;
    case 'nomatch': return '<span class="status error">no match</span>';
    case 'saved': return '<span class="status done">✓ saved</span>';
    case 'saving': return '<span class="status working">saving…</span>';
    case 'error': return `<span class="status error" data-tip="${esc(tf.error || '')}">error</span>`;
    default: {
      if (!tf.info) return '<span class="status pending">reading…</span>';
      const n = needsOf(tf);
      return n.length ? `<span class="status skipped" data-tip="Missing: ${n.join(', ')}">needs ${n.length === 1 ? n[0] : `${n.length} things`}</span>` : '<span class="status pending">looks complete</span>';
    }
  }
}
function tagRowHtml(tf) {
  const i = tf.info;
  const thumb = i && i.thumb ? `<img src="${i.thumb}">` : '🎵';
  const t = (i && i.tags) || {};
  const line1 = t.title || baseName(tf.path);
  const line2 = [t.artist || 'No artist', t.album].filter(Boolean).join(' · ');
  return `<div class="thumb">${thumb}</div><div class="file-info"><div class="file-name">${esc(line1)}</div>
    <div class="file-meta" title="${esc(tf.path)}">${esc(line2)}</div></div>${tagStateBadge(tf)}`;
}
function visibleTagFiles() {
  return $('tags-only-missing').checked ? tagFiles.filter((t) => t.state !== 'saved' && (needsOf(t).length || t.state === 'suggested' || t.state === 'nomatch')) : tagFiles;
}
function renderTagList() {
  const ul = $('tags-list');
  const list = visibleTagFiles();
  $('tags-title').textContent = `Files — ${tagFiles.length}${list.length !== tagFiles.length ? ` (showing ${list.length})` : ''}`;
  const pending = tagFiles.filter((t) => t.state === 'suggested').length;
  $('tags-badge').textContent = pending ? String(pending) : '';
  if (!list.length) {
    ul.innerHTML = `<li class="empty-state"><div class="empty-icon">🏷️</div><div class="empty-title">${tagFiles.length ? 'Nothing needs work' : 'No files yet'}</div>
      <div class="empty-sub">${tagFiles.length ? 'Untick “Only files that need work” to see everything' : 'Drop songs here or use Add Files'}</div></li>`;
    return;
  }
  ul.innerHTML = '';
  for (const tf of list) {
    const li = document.createElement('li');
    li.className = `file-item tag-item${tf === selectedTag ? ' selected' : ''}`;
    li.dataset.id = tf.id;
    li.innerHTML = tagRowHtml(tf);
    ul.appendChild(li);
  }
  updateTagButtons();
}
function renderTagRow(tf) {
  const li = document.querySelector(`#tags-list li[data-id="${tf.id}"]`);
  if (li) li.innerHTML = tagRowHtml(tf);
  const pending = tagFiles.filter((t) => t.state === 'suggested').length;
  $('tags-badge').textContent = pending ? String(pending) : '';
  if (tf === selectedTag) renderTagDetail();
  updateTagButtons();
}
$('tags-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) selectTag(tagFiles.find((t) => t.id === li.dataset.id));
});
$('tags-only-missing').onchange = renderTagList;
function selectTag(tf) {
  selectedTag = tf || null;
  document.querySelectorAll('#tags-list li[data-id]').forEach((li) => li.classList.toggle('selected', tf && li.dataset.id === tf.id));
  const li = tf && document.querySelector(`#tags-list li[data-id="${tf.id}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
  renderTagDetail();
}
function updateTagButtons() {
  $('tags-accept-all').disabled = scanning || !tagFiles.some((t) => t.state === 'suggested' && t.result.confidence >= 90);
  $('tags-scan').disabled = scanning || !tagFiles.some((t) => t.info && t.info.ok && t.state !== 'saved');
  $('tags-scan').textContent = scanning ? '🔎 Searching…' : '🔎 Find tags for all';
}

function applyCandidate(tf, c) {
  if (!c) return;
  for (const [k] of TAG_FIELDS) {
    const v = c[k];
    if (v) tf.edits[k] = String(v);
  }
  // Cover: fill in when the file has none; when it has one, keep it unless the user picks.
  if (!tf.info.cover && c.coverUrl) tf.coverChoice = { mode: 'url', url: c.coverUrl, thumb: c.coverThumb || c.coverUrl, label: `${c.album || 'Album'} · ${c.source}` };
  else if (!tf.info.cover && tf.result && tf.result.covers.length) { const cv = tf.result.covers[0]; tf.coverChoice = { mode: 'url', url: cv.url, thumb: cv.thumb, label: cv.label }; }
}

async function identifyOne(tf, override) {
  tf.state = 'searching'; renderTagRow(tf);
  try {
    const r = await api.identify(tf.path, override);
    tf.result = r;
    tf.chosen = 0;
    if (r.candidates && r.candidates.length && r.confidence >= 50) {
      tf.state = 'suggested';
      resetEdits(tf);
      applyCandidate(tf, r.candidates[0]);
    } else {
      // a weak guess is worse than none: show the options but fill nothing in
      tf.state = 'nomatch';
      tf.error = r.candidates && r.candidates.length ? `Nothing matched well (best guess ${r.confidence}%). Pick one of the possible matches below if it's right, or search again.` : r.error;
    }
  } catch (e) { tf.state = 'error'; tf.error = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  renderTagRow(tf);
}

async function scanTags(items) {
  if (scanning) return;
  const list = (items || tagFiles).filter((t) => t.info && t.info.ok && t.state !== 'saved');
  if (!list.length) return;
  scanning = true; updateTagButtons();
  let n = 0;
  await pool(list, 3, async (tf) => {
    await identifyOne(tf);
    n++;
    $('tags-title').textContent = `Files — ${tagFiles.length} · searched ${n}/${list.length}`;
  });
  scanning = false;
  renderTagList();
  const sure = list.filter((t) => t.state === 'suggested' && t.result.confidence >= 90).length;
  const unsure = list.filter((t) => t.state === 'suggested' && t.result.confidence < 90).length;
  const none = list.filter((t) => t.state === 'nomatch' || t.state === 'error').length;
  api.log('info', `Tag search: ${list.length} files`, `${sure} confident matches, ${unsure} to check, ${none} not found`);
  toast(`${sure} sure match${sure === 1 ? '' : 'es'}, ${unsure} to check, ${none} not found`, '', 5000);
  if (!selectedTag && list[0]) selectTag(list[0]); else renderTagDetail();
}
$('tags-scan').onclick = () => scanTags();

async function saveTag(tf, quiet) {
  if (!tf || !tf.info || !tf.info.ok) return false;
  tf.state = 'saving'; renderTagRow(tf);
  const tags = {};
  for (const [k] of TAG_FIELDS) tags[k] = (tf.edits[k] || '').trim();
  const cover = tf.coverChoice.mode === 'url' ? { mode: 'url', url: tf.coverChoice.url }
    : tf.coverChoice.mode === 'file' ? { mode: 'file', path: tf.coverChoice.path }
      : tf.coverChoice.mode === 'remove' ? { mode: 'remove' } : { mode: 'keep' };
  const rename = { mode: settings.tagRename || 'keep', root: settings.organizeRoot || '' };
  try {
    const r = await api.writeTags({ filePath: tf.path, tags, cover, rename });
    tf.path = r.path;
    tf.info = await api.probe(tf.path, true);
    resetEdits(tf);
    tf.state = 'saved';
    renderTagRow(tf);
    if (!quiet) toast(`Saved: ${baseName(tf.path)}`, 'success');
    return true;
  } catch (e) {
    tf.state = 'error'; tf.error = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    renderTagRow(tf);
    if (!quiet) toast(tf.error, 'error', 6000);
    return false;
  }
}
function nextNeedingWork(after) {
  const list = visibleTagFiles();
  const start = Math.max(0, list.indexOf(after));
  for (let k = 1; k <= list.length; k++) {
    const t = list[(start + k) % list.length];
    if (t !== after && t.state !== 'saved' && t.info && t.info.ok) return t;
  }
  return null;
}
$('tags-accept-all').onclick = async () => {
  const list = tagFiles.filter((t) => t.state === 'suggested' && t.result.confidence >= 90);
  if (!list.length) return;
  if (!await confirmBox('Accept confident matches', `Save the suggested tags${settings.tagRename && settings.tagRename !== 'keep' ? ' (and rename)' : ''} for <strong>${list.length}</strong> file${list.length > 1 ? 's' : ''} that matched 90% or better?<br><br>Every change is listed in History.`, 'Save all')) return;
  let ok = 0;
  for (const tf of list) if (await saveTag(tf, true)) ok++;
  renderTagList();
  toast(`Saved ${ok} of ${list.length}`, ok === list.length ? 'success' : 'error');
};
$('tags-add-files').onclick = async () => { const p = await api.pickFiles(); if (p.length) addToTags(p); };
$('tags-add-folder').onclick = async () => { const p = await api.pickFolders(); if (p.length) addToTags(p); };
$('tags-drop').onclick = () => $('tags-add-files').click();
$('tags-clear').onclick = () => { if (scanning) return; tagFiles = []; selectedTag = null; renderTagList(); renderTagDetail(); };

// ── Detail editor ──
const coverCache = new Map();
async function currentCoverUrl(tf) {
  if (!tf.info.cover) return null;
  if (!coverCache.has(tf.path)) coverCache.set(tf.path, await api.coverFull(tf.path));
  return coverCache.get(tf.path);
}

async function renderTagDetail() {
  const box = $('tag-detail');
  const tf = selectedTag;
  if (!tf) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷️</div><div class="empty-title">Pick a file to check its tags</div>
      <div class="empty-sub">“Find tags for all” looks every file up on iTunes and Deezer,<br>then asks you to confirm before anything is saved.</div></div>`;
    return;
  }
  if (!tf.info) { box.innerHTML = '<div class="empty-state"><div class="empty-sub">Reading file…</div></div>'; return; }
  if (!tf.info.ok) { box.innerHTML = `<div class="empty-state"><div class="empty-title">Can't read this file</div><div class="empty-sub">${esc(tf.info.error)}</div></div>`; return; }
  const r = tf.result;
  const c = r && r.candidates && r.candidates[tf.chosen || 0];

  // verdict banner
  let verdict;
  if (tf.state === 'searching') verdict = '<div class="verdict none"><div class="v-text">Searching iTunes and Deezer…</div></div>';
  else if (tf.state === 'saved') verdict = `<div class="verdict saved"><div class="v-text">✓ <strong>Saved.</strong> The tags below are what's in the file now.<div class="v-sub">${esc(tf.path)}</div></div></div>`;
  else if (c && tf.state === 'suggested') {
    const how = { tags: 'its current tags', filename: 'the file name', fingerprint: 'the sound itself (AcoustID)', search: 'your search' }[r.query.from] || 'the file name';
    verdict = `<div class="verdict"><div class="conf ${confClass(Math.round(c.score * 100))}">${Math.round(c.score * 100)}%<small>sure</small></div>
      <div class="v-text">I think this is <strong>${esc(c.artist)} — ${esc(c.title)}</strong>${c.album ? ` from <strong>${esc(c.album)}</strong>` : ''}${c.date ? ` (${esc(c.date)})` : ''}. Is that right?
      <div class="v-sub">Matched on ${how}: “${esc([r.query.artist, r.query.title].filter(Boolean).join(' – '))}” · source ${esc(c.source)}</div></div>
      <button class="btn ok" id="d-accept">✓ Yes, save</button></div>`;
  } else if (tf.state === 'nomatch' || tf.state === 'error') {
    verdict = `<div class="verdict none"><div class="v-text"><strong>No match found.</strong> ${esc(tf.error || '')}<div class="v-sub">Try a search below, or fill in the fields yourself.</div></div></div>`;
  } else {
    const n = needsOf(tf);
    verdict = `<div class="verdict none"><div class="v-text">${n.length ? `Missing <strong>${n.join(', ')}</strong>.` : 'Tags look complete.'} Press <strong>Look up</strong> to find the correct details online, or edit the fields yourself.</div>
      <button class="btn secondary" id="d-lookup">🔎 Look up</button></div>`;
  }

  // fields
  const rows = TAG_FIELDS.map(([k, label]) => {
    const cur = tf.info.tags[k] || '';
    const val = tf.edits[k] || '';
    const changed = cur !== val;
    return `<tr class="${changed ? 'changed' : ''}" data-k="${k}"><td class="fname">${label}</td>
      <td class="cur${cur ? '' : ' empty'}" title="${esc(cur)}">${cur ? esc(cur) : 'empty'}</td>
      <td><input class="input" data-field="${k}" value="${esc(val)}" placeholder="${changed && cur ? 'will be removed' : ''}"></td></tr>`;
  }).join('');

  // cover options
  const curUrl = tf.info.thumb;
  const opts = [];
  if (tf.info.cover) opts.push({ key: 'keep', html: `<img src="${curUrl}"><span class="kind">current</span>`, tip: 'Keep the album art already in the file' });
  (r && r.covers || []).forEach((cv, idx) => opts.push({ key: `url:${idx}`, html: `<img src="${esc(cv.thumb)}" loading="lazy"><span class="kind">${cv.kind === 'artist' ? 'artist' : 'album'}</span>`, tip: cv.label }));
  if (tf.coverChoice.mode === 'file') opts.push({ key: 'file', html: `<img src="${tf.coverChoice.dataUrl}"><span class="kind">file</span>`, tip: tf.coverChoice.path });
  opts.push({ key: 'pick', html: '📂<br>From file…', tip: 'Use a picture from your PC' });
  if (tf.info.cover) opts.push({ key: 'remove', html: '🚫<br>No art', tip: 'Remove the album art from the file' });
  const selKey = tf.coverChoice.mode === 'url' ? `url:${(r && r.covers || []).findIndex((cv) => cv.url === tf.coverChoice.url)}` : tf.coverChoice.mode;

  // candidates
  const cands = (r && r.candidates || []).map((cd, idx) => `<div class="cand${idx === (tf.chosen || 0) && tf.state === 'suggested' ? ' active' : ''}" data-cand="${idx}">
      ${cd.coverThumb ? `<img src="${esc(cd.coverThumb)}" loading="lazy">` : '<div class="noimg"></div>'}
      <div class="c-main"><div class="c-title">${esc(cd.artist)} — ${esc(cd.title)}${cd.explicit ? ' 🅴' : ''}</div>
      <div class="c-sub">${esc([cd.album, cd.date, cd.track && `track ${cd.track}`, cd.genre, cd.duration && fmtDur(cd.duration)].filter(Boolean).join(' · '))}</div></div>
      <span class="badge muted">${esc(cd.source)}</span><span class="c-score">${Math.round(cd.score * 100)}%</span></div>`).join('');

  const q = (r && r.query) || {};
  box.innerHTML = `
    ${verdict}
    <div class="detail-grid">
      <div>
        <div class="cover-big" id="d-cover">🎵</div>
        <div class="cover-options">${opts.map((o) => `<div class="cover-opt${o.key === selKey ? ' selected' : ''}" data-cover="${o.key}" data-tip="${esc(o.tip)}">${o.html}</div>`).join('')}</div>
      </div>
      <div class="card" style="padding:10px 8px">
        <table class="field-table"><tr><th></th><th>In the file now</th><th>Will be saved as</th></tr>${rows}</table>
        <div style="display:flex;gap:6px;margin:8px 6px 0;flex-wrap:wrap">
          <button class="mini-btn" id="d-reset" data-tip="Put every field back to what's in the file now">Undo my changes</button>
          ${c ? '<button class="mini-btn" id="d-usesugg" data-tip="Fill every field from the selected match">Use match</button>' : ''}
          <button class="mini-btn" id="d-swap" data-tip="Swap artist and title, for files named 'Title - Artist'">⇄ Swap artist/title</button>
          <button class="mini-btn" id="d-title-case" data-tip="Capitalise Like This">Aa Title Case</button>
        </div>
      </div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:8px">
      <div class="section-title">Search again</div>
      <div class="search-row">
        <input class="input" id="d-q-artist" placeholder="Artist" value="${esc(q.artist || tf.edits.artist || '')}">
        <input class="input" id="d-q-title" placeholder="Song title" value="${esc(q.title || tf.edits.title || '')}">
        <button class="btn secondary small" id="d-search">Search</button>
      </div>
      ${cands ? `<div class="section-title" style="margin-top:4px">Other matches · click to use</div><div class="cand-list">${cands}</div>` : ''}
    </div>
    <div class="detail-actions">
      <span class="note" style="font-family:var(--mono)">${esc(baseName(tf.path))}</span>
      <button class="mini-btn" id="d-show">Show in folder</button>
      <span class="spacer"></span>
      <button class="btn ghost" id="d-skip">Skip</button>
      <button class="btn" id="d-save">Save tags</button>
    </div>`;

  // big cover preview
  const showBig = async () => {
    const el = $('d-cover');
    if (!el || selectedTag !== tf) return;
    let src = null, cap = '';
    if (tf.coverChoice.mode === 'url') { src = tf.coverChoice.url; cap = tf.coverChoice.label || ''; }
    else if (tf.coverChoice.mode === 'file') { src = tf.coverChoice.dataUrl; cap = baseName(tf.coverChoice.path); }
    else if (tf.coverChoice.mode === 'keep' && tf.info.cover) { src = await currentCoverUrl(tf); cap = 'current art'; }
    if (selectedTag !== tf || !$('d-cover')) return;
    el.innerHTML = src ? `<img src="${esc(src)}"><div class="cover-caption">${esc(cap)}</div>` : `🎵<div class="cover-caption">${tf.coverChoice.mode === 'remove' ? 'art will be removed' : 'no album art'}</div>`;
  };
  showBig();

  box.querySelectorAll('input[data-field]').forEach((inp) => inp.addEventListener('input', () => {
    tf.edits[inp.dataset.field] = inp.value;
    inp.closest('tr').classList.toggle('changed', (tf.info.tags[inp.dataset.field] || '') !== inp.value);
  }));
  box.querySelectorAll('.cover-opt').forEach((o) => o.onclick = async () => {
    const k = o.dataset.cover;
    if (k === 'pick') {
      const img = await api.pickImage();
      if (!img) return;
      tf.coverChoice = { mode: 'file', path: img.path, dataUrl: img.dataUrl };
    } else if (k.startsWith('url:')) {
      const cv = r.covers[+k.slice(4)];
      tf.coverChoice = { mode: 'url', url: cv.url, thumb: cv.thumb, label: cv.label };
    } else tf.coverChoice = { mode: k };
    renderTagDetail();
  });
  box.querySelectorAll('.cand').forEach((el) => el.onclick = async () => {
    const idx = +el.dataset.cand;
    tf.chosen = idx;
    const cd = await api.completeCandidate(r.candidates[idx]);
    r.candidates[idx] = cd;
    resetEdits(tf); applyCandidate(tf, cd);
    if (cd.coverUrl) tf.coverChoice = { mode: 'url', url: cd.coverUrl, thumb: cd.coverThumb, label: `${cd.album || 'Album'} · ${cd.source}` };
    if (!r.covers.some((cv) => cv.url === cd.coverUrl) && cd.coverUrl) r.covers.unshift({ url: cd.coverUrl, thumb: cd.coverThumb, label: `${cd.album} · ${cd.source}`, kind: 'album' });
    if (tf.state !== 'saved') tf.state = 'suggested';
    renderTagDetail();
  });
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('d-accept', () => acceptCurrent());
  on('d-save', () => acceptCurrent());
  on('d-lookup', () => identifyOne(tf));
  on('d-skip', () => { const n = nextNeedingWork(tf); if (n) selectTag(n); });
  on('d-show', () => api.showInFolder(tf.path));
  on('d-reset', () => { resetEdits(tf); renderTagDetail(); });
  on('d-usesugg', () => { applyCandidate(tf, c); renderTagDetail(); });
  on('d-swap', () => { const a = tf.edits.artist; tf.edits.artist = tf.edits.title; tf.edits.title = a; renderTagDetail(); });
  on('d-title-case', () => {
    const tc = (s) => s.replace(/\w\S*/g, (w) => (w === w.toUpperCase() && w.length > 1 && w.length < 5 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()));
    ['title', 'artist', 'album', 'album_artist'].forEach((k) => { if (tf.edits[k]) tf.edits[k] = tc(tf.edits[k]); });
    renderTagDetail();
  });
  const doSearch = () => {
    const title = $('d-q-title').value.trim();
    if (!title) return $('d-q-title').focus();
    identifyOne(tf, { artist: $('d-q-artist').value.trim(), title });
  };
  on('d-search', doSearch);
  ['d-q-artist', 'd-q-title'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); }));
}

async function acceptCurrent() {
  const tf = selectedTag;
  if (!tf || tf.state === 'saving') return;
  if (await saveTag(tf)) {
    const n = nextNeedingWork(tf);
    if (n) selectTag(n);
    if ($('tags-only-missing').checked) renderTagList();
  }
}

// ═══ History ════════════════════════════════════════════════════════════════
let historyLog = [];
let histFilter = 'all';
let unseenErrors = 0;
const HIST_TYPES = [['all', 'All'], ['convert', '🔄 Converted'], ['tags', '🏷️ Tags'], ['error', '⚠ Errors'], ['info', 'ℹ Info & updates']];
const HIST_ICON = { convert: '🔄', tags: '🏷️', error: '⚠️', info: 'ℹ️', update: '🎉' };
function renderHistory() {
  const counts = { all: historyLog.length, convert: 0, tags: 0, error: 0, info: 0 };
  historyLog.forEach((h) => { const k = h.type === 'update' ? 'info' : h.type; if (counts[k] != null) counts[k]++; });
  $('hist-chips').innerHTML = HIST_TYPES.map(([k, l]) => `<button class="chip${histFilter === k ? ' active' : ''}" data-f="${k}">${l}<span class="n">${counts[k] || 0}</span></button>`).join('');
  $('hist-chips').querySelectorAll('.chip').forEach((c) => c.onclick = () => { histFilter = c.dataset.f; renderHistory(); });

  const today = new Date().toDateString();
  const convToday = historyLog.filter((h) => h.type === 'convert' && new Date(h.t).toDateString() === today).length;
  const last = historyLog[historyLog.length - 1];
  $('hist-stats').innerHTML = `<span>Converted today <strong>${convToday}</strong></span><span>Converted all time <strong>${counts.convert}</strong></span>` +
    `<span>Tag saves <strong>${counts.tags}</strong></span><span>Errors <strong style="${counts.error ? 'color:var(--danger)' : ''}">${counts.error}</strong></span>` +
    `<span>Version <strong>${esc(appInfo.version || '')}</strong></span>${last ? `<span>Last activity <strong>${new Date(last.t).toLocaleString()}</strong></span>` : ''}`;

  const q = $('hist-search').value.trim().toLowerCase();
  const list = historyLog.filter((h) => (histFilter === 'all' || h.type === histFilter || (histFilter === 'info' && h.type === 'update'))
    && (!q || `${h.msg} ${h.detail}`.toLowerCase().includes(q))).slice(-600).reverse();
  const ul = $('hist-list');
  if (!list.length) {
    ul.innerHTML = `<li class="empty-state"><div class="empty-icon">🕘</div><div class="empty-title">${historyLog.length ? 'Nothing matches' : 'No activity yet'}</div>
      <div class="empty-sub">Every conversion, tag change, error and update is recorded here.</div></li>`;
    return;
  }
  let html = '', lastDay = '';
  for (const h of list) {
    const d = new Date(h.t);
    const day = d.toDateString();
    if (day !== lastDay) { html += `<li class="hist-day">${day === today ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</li>`; lastDay = day; }
    html += `<li class="hist-row ${h.type}${h.detail ? ' has-detail' : ''}"><span class="h-icon">${HIST_ICON[h.type] || '•'}</span>
      <div class="h-main"><div class="h-msg">${esc(h.msg)}</div>${h.detail ? `<div class="h-detail">${esc(h.detail)}</div>` : ''}</div>
      <span class="h-time">${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></li>`;
  }
  ul.innerHTML = html;
}
$('hist-list').addEventListener('click', (e) => {
  const row = e.target.closest('.hist-row.has-detail');
  if (row && !window.getSelection().toString()) row.classList.toggle('open');
});
$('hist-search').addEventListener('input', debounce(renderHistory, 200));
$('hist-export').onclick = async () => { const p = await api.exportHistory(); if (p) toast('Log exported', 'success'); };
$('hist-folder').onclick = () => api.openPath(appInfo.dataDir);
$('hist-clear').onclick = async () => {
  if (await confirmBox('Clear history', 'Remove every entry from the activity log? Your files are not affected.', 'Clear', true)) {
    await api.clearHistory(); historyLog = []; renderHistory();
  }
};
api.onLog((entry) => {
  historyLog.push(entry);
  if (entry.type === 'error' && activeTab !== 'history') { unseenErrors++; $('hist-badge').textContent = String(unseenErrors); }
  if (activeTab === 'history') renderHistoryDebounced();
});
const renderHistoryDebounced = debounce(renderHistory, 250);

// ═══ Changelog & updates ════════════════════════════════════════════════════
function renderMarkdown(md) {
  const lines = md.split(/\r?\n/);
  let html = '', inList = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (/^\s*[-*] /.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^# /.test(line)) continue;
    if (/^## /.test(line)) html += `<h4>${inline(line.slice(3))}</h4>`;
    else if (/^### /.test(line)) html += `<h5>${inline(line.slice(4))}</h5>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
let updateInfo = null;
function showChangelog(title) {
  $('cl-title').textContent = title || `Version history · v${appInfo.version}`;
  $('cl-body').innerHTML = renderMarkdown(appInfo.changelog || 'No changelog found.');
  $('cl-update').textContent = updateStatusText();
  openModal('modal-changelog');
}
function updateStatusText() {
  if (!updateInfo) return settings.lastUpdateCheck ? `Last checked ${new Date(settings.lastUpdateCheck).toLocaleString()}` : 'Not checked for updates yet';
  if (updateInfo.status === 'available') return `Version ${updateInfo.latest} is available`;
  if (updateInfo.status === 'current') return `You have the latest version (checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  if (updateInfo.status === 'none') return updateInfo.message;
  return `Update check failed: ${updateInfo.message}`;
}
async function checkUpdate(manual) {
  if (manual) { $('set-update-status').textContent = 'Checking…'; $('cl-update').textContent = 'Checking…'; }
  updateInfo = await api.checkUpdate();
  settings.lastUpdateCheck = Date.now();
  $('set-update-status').textContent = updateStatusText();
  $('cl-update').textContent = updateStatusText();
  if (updateInfo.status === 'available') {
    $('ub-version').textContent = `TuneForge ${updateInfo.latest}`;
    $('ub-current').textContent = `v${updateInfo.current}`;
    $('update-banner').classList.remove('hidden');
    $('app-version').classList.add('has-update');
    $('app-version').setAttribute('data-tip', `Version ${updateInfo.latest} is available. Click for details`);
  } else if (manual) toast(updateStatusText(), updateInfo.status === 'error' ? 'error' : '');
}
$('app-version').onclick = () => showChangelog();
$('cl-check').onclick = () => checkUpdate(true);
$('ub-close').onclick = () => $('update-banner').classList.add('hidden');
$('ub-download').onclick = () => updateInfo && api.openExternal(updateInfo.url);
$('ub-notes').onclick = () => {
  if (!updateInfo) return;
  $('cl-title').textContent = `What's new in ${updateInfo.latest}`;
  $('cl-body').innerHTML = renderMarkdown(updateInfo.notes || 'No release notes.');
  $('cl-update').textContent = `Published ${updateInfo.published ? new Date(updateInfo.published).toLocaleDateString() : ''}`;
  openModal('modal-changelog');
};

// ═══ Settings tab ═══════════════════════════════════════════════════════════
function renderSettingsTab() {
  $('set-theme').value = settings.theme || 'system';
  $('set-autoupdate').checked = settings.autoUpdate !== false;
  $('set-version').textContent = `v${appInfo.version}${appInfo.portable ? ' · portable' : ''}`;
  $('set-update-status').textContent = updateStatusText();
  $('set-itunes-desc').textContent = itunesFolder || 'Not found. iTunes may not be installed, or its media folder is somewhere else.';
  $('set-country').value = settings.storeCountry || 'us';
  $('set-acoustid').value = settings.acoustidKey || '';
  $('set-fp').checked = settings.useFingerprint !== false && !!settings.acoustidKey;
  $('set-rename').value = settings.tagRename || 'keep';
  $('set-organize-row').classList.toggle('hidden', settings.tagRename !== 'organize');
  $('set-organize-desc').textContent = settings.organizeRoot || 'Not set: files are sorted into Artist\\Album folders next to where they are now.';
  $('set-data').textContent = appInfo.dataDir;
}
$('set-theme').onchange = () => { persist({ theme: $('set-theme').value }); applyTheme(); };
$('set-pin').onchange = () => setPin($('set-pin').checked);
$('set-autoupdate').onchange = () => persist({ autoUpdate: $('set-autoupdate').checked });
$('set-check').onclick = () => checkUpdate(true);
$('set-changelog').onclick = () => showChangelog();
$('set-itunes-open').onclick = () => { if (itunesFolder) api.openPath(itunesFolder); };
$('set-itunes-pick').onclick = async () => {
  const p = await api.pickFolder({ title: 'Choose the "Automatically Add to iTunes" folder', defaultPath: itunesFolder || undefined });
  if (p) { persist({ itunesFolder: p }); itunesFolder = p; renderSettingsTab(); updateDerived(); }
};
$('set-country').onchange = () => persist({ storeCountry: $('set-country').value });
$('set-acoustid').addEventListener('input', debounce(() => {
  const k = $('set-acoustid').value.trim();
  persist({ acoustidKey: k });
  $('set-fp').checked = !!k && settings.useFingerprint !== false;
}, 400));
$('set-acoustid-link').onclick = () => api.openExternal('https://acoustid.org/new-application');
$('set-fp').onchange = () => {
  if ($('set-fp').checked && !settings.acoustidKey) { $('set-fp').checked = false; toast('Paste an AcoustID key first'); return; }
  persist({ useFingerprint: $('set-fp').checked });
};
$('set-rename').onchange = () => { persist({ tagRename: $('set-rename').value }); renderSettingsTab(); };
$('set-organize-pick').onclick = async () => {
  const p = await api.pickFolder({ title: 'Music folder to sort into', defaultPath: settings.organizeRoot || undefined });
  if (p) { persist({ organizeRoot: p }); renderSettingsTab(); }
};
$('set-data-open').onclick = () => api.openPath(appInfo.dataDir);
$('set-reset').onclick = async () => {
  if (!await confirmBox('Reset converter options', 'Put format, quality, output and naming options back to their defaults?', 'Reset')) return;
  S = { ...DEFAULTS }; syncControls(); onSettingsChanged(); toast('Converter options reset');
};

// ═══ Keyboard ═══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === 'Escape') {
    const open = document.querySelector('.overlay.active');
    if (open) { closeModal(open.id); return; }
    if (converting) { $('conv-go').click(); }
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); (activeTab === 'tags' ? $('tags-add-files') : $('conv-add-files')).click(); if (activeTab !== 'tags') showTab('convert'); return; }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    if (activeTab === 'convert' && !converting && !$('conv-go').disabled) startConvert();
    else if (activeTab === 'tags') acceptCurrent();
    return;
  }
  if (e.ctrlKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); showTab(['convert', 'tags', 'history', 'guide', 'settings'][+e.key - 1]); return; }
  if (activeTab === 'tags' && !typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const list = visibleTagFiles();
    const i = list.indexOf(selectedTag);
    const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) selectTag(n);
  }
});

// ═══ Start ══════════════════════════════════════════════════════════════════
(async function init() {
  [appInfo, settings] = await Promise.all([api.getAppInfo(), api.getSettings()]);
  applyTheme();
  document.title = `TuneForge ${appInfo.version}`;
  $('app-version').textContent = `v${appInfo.version}`;
  itunesFolder = await api.itunesFolder();
  S = { ...DEFAULTS, ...(settings.convert || {}) };
  if (!itunesFolder) S.addToItunes = false;
  const ws = await api.windowState();
  $('btn-pin').classList.toggle('on', ws.pinned);
  $('set-pin').checked = ws.pinned;
  syncControls();
  renderConvList();
  renderTagList();
  historyLog = await api.getHistory();
  renderHistory();
  renderSettingsTab();
  if (appInfo.justUpdated) showChangelog(`What's new in v${appInfo.version}`);
  if (settings.autoUpdate !== false && (!settings.lastUpdateCheck || Date.now() - settings.lastUpdateCheck > 20 * 3600 * 1000)) {
    setTimeout(() => checkUpdate(false), 4000);
  }
})();
