// FFmpeg/ffprobe work: reading info + tags, carrying tags and album art across a
// conversion, and rewriting tags in place. Everything goes through ffmpeg so every
// format is handled the same way.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FORMATS, qualityPlan } = require('./formats');

let ffmpegPath = 'ffmpeg';
let ffprobePath = 'ffprobe';
function setBinaries(ffmpeg, ffprobe) { ffmpegPath = ffmpeg; ffprobePath = ffprobe; }

const TMP_DIR = path.join(os.tmpdir(), 'TuneForge');
try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (_) {}
let tmpCounter = 0;
function tmpFile(ext) { return path.join(TMP_DIR, `tf_${process.pid}_${Date.now()}_${tmpCounter++}.${ext}`); }
function rmQuiet(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} }

// ── Tags ────────────────────────────────────────────────────────────────────
// Tags that describe the old encode, not the song. They are dropped when converting.
const TECHNICAL_TAGS = new Set(['encoder', 'major_brand', 'minor_version', 'compatible_brands', 'creation_time',
  'handler_name', 'vendor_id', 'itunsmpb', 'itunnorm', 'duration', 'metadata_block_picture', 'encoder_options',
  'id3v2_priv.xmp', 'itunpgap', 'tracktotal', 'totaltracks', 'disctotal', 'totaldiscs', 'language']);

const KEY_ALIASES = {
  albumartist: 'album_artist', 'album artist': 'album_artist', 'album-artist': 'album_artist', band: 'album_artist',
  tracknumber: 'track', discnumber: 'disc', year: 'date', unsyncedlyrics: 'lyrics', 'lyrics-eng': 'lyrics',
  'lyrics-xxx': 'lyrics', 'wm/albumartist': 'album_artist', 'wm/year': 'date', 'wm/tracknumber': 'track',
  'wm/genre': 'genre', 'wm/composer': 'composer', 'wm/partofset': 'disc', author: 'artist',
};

// The fields the app shows and edits. Anything else found in a file is still carried over.
const MAIN_FIELDS = ['title', 'artist', 'album', 'album_artist', 'genre', 'date', 'track', 'disc', 'composer', 'comment'];

function normalizeTags(raw) {
  const out = {};
  let trackTotal = '', discTotal = '';
  for (const [k0, v0] of Object.entries(raw || {})) {
    const v = String(v0 == null ? '' : v0).trim();
    if (!v) continue;
    let k = k0.toLowerCase().trim();
    if (k === 'tracktotal' || k === 'totaltracks') { trackTotal = v; continue; }
    if (k === 'disctotal' || k === 'totaldiscs') { discTotal = v; continue; }
    k = KEY_ALIASES[k] || k;
    if (TECHNICAL_TAGS.has(k)) continue;
    if (k === 'date' && out.date) continue;
    if (!(k in out)) out[k] = v;
  }
  if (out.track && trackTotal && !out.track.includes('/')) out.track = `${out.track}/${trackTotal}`;
  if (out.disc && discTotal && !out.disc.includes('/')) out.disc = `${out.disc}/${discTotal}`;
  return out;
}

// ffmetadata needs = ; # and newlines escaped. This FFmpeg build can't round-trip a
// lone backslash (it is either dropped or doubled), so it is written as "/".
function escMeta(s) { return String(s).replace(/\\/g, '/').replace(/([=;#\n])/g, '\\$1'); }
function keyOk(k) { return /^[\w .\-/:]+$/.test(k) && !/^\s|\s$/.test(k); }

function writeMetaFile(tags, pictureBlockB64) {
  const lines = [';FFMETADATA1'];
  for (const [k, v] of Object.entries(tags || {})) {
    if (v === '' || v == null || !keyOk(k)) continue;
    lines.push(`${escMeta(k)}=${escMeta(v)}`);
  }
  if (pictureBlockB64) lines.push(`METADATA_BLOCK_PICTURE=${pictureBlockB64}`);
  const p = tmpFile('txt');
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return p;
}

// ── Probe ───────────────────────────────────────────────────────────────────
function probe(filePath) {
  return new Promise((resolve) => {
    execFile(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        let size = 0;
        try { size = fs.statSync(filePath).size; } catch (_) {}
        if (err) return resolve({ ok: false, size, error: 'Not a readable audio file' });
        try {
          const j = JSON.parse(stdout);
          const streams = j.streams || [];
          const a = streams.find((s) => s.codec_type === 'audio');
          if (!a) return resolve({ ok: false, size, error: 'No audio track in this file' });
          const pic = streams.find((s) => s.codec_type === 'video' && s.disposition && s.disposition.attached_pic);
          const fmtTags = (j.format && j.format.tags) || {};
          const tags = normalizeTags({ ...(a.tags || {}), ...fmtTags });
          const fmtBitrate = parseInt(j.format && j.format.bit_rate) || 0;
          resolve({
            ok: true, size,
            duration: parseFloat(a.duration || (j.format && j.format.duration)) || 0,
            codec: a.codec_name, codecLong: a.codec_long_name,
            container: j.format && j.format.format_name,
            bitrate: Math.round((parseInt(a.bit_rate) || fmtBitrate) / 1000) || null,
            sampleRate: parseInt(a.sample_rate) || null,
            channels: a.channels || null,
            bits: parseInt(a.bits_per_raw_sample) || parseInt(a.bits_per_sample) || null,
            lossless: /^(flac|alac|pcm_|wavpack|ape|tta|mlp|truehd)/.test(a.codec_name || ''),
            audioIndex: a.index,
            hasVideo: streams.some((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic)),
            cover: pic ? { index: pic.index, codec: pic.codec_name, width: pic.width, height: pic.height } : null,
            tags,
          });
        } catch (_) { resolve({ ok: false, size, error: 'Could not read file info' }); }
      });
  });
}

function runCapture(args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout, windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout));
  });
}

