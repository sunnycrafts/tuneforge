# Changelog

All notable changes to TuneForge. Versioning follows [semver](https://semver.org).

## 1.0.0

### Added
- **Convert tab.** Drop files or whole folders and convert to AAC (.m4a), Apple Lossless, MP3, FLAC, WAV, AIFF, Opus, Ogg Vorbis, WMA, AC3 or Audiobook (.m4b). Reads almost anything FFmpeg can open, including the soundtrack of video files.
- **Presets:** iTunes AAC 256, Apple Lossless, MP3 V0, MP3 320, MP3 small, FLAC archive, WAV (CD), Opus 128, Podcast/voice and Audiobook. Save your own with ★ Save preset.
- **One quality slider for every format**, with a live explanation of what the number means (e.g. "100 → LAME V0, about 245 kbps").
- **Tags and album art are kept**, including between formats that store them differently (Opus/Ogg ↔ MP3/M4A/FLAC). Each converted file is read back to check the art carried over.
- Output options: same folder or a chosen folder (optionally keeping subfolders), prefix, suffix, file names built from tags (`{artist} - {title}`, iTunes-style `Artist\Album\01 Title`), add a number / overwrite / skip when a file exists, send originals to the Recycle Bin, open the folder when done.
- **Add to iTunes:** copies finished files into iTunes' "Automatically Add to iTunes" folder.
- Sound options: sample rate, channels, bit depth, FLAC compression level, loudness normalisation (-14/-16/-23 LUFS) and silence trimming.
- Warnings in the queue when a conversion can't improve quality (lossy → lossless, low-bitrate source) or will drop album art.
- **Tag Fixer tab.** Looks songs up on iTunes and Deezer from their tags or a cleaned-up file name, scores the matches, and asks you to confirm. Edit any field, choose from album covers (up to 1200×1200) or an artist photo, search again, or accept every 90%+ match at once. Optional AcoustID audio fingerprinting. Can rename files or sort them into Artist\Album folders after saving.
- **History tab:** every conversion, tag change, error and update, searchable and exportable.
- Guide tab, hover tips on every setting, Windows 11 light/dark theme, pin-on-top, remembered window size and settings, update check against GitHub releases, keyboard shortcuts.
