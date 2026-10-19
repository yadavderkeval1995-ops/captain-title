These font files are used by ffmpeg/libass to render burned-in captions and
are not installed system-wide - they're loaded directly from this directory
via the `fontsdir` option on the `subtitles` filter (see `_render` in
`captions.py`).

All of them are Google Fonts, licensed under the SIL Open Font License 1.1
(https://scripts.sil.org/OFL), which permits bundling and redistribution:

- Anton - Copyright 2011 The Anton Project Authors
- Bebas Neue - Copyright 2020 The Bebas Neue Project Authors
- Caveat - Copyright 2017 The Caveat Project Authors
- Permanent Marker - Copyright 2011 Font Diner / Sideshow
- Playfair Display - Copyright 2017 The Playfair Display Project Authors
- Poppins - Copyright 2020 The Poppins Project Authors

Fetched via the `@fontsource/*` npm packages (which redistribute the
official Google Fonts files) and converted from `.woff2` to `.ttf` with
`fonttools`, since libass needs TrueType/OpenType rather than a web format.