// Small JPEG thumbnail of the embedded artwork, as a data URL.
async function coverThumb(filePath, coverIndex, size = 160) {
  const buf = await runCapture(['-v', 'error', '-i', filePath, '-map', `0:${coverIndex}`, '-frames:v', '1',
    '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-']);
  return buf && buf.length ? `data:image/jpeg;base64,${buf.toString('base64')}` : null;
}

// Full embedded artwork copied out to a temp file. Returns { path, codec } or null.
async function extractCover(filePath, cover) {
  if (!cover) return null;
  const keep = cover.codec === 'mjpeg' || cover.codec === 'png';
  const ext = cover.codec === 'png' ? 'png' : 'jpg';
  const out = tmpFile(ext);
  const args = ['-v', 'error', '-y', '-i', filePath, '-map', `0:${cover.index}`, '-frames:v', '1'];
  args.push(...(keep ? ['-c', 'copy'] : ['-c:v', 'mjpeg', '-q:v', '2']), '-f', 'image2', out);
  const ok = await new Promise((r) => execFile(ffmpegPath, args, { windowsHide: true, timeout: 30000 }, (e) => r(!e)));
  return ok && fs.existsSync(out) ? { path: out, codec: keep ? cover.codec : 'mjpeg' } : null;
}

async function imageInfo(p) {
  return new Promise((resolve) => {
    execFile(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', p],
      { windowsHide: true }, (err, stdout) => {
        try { const s = JSON.parse(stdout).streams[0]; resolve({ codec: s.codec_name, width: s.width, height: s.height }); }
        catch (_) { resolve(null); }
      });
  });
}

