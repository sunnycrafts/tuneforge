# TuneForge — Audio Converter for Windows

ClipForge's sibling for audio. Drop in songs or whole folders, pick a format, and
get files that keep their tags and album art. When the tags are missing or wrong,
the Tag Fixer looks the song up on iTunes and Deezer and asks before changing
anything. Electron app, FFmpeg under the hood.

## Running

```bash
npm install
npm start
```

FFmpeg: put `ffmpeg.exe` and `ffprobe.exe` in `resources/` (not in git, they are
~200 MB each). The same binaries as ClipForge work; the build must include
`libmp3lame`, `libopus`, `libvorbis` and `chromaprint` (the gyan.dev "full" build does).

## Building

```bash
npm run build
```

Makes an NSIS installer and a portable exe in `dist/`. The portable exe keeps its
settings and log in a `<exe name> Data` folder next to itself.

## Files

| File | What it does |
|---|---|
| `main.js` | Window, settings, history log, convert jobs, tag saving, update check |
| `media.js` | ffprobe/ffmpeg: reading tags and art, building convert commands, rewriting tags |
| `lookup.js` | Filename cleaning, iTunes/Deezer/AcoustID lookups, match scoring |
| `formats.js` | Output formats and what the quality slider means for each (shared with the UI) |
| `index.html`, `renderer.js` | The interface |

## How tags survive conversion

Tags are read with ffprobe from both the container and the audio stream (Ogg and
Opus keep them on the stream), normalised, and written back through an ffmetadata
file. Album art is mapped as an attached picture for MP3/M4A/FLAC/AIFF, and written
as a `METADATA_BLOCK_PICTURE` comment for Ogg/Opus, which FFmpeg can't do on its own.
MP3s get ID3v2.3 for iTunes and Explorer.

## Updates

The app checks `https://api.github.com/repos/sunnycrafts/tuneforge/releases/latest`.
Publish a release with a tag like `v1.0.1` and the installer attached, and users
get a banner.
