// Works out what a song really is: cleans the filename/tags into an artist + title,
// optionally identifies the audio by fingerprint (AcoustID), then searches the iTunes
// and Deezer catalogues (no account or key needed) and scores the matches.
const UA = 'TuneForge/1.0 (https://github.com/sunnycrafts)';

// ── Rate limits: iTunes allows ~20 searches a minute, Deezer ~50 per 5 seconds ──
function limiter(minGapMs) {
  let last = 0; let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}
const itunesQueue = limiter(3100);
const deezerQueue = limiter(130);

async function getJson(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 12000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ── Cleaning names ─────────────────────────────────────────────────────────
const JUNK_WORDS = /\b(official|video|audio|lyrics?|lyric video|visuali[sz]er|music video|m\/?v|hd|hq|4k|1080p|720p|full song|full version|out now|free download|explicit|clean|audio only|360°?|premiere|with lyrics)\b/i;

function cleanText(s) {
  let t = String(s || '');
  // trailing YouTube id from downloaders, e.g. "Song-dQw4w9WgXcQ"
  t = t.replace(/[\s_-]\[?([A-Za-z0-9_-]{11})\]?$/, (m, id) => (/\d/.test(id) && /[a-z]/.test(id) && /[A-Z]/.test(id) ? '' : m));
  t = t.replace(/_/g, ' ');
  t = t.replace(/\b(?:www\.)?[\w-]+\.(?:com|net|org|info|pk|in|io|me|cc|ru|to|fm)\b/gi, ' ');
  t = t.replace(/\[[^\]]*\]|\{[^}]*\}/g, (m) => (/remix|edit|mix|version|live|acoustic|feat|ft\.|cover/i.test(m) && !JUNK_WORDS.test(m) ? m.replace(/[[\]{}]/g, (c) => (c === '[' || c === '{' ? '(' : ')')) : ' '));
  t = t.replace(/\(([^)]*)\)/g, (m, inner) => (JUNK_WORDS.test(inner) ? ' ' : m));
  t = t.replace(/\b\d{2,3}\s?kbps\b|\b(?:mp3|m4a|flac|wav|320k?)\b/gi, ' ');
  t = t.replace(/[\s_]?converted$/i, '');
  t = t.replace(/\s+/g, ' ').replace(/^[\s\-–—.]+|[\s\-–—.]+$/g, '');
  return t;
}

function splitArtistTitle(name) {
  let n = cleanText(name);
  let track = null;
  const tm = n.match(/^(?:cd\s?\d+\s*[-.]?\s*)?(\d{1,3})(?:\s*[.\-–)]\s*|\s+)(?=\D)/i);
  if (tm) { track = parseInt(tm[1], 10); n = n.slice(tm[0].length).trim(); }
  const parts = n.split(/\s+[-–—]\s+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // "Artist - Album - 03 - Title" style: last part is the title, first is the artist
    let title = parts[parts.length - 1].replace(/^\d{1,3}\s*[.\-]?\s*/, '');
    return { artist: parts[0], title, track };
  }
  const by = n.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) return { artist: by[2], title: by[1], track };
  return { artist: '', title: n, track };
}

const BAD_ARTIST = /^(unknown( artist)?|various( artists)?|va|artist|<unknown>|none|null|n\/a|track)$/i;
function looksJunky(v) {
  return !v || BAD_ARTIST.test(v.trim()) || /^track\s*\d+$/i.test(v.trim()) || /www\.|\.com\b|https?:/i.test(v) || /^\d+$/.test(v.trim());
}

// What to search for: tags when they are good, otherwise the filename.
function buildQuery(fileName, tags) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const t = tags || {};
  let artist = (t.artist || '').trim();
  let title = (t.title || '').trim();
  if (title && !artist && /\s[-–—]\s/.test(title)) { const s = splitArtistTitle(title); artist = s.artist; title = s.title; }
  if (!looksJunky(artist) && !looksJunky(title)) {
    return { artist: cleanText(artist), title: cleanText(title), from: 'tags' };
  }
  const s = splitArtistTitle(base);
  return {
    artist: !looksJunky(artist) ? cleanText(artist) : s.artist,
    title: !looksJunky(title) && title.toLowerCase() !== base.toLowerCase() ? cleanText(title) : s.title,
    track: s.track, from: 'filename',
  };
}

