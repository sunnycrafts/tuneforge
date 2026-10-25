// Shared by main.js (require) and the renderer (<script>): the output formats,
// what the quality slider means for each, and size estimates.
(function (root) {
  // cover: 'stream' = embedded picture stream, 'block' = Ogg METADATA_BLOCK_PICTURE, null = no artwork
  const FORMATS = {
    mp3:  { label: 'MP3',                    ext: 'mp3',  codec: 'libmp3lame', kind: 'lossy',    cover: 'stream', tags: true,  itunes: true,
            modes: ['vbr', 'cbr'], rates: [64, 96, 128, 160, 192, 224, 256, 320], maxRate: 48000,
            blurb: 'Plays on everything. The safe choice for phones, cars and iTunes.' },
    aac:  { label: 'AAC (.m4a)',             ext: 'm4a',  codec: 'aac',        kind: 'lossy',    cover: 'stream', tags: true,  itunes: true,
            modes: ['cbr'], rates: [64, 96, 128, 160, 192, 224, 256, 320], maxRate: 96000,
            blurb: 'What iTunes and Apple Music use. Sounds better than MP3 at the same size.' },
    alac: { label: 'Apple Lossless (.m4a)',  ext: 'm4a',  codec: 'alac',       kind: 'lossless', cover: 'stream', tags: true,  itunes: true,
            blurb: 'Perfect copy of the audio that iTunes can play. About half the size of WAV.' },
    m4b:  { label: 'Audiobook (.m4b)',       ext: 'm4b',  codec: 'aac',        kind: 'lossy',    cover: 'stream', tags: true,  itunes: true,
            modes: ['cbr'], rates: [32, 48, 64, 96, 128, 160], maxRate: 48000,
            blurb: 'AAC that iTunes files under Audiobooks and remembers your place in.' },
    flac: { label: 'FLAC',                   ext: 'flac', codec: 'flac',       kind: 'lossless', cover: 'stream', tags: true,  itunes: false,
            blurb: 'Perfect copy, smallest lossless file. iTunes cannot play FLAC.' },
    wav:  { label: 'WAV',                    ext: 'wav',  codec: 'pcm',        kind: 'pcm',      cover: null,     tags: true,  itunes: true,
            blurb: 'Uncompressed and huge. Basic tags only and no album art.' },
    aiff: { label: 'AIFF',                   ext: 'aiff', codec: 'pcm_be',     kind: 'pcm',      cover: 'stream', tags: true,  itunes: true,
            blurb: 'Uncompressed like WAV, but keeps full tags and album art in iTunes.' },
    ogg:  { label: 'Ogg Vorbis',             ext: 'ogg',  codec: 'libvorbis',  kind: 'lossy',    cover: 'block',  tags: true,  itunes: false,
            modes: ['vbr'], rates: [64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 500], maxRate: 192000,
            blurb: 'Open format used by games and Spotify. iTunes cannot play it.' },
    opus: { label: 'Opus',                   ext: 'opus', codec: 'libopus',    kind: 'lossy',    cover: 'block',  tags: true,  itunes: false,
            modes: ['cbr'], rates: [32, 48, 64, 96, 128, 160, 192, 256], maxRate: 48000,
            blurb: 'Best quality per MB of any format. Great for voice. iTunes cannot play it.' },
    wma:  { label: 'WMA',                    ext: 'wma',  codec: 'wmav2',      kind: 'lossy',    cover: null,     tags: true,  itunes: false,
            modes: ['cbr'], rates: [64, 96, 128, 160, 192], maxRate: 48000,
            blurb: 'Old Windows Media format. Only pick it for an old device that needs it.' },
    ac3:  { label: 'AC3 (Dolby Digital)',    ext: 'ac3',  codec: 'ac3',        kind: 'lossy',    cover: null,     tags: false, itunes: false,
            modes: ['cbr'], rates: [96, 128, 192, 256, 384, 448, 640], maxRate: 48000,
            blurb: 'For DVD/home-theatre audio. Holds no tags.' },
  };

  const MP3_VBR_KBPS = [245, 225, 190, 175, 165, 130, 115, 100, 85, 65];

  // Every format reads the same 0-100 slider. This turns it into real encoder settings.
  function qualityPlan(fmtKey, quality, mode) {
    const f = FORMATS[fmtKey];
    const q = Math.max(0, Math.min(100, Math.round(quality)));
    if (!f || f.kind !== 'lossy') return { lossless: true, kbps: null };
    const useMode = (f.modes || ['cbr']).includes(mode) ? mode : f.modes[0];
    if (fmtKey === 'mp3' && useMode === 'vbr') {
      const v = Math.round((100 - q) * 9 / 100);
      return { mode: 'vbr', vbrLevel: v, kbps: MP3_VBR_KBPS[v], args: ['-q:a', String(v)], label: `V${v}` };
    }
    if (fmtKey === 'ogg') {
      const vq = Math.round(q / 10);
      return { mode: 'vbr', vbrLevel: vq, kbps: f.rates[vq], args: ['-q:a', String(vq)], label: `q${vq}` };
    }
    const idx = Math.round(q / 100 * (f.rates.length - 1));
    const kbps = f.rates[idx];
    return { mode: 'cbr', kbps, args: ['-b:a', `${kbps}k`], label: `${kbps} kbps` };
  }

  // Plain-English explanation shown under the slider.
  function describeQuality(fmtKey, quality, mode) {
    const f = FORMATS[fmtKey];
    if (!f) return '';
    if (f.kind !== 'lossy') {
      return `${f.label} is lossless, so there is no quality to choose: every sample is kept exactly. ` +
        'The slider does nothing here. File size depends only on the audio itself' +
        (fmtKey === 'flac' ? ' and the compression level (which only trades speed for size).' : '.');
    }
    const p = qualityPlan(fmtKey, quality, mode);
    const mbPerMin = (p.kbps * 60 / 8 / 1024).toFixed(1);
    let txt;
    if (fmtKey === 'mp3' && p.mode === 'vbr') {
      txt = `LAME VBR ${p.label}, about ${p.kbps} kbps (≈${mbPerMin} MB per minute). VBR spends more bits on busy passages and fewer on quiet ones. `;
      if (p.vbrLevel === 0) txt += 'This is the best VBR setting: nobody can reliably tell it from the original. 320 kbps CBR is the only thing above it and it just makes bigger files.';
      else if (p.vbrLevel <= 2) txt += 'Transparent for nearly everyone, and smaller than V0.';
      else if (p.vbrLevel <= 5) txt += 'Fine on phone speakers and in the car; trained ears can hear artefacts on headphones.';
      else txt += 'Small files. Fine for speech and podcasts, noticeably worse for music.';
    } else if (fmtKey === 'ogg') {
      txt = `Vorbis quality ${p.vbrLevel} of 10, about ${p.kbps} kbps (≈${mbPerMin} MB per minute). `;
      txt += p.vbrLevel >= 6 ? 'Transparent for music.' : p.vbrLevel >= 4 ? 'Good everyday quality.' : 'Small files, best for speech.';
    } else {
      txt = `${p.kbps} kbps constant bitrate (≈${mbPerMin} MB per minute). `;
      if (fmtKey === 'aac' || fmtKey === 'm4b') {
        if (p.kbps >= 320) txt += 'The highest AAC setting. iTunes Store music is 256 kbps, so 320 only makes the file bigger.';
        else if (p.kbps >= 256) txt += 'Same bitrate as iTunes Store downloads ("iTunes Plus"). Transparent.';
        else if (p.kbps >= 160) txt += 'Very good; hard to tell apart from the original.';
        else if (p.kbps >= 96) txt += 'Good for phone listening and audiobooks.';
        else txt += 'Speech only; music will sound thin.';
      } else if (fmtKey === 'opus') {
        txt += p.kbps >= 160 ? 'Opus is transparent here; going higher only adds size.' : p.kbps >= 96 ? 'Excellent for music.' : 'Great for voice, podcasts and audiobooks.';
      } else if (fmtKey === 'mp3') {
        txt += p.kbps >= 320 ? 'The maximum MP3 allows. Use VBR V0 instead for a smaller file that sounds the same.' :
          p.kbps >= 192 ? 'Good quality for music.' : p.kbps >= 128 ? 'Typical old-download quality.' : 'Speech and podcasts only.';
      } else {
        txt += p.kbps >= 192 ? 'High quality for this format.' : 'Lower quality, smaller file.';
      }
    }
    return txt;
  }

  // Rough output size in bytes for one file.
  function estimateBytes(fmtKey, quality, mode, info, s) {
    const f = FORMATS[fmtKey];
    const dur = (info && info.duration) || 0;
    if (!f || !dur) return 0;
    if (f.kind === 'lossy') return qualityPlan(fmtKey, quality, mode).kbps * 1000 / 8 * dur;
    const rate = (s && s.sampleRate !== 'keep' && +s.sampleRate) || (info && info.sampleRate) || 44100;
    const ch = (s && s.channels !== 'keep' && +s.channels) || (info && info.channels) || 2;
    const bits = (s && s.bitDepth !== 'keep' && +s.bitDepth) || (info && info.bits) || 16;
    const raw = rate * ch * bits / 8 * dur;
    return f.kind === 'pcm' ? raw : raw * 0.58;
  }

  const api = { FORMATS, qualityPlan, describeQuality, estimateBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Formats = api;
})(this);