// Ogg/Opus keep artwork as a base64 FLAC picture block inside a comment.
async function pictureBlock(imgPath) {
  let data = fs.readFileSync(imgPath);
  let info = await imageInfo(imgPath);
  if (!info || (info.codec !== 'mjpeg' && info.codec !== 'png')) {
    const conv = tmpFile('jpg');
    await new Promise((r) => execFile(ffmpegPath, ['-v', 'error', '-y', '-i', imgPath, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2', conv], { windowsHide: true }, () => r()));
    if (!fs.existsSync(conv)) return null;
    data = fs.readFileSync(conv); rmQuiet(conv);
    info = { codec: 'mjpeg', width: info ? info.width : 0, height: info ? info.height : 0 };
  }
  const mime = Buffer.from(info.codec === 'png' ? 'image/png' : 'image/jpeg');
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const block = Buffer.concat([u32(3), u32(mime.length), mime, u32(0), u32(info.width || 0), u32(info.height || 0),
    u32(24), u32(0), u32(data.length), data]);
  return block.toString('base64');
}

// ── Format of an existing file (for tag writing) ───────────────────────────
function formatKeyFromExt(p) {
  const e = path.extname(p).slice(1).toLowerCase();
  return { mp3: 'mp3', m4a: 'aac', m4b: 'm4b', mp4: 'aac', flac: 'flac', wav: 'wav', aif: 'aiff', aiff: 'aiff',
    ogg: 'ogg', oga: 'ogg', opus: 'opus', wma: 'wma', ac3: 'ac3' }[e] || null;
}

function muxerFlags(fmtKey) {
  if (fmtKey === 'mp3') return ['-id3v2_version', '3', '-write_id3v1', '1'];
  if (fmtKey === 'aiff') return ['-write_id3v2', '1', '-id3v2_version', '3'];
  if (fmtKey === 'aac' || fmtKey === 'alac' || fmtKey === 'm4b') return ['-movflags', '+faststart'];
  return [];
}

// Map an image (input #idx, stream 0 or a given stream) as attached artwork.
function coverStreamArgs(mapSpec, codec) {
  const copy = codec === 'mjpeg' || codec === 'png';
  return ['-map', mapSpec, ...(copy ? ['-c:v', 'copy'] : ['-c:v', 'mjpeg', '-q:v', '2']), '-disposition:v:0', 'attached_pic'];
}

// ── Conversion ──────────────────────────────────────────────────────────────
// Returns { args, cleanup[] } for converting `input` to `output` with settings `s`.
async function buildConvertArgs(input, output, info, s) {
  const f = FORMATS[s.format];
  const cleanup = [];
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input];
  let nextInput = 1;

  const wantCover = s.keepCover !== false && f.cover && info.cover;
  let coverArgs = [];
  let blockB64 = null;
  if (wantCover && f.cover === 'stream') {
    coverArgs = coverStreamArgs(`0:${info.cover.index}`, info.cover.codec);
  } else if (wantCover && f.cover === 'block') {
    const c = await extractCover(input, info.cover);
    if (c) { cleanup.push(c.path); blockB64 = await pictureBlock(c.path); }
  }

  let metaIdx = -1;
  if (f.tags && (s.keepTags !== false || blockB64)) {
    const tags = s.keepTags !== false ? { ...info.tags, ...(s.extraTags || {}) } : {};
    const metaPath = writeMetaFile(tags, blockB64);
    cleanup.push(metaPath);
    args.push('-f', 'ffmetadata', '-i', metaPath);
    metaIdx = nextInput++;
  }

  args.push('-map', `0:${info.audioIndex}`, ...coverArgs);
  if (metaIdx >= 0) {
    args.push('-map_metadata', String(metaIdx));
    if (f.cover === 'block') args.push('-map_metadata:s:a:0', String(metaIdx));
  } else {
    args.push('-map_metadata', '-1');
  }

  // codec + quality
  if (f.kind === 'lossy') {
    args.push('-c:a', f.codec, ...qualityPlan(s.format, s.quality, s.mode).args);
  } else if (s.format === 'flac') {
    args.push('-c:a', 'flac', '-compression_level', String(s.flacLevel != null ? s.flacLevel : 5));
    if (+s.bitDepth === 24 || (s.bitDepth === 'keep' && info.bits > 16)) args.push('-sample_fmt', 's32', '-bits_per_raw_sample', '24');
    else if (+s.bitDepth === 16 || s.bitDepth === 'keep') args.push('-sample_fmt', 's16');
    else args.push('-sample_fmt', 's32', '-bits_per_raw_sample', '24');
  } else if (s.format === 'alac') {
    const deep = +s.bitDepth >= 24 || (s.bitDepth === 'keep' && info.bits > 16);
    args.push('-c:a', 'alac', '-sample_fmt', deep ? 's32p' : 's16p');
  } else {
    const be = f.codec === 'pcm_be';
    let bits = s.bitDepth === 'keep' ? (info.bits > 16 ? 24 : 16) : +s.bitDepth;
    const codec = bits === 32 ? (be ? 'pcm_f32be' : 'pcm_f32le') : bits === 24 ? (be ? 'pcm_s24be' : 'pcm_s24le') : (be ? 'pcm_s16be' : 'pcm_s16le');
    args.push('-c:a', codec);
  }

  const filters = [];
  if (s.normalize) filters.push(`loudnorm=I=${s.loudness || -14}:TP=-1.0:LRA=11`);
  if (s.trimSilence) filters.push('silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.3,areverse');
  if (filters.length) args.push('-af', filters.join(','));

  let rate = s.sampleRate === 'keep' ? null : +s.sampleRate;
  // loudnorm upsamples internally to 192 kHz; pin the output rate so files don't balloon.
  if (!rate && s.normalize) rate = info.sampleRate || 44100;
  if (rate && f.maxRate && rate > f.maxRate) rate = f.maxRate;
  if (s.format === 'opus') rate = 48000;
  if (rate) args.push('-ar', String(rate));
  if (s.channels !== 'keep' && s.channels) args.push('-ac', String(s.channels));
  else if (s.format === 'ac3' && info.channels > 6) args.push('-ac', '6');
  else if ((s.format === 'mp3' || s.format === 'wma') && info.channels > 2) args.push('-ac', '2');

  args.push(...muxerFlags(s.format));
  args.push(output);
  return { args, cleanup };
}

// ── Running ffmpeg ──────────────────────────────────────────────────────────
const activeProcs = new Set();
function killAll() { for (const p of activeProcs) { try { p.kill(); } catch (_) {} } }

function runFfmpeg(args, onTime) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { cwd: TMP_DIR, windowsHide: true });
    activeProcs.add(proc);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
      if (onTime) {
        const m = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
        if (m) {
          const [, h, mn, sc] = m[m.length - 1].match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          onTime(+h * 3600 + +mn * 60 + parseFloat(sc));
        }
      }
    });
    proc.on('close', (code) => {
      activeProcs.delete(proc);
      if (code === 0) resolve(true);
      else {
        const lines = stderr.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(size=|frame=|Press \[q\])/.test(l));
        const err = new Error(lines.slice(-4).join('\n') || `ffmpeg exited with code ${code}`);
        err.code = code;
        reject(err);
      }
    });
    proc.on('error', () => { activeProcs.delete(proc); reject(new Error('FFmpeg was not found.')); });
  });
}