// ── Similarity ─────────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\((?:feat|ft|with)[^)]*\)|\b(?:feat|ft)\.?\s.*$/g, ' ')
    .replace(/\((?:\d{4}\s)?remaster(?:ed)?[^)]*\)|- (?:\d{4} )?remaster(?:ed)?.*$/g, ' ')
    .replace(/&/g, ' and ').replace(/[^a-z0-9ऀ-ॿ؀-ۿ一-鿿 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[n];
}
function sim(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ratio = 1 - lev(a, b) / Math.max(a.length, b.length);
  const ta = new Set(a.split(' ')), tb = new Set(b.split(' '));
  let common = 0; ta.forEach((w) => { if (tb.has(w)) common++; });
  const dice = (2 * common) / (ta.size + tb.size);
  const contains = (a.includes(b) || b.includes(a)) ? 0.85 : 0;
  return Math.max(ratio, dice, contains);
}

const KARAOKE = /karaoke|tribute|in the style of|made famous|originally performed|cover version|instrumental version|8-bit|lullaby/i;

function scoreCandidate(c, q, duration) {
  let s;
  if (q.artist) {
    s = sim(c.title, q.title) * 0.58 + sim(c.artist, q.artist) * 0.32;
  } else {
    // only one string to go on: it may be "title", or "artist title" with no separator
    const whole = Math.max(sim(`${c.artist} ${c.title}`, q.title), sim(`${c.title} ${c.artist}`, q.title));
    s = Math.max(sim(c.title, q.title) * 0.75, whole * 0.9);
  }
  if (duration && c.duration) {
    const d = Math.abs(duration - c.duration);
    s += d <= 3 ? 0.10 : d <= 8 ? 0.06 : d <= 20 ? 0.02 : -0.08;
  } else s += 0.04;
  if (KARAOKE.test(`${c.artist} ${c.title} ${c.album}`) && !KARAOKE.test(`${q.artist} ${q.title}`)) s *= 0.6;
  // on a tie, the original album beats a single or a hits compilation
  if (/ - (single|ep)$/i.test(c.album)) s -= 0.012;
  if (/greatest hits|best of|hits \d{4}|now that'?s|compilation|collection|top \d+/i.test(c.album) && !/hits|best/i.test(q.album || '')) s -= 0.02;
  return Math.max(0, Math.min(1, s));
}

// Filenames are often "Title - Artist"; try both ways round and keep the better fit.
function bestScore(c, q, duration) {
  const a = scoreCandidate(c, q, duration);
  if (q.from !== 'filename' || !q.artist) return a;
  const b = scoreCandidate(c, { ...q, artist: q.title, title: q.artist }, duration);
  return Math.max(a, b);
}

// ── Catalogue searches ─────────────────────────────────────────────────────
function itunesArt(url, size = 1200) { return url ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, `/${size}x${size}bb.jpg`) : null; }

async function searchItunes(term, country) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=15${country ? `&country=${country}` : ''}`;
  const j = await itunesQueue(() => getJson(url));
  return (j.results || []).map((r) => ({
    id: `itunes:${r.trackId}`, source: 'iTunes',
    title: r.trackName || '', artist: r.artistName || '', album: r.collectionName || '',
    album_artist: r.collectionArtistName || r.artistName || '', genre: r.primaryGenreName || '',
    date: (r.releaseDate || '').slice(0, 4),
    track: r.trackNumber ? (r.trackCount ? `${r.trackNumber}/${r.trackCount}` : `${r.trackNumber}`) : '',
    disc: r.discNumber ? (r.discCount ? `${r.discNumber}/${r.discCount}` : `${r.discNumber}`) : '',
    duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : null,
    coverUrl: itunesArt(r.artworkUrl100, 1200), coverThumb: itunesArt(r.artworkUrl100, 200),
    explicit: r.trackExplicitness === 'explicit',
  }));
}

async function searchDeezer(q) {
  const adv = q.artist ? `artist:"${q.artist}" track:"${q.title}"` : q.title;
  let j = await deezerQueue(() => getJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(adv)}&limit=15`));
  if ((!j.data || !j.data.length) && q.artist) j = await deezerQueue(() => getJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(`${q.artist} ${q.title}`)}&limit=15`));
  return (j.data || []).map((r) => ({
    id: `deezer:${r.id}`, source: 'Deezer', deezerId: r.id, deezerAlbumId: r.album && r.album.id,
    title: r.title || '', artist: (r.artist && r.artist.name) || '', album: (r.album && r.album.title) || '',
    album_artist: '', genre: '', date: '', track: '', disc: '',
    duration: r.duration || null,
    coverUrl: r.album && r.album.cover_xl, coverThumb: r.album && r.album.cover_medium,
    artistPicture: r.artist && r.artist.picture_xl, artistThumb: r.artist && r.artist.picture_medium,
    explicit: !!r.explicit_lyrics,
  }));
}

// Deezer search results don't carry track number, year or genre; fetch them for the chosen match.
async function completeDeezer(c) {
  if (!c || c.source !== 'Deezer' || c._complete) return c;
  try {
    const t = await deezerQueue(() => getJson(`https://api.deezer.com/track/${c.deezerId}`));
    const a = c.deezerAlbumId ? await deezerQueue(() => getJson(`https://api.deezer.com/album/${c.deezerAlbumId}`)) : {};
    const nb = a.nb_tracks;
    c.track = t.track_position ? (nb ? `${t.track_position}/${nb}` : `${t.track_position}`) : '';
    c.disc = t.disk_number ? `${t.disk_number}` : '';
    c.date = (t.release_date || a.release_date || '').slice(0, 4);
    c.album_artist = (a.artist && a.artist.name) || c.artist;
    c.genre = (a.genres && a.genres.data && a.genres.data[0] && a.genres.data[0].name) || '';
  } catch (_) {}
  c._complete = true;
  return c;
}

async function artistPicture(name) {
  if (!name) return null;
  try {
    const j = await deezerQueue(() => getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=3`));
    const best = (j.data || []).sort((x, y) => sim(y.name, name) - sim(x.name, name))[0];
    if (best && sim(best.name, name) > 0.7 && best.picture_xl && !/\/artist\/\/|\/images\/artist\/\//.test(best.picture_xl)) {
      return { url: best.picture_xl, thumb: best.picture_medium, label: `Artist photo · ${best.name}`, kind: 'artist' };
    }
  } catch (_) {}
  return null;
}

async function acoustid(key, fp, duration) {
  if (!key || !fp || !duration) return null;
  const body = new URLSearchParams({ client: key, meta: 'recordings releasegroups', duration: String(Math.round(duration)), fingerprint: fp });
  const j = await getJson('https://api.acoustid.org/v2/lookup', {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000,
  });
  if (j.status !== 'ok') throw new Error((j.error && j.error.message) || 'AcoustID error');
  const res = (j.results || []).sort((a, b) => b.score - a.score)[0];
  const rec = res && (res.recordings || []).find((r) => r.title && r.artists && r.artists.length);
  if (!rec) return null;
  return { artist: rec.artists.map((a) => a.name).join(', '), title: rec.title, score: res.score,
    album: rec.releasegroups && rec.releasegroups[0] && rec.releasegroups[0].title };
}

// Full lookup for one file.
async function identify({ fileName, tags, duration, fingerprint, acoustidKey, country, override }) {
  let q = override && override.title ? { artist: override.artist || '', title: override.title, from: 'search' } : buildQuery(fileName, tags);
  let fpMatch = null;
  if (!override && acoustidKey && fingerprint) {
    try { fpMatch = await acoustid(acoustidKey, fingerprint, duration); } catch (e) { fpMatch = { error: e.message }; }
    if (fpMatch && fpMatch.title && fpMatch.score > 0.6) q = { artist: fpMatch.artist, title: fpMatch.title, from: 'fingerprint' };
  }
  if (!q.title || (looksJunky(q.title) && !q.artist)) {
    return { query: q, candidates: [], covers: [], confidence: 0,
      error: 'The name and tags say nothing about the song. Type a search below, or turn on audio fingerprinting in Settings.' };
  }

  const term = `${q.artist} ${q.title}`.trim();
  const errors = [];
  const [it, dz] = await Promise.all([
    searchItunes(term, country).catch((e) => { errors.push(`iTunes: ${e.message}`); return []; }),
    searchDeezer(q).catch((e) => { errors.push(`Deezer: ${e.message}`); return []; }),
  ]);
  let candidates = [...it, ...dz];
  candidates.forEach((c) => { c.score = bestScore(c, q, duration); });
  // iTunes gives complete tags in one go, so prefer it on a near tie.
  candidates.sort((a, b) => (b.score + (b.source === 'iTunes' ? 0.015 : 0)) - (a.score + (a.source === 'iTunes' ? 0.015 : 0)));
  const seen = new Set();
  candidates = candidates.filter((c) => {
    const k = `${norm(c.title)}|${norm(c.artist)}|${norm(c.album)}|${c.source}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 10);

  if (candidates[0]) await completeDeezer(candidates[0]);
  if (fpMatch && fpMatch.title && candidates[0]) candidates[0].score = Math.min(1, candidates[0].score + 0.08);

  const covers = [];
  const coverSeen = new Set();
  const top = candidates[0] ? candidates[0].score : 0;
  for (const c of candidates) {
    if (c.coverUrl && !coverSeen.has(c.coverUrl) && c.score > 0.5 && c.score >= top - 0.1 && covers.length < 6) {
      coverSeen.add(c.coverUrl);
      covers.push({ url: c.coverUrl, thumb: c.coverThumb || c.coverUrl, label: `${c.album || 'Album'} · ${c.source}`, kind: 'album' });
    }
  }
  const best = candidates[0];
  const artistName = (best && best.score > 0.6 && best.artist) || q.artist;
  const ap = await artistPicture(artistName.split(/,|&| feat\.? | ft\.? /i)[0].trim());
  if (ap) covers.push(ap);

  return {
    query: q, fingerprint: fpMatch, candidates, covers,
    confidence: best ? Math.round(best.score * 100) : 0,
    error: !candidates.length ? (errors.join(' · ') || 'No matches found') : null,
  };
}

module.exports = { identify, completeDeezer, buildQuery, splitArtistTitle, cleanText, sim };