// Replace `target` with `tmp` safely (the original stays until the new file is in place).
function replaceFile(tmp, target) {
  const backup = `${target}.tfbak`;
  rmQuiet(backup);
  if (fs.existsSync(target)) fs.renameSync(target, backup);
  try { fs.renameSync(tmp, target); } catch (e) {
    if (fs.existsSync(backup)) fs.renameSync(backup, target);
    throw e;
  }
  rmQuiet(backup);
}

// ── Rewrite tags (and artwork) of an existing file without re-encoding ─────
// tags: full set of fields to write ('' removes a field). cover: { mode: 'keep'|'remove'|'file', path }
async function writeTags(filePath, tags, cover) {
  const fmtKey = formatKeyFromExt(filePath);
  const f = FORMATS[fmtKey];
  if (!f || !f.tags) throw new Error(`${path.extname(filePath)} files can't hold tags. Convert to M4A or MP3 first.`);
  const info = await probe(filePath);
  if (!info.ok) throw new Error(info.error);

  const cleanup = [];
  const args = ['-hide_banner', '-nostdin', '-y', '-i', filePath];
  let nextInput = 1;
  let coverArgs = [];
  let blockB64 = null;
  const mode = (cover && cover.mode) || 'keep';

  if (f.cover === 'stream') {
    if (mode === 'file' && cover.path) {
      const ii = await imageInfo(cover.path);
      args.push('-i', cover.path);
      coverArgs = coverStreamArgs(`${nextInput++}:0`, ii && ii.codec);
    } else if (mode === 'keep' && info.cover) {
      coverArgs = coverStreamArgs(`0:${info.cover.index}`, info.cover.codec);
    }
  } else if (f.cover === 'block') {
    let img = null;
    if (mode === 'file' && cover.path) img = cover.path;
    else if (mode === 'keep' && info.cover) { const c = await extractCover(filePath, info.cover); if (c) { img = c.path; cleanup.push(c.path); } }
    if (img) blockB64 = await pictureBlock(img);
  }

  // Start from what the file already has so lyrics, ReplayGain etc. survive.
  const merged = { ...info.tags };
  for (const [k, v] of Object.entries(tags || {})) {
    if (v === '' || v == null) delete merged[k]; else merged[k] = String(v);
  }
  const metaPath = writeMetaFile(merged, blockB64);
  cleanup.push(metaPath);
  args.push('-f', 'ffmetadata', '-i', metaPath);
  const metaIdx = nextInput++;

  args.push('-map', `0:${info.audioIndex}`, ...coverArgs, '-c:a', 'copy', '-map_metadata', String(metaIdx));
  if (f.cover === 'block') args.push('-map_metadata:s:a:0', String(metaIdx));
  args.push(...muxerFlags(fmtKey));
  const tmp = path.join(path.dirname(filePath), `.tftmp_${Date.now()}${path.extname(filePath)}`);
  args.push(tmp);
  try {
    await runFfmpeg(args);
    replaceFile(tmp, filePath);
  } finally {
    rmQuiet(tmp);
    cleanup.forEach(rmQuiet);
  }
  return true;
}

// Chromaprint fingerprint for AcoustID lookups (first 120 seconds).
async function fingerprint(filePath) {
  const buf = await runCapture(['-v', 'error', '-i', filePath, '-t', '120', '-map', '0:a:0', '-ac', '2', '-ar', '44100',
    '-f', 'chromaprint', '-fp_format', 'base64', '-'], 60000);
  return buf ? buf.toString('utf8').trim() : null;
}

module.exports = {
  setBinaries, probe, coverThumb, extractCover, buildConvertArgs, runFfmpeg, killAll, replaceFile, writeTags,
  fingerprint, formatKeyFromExt, normalizeTags, rmQuiet, tmpFile, MAIN_FIELDS, TMP_DIR,
};
