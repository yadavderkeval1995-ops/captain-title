# Tadaaam × tscaps — Integration Plan

*Version: 2026-10-27. Author: planning pass for Keval. Audience: the owner,
future developers and AI agents. Based on reading the public repository
https://github.com/francozanardi/tscaps at commit `26611a3` (last upstream
sync 2026-10-19): its README, `packages/engine` README and
`docs/RENDERING_INTERNALS.md`, the template docs under `templates/_docs/`, and
the studio's transcription, tagging, font and project wiring. tscaps code was
read, not installed or executed; performance claims below are the upstream
project's, not measured here.*

> **Owner clarifications (2026-10-29) — these override anything below:**
> 1. The product is named **Tadaaam** (formerly Captain Title; the repo folder
>    is still `captain-title`).
> 2. **Sarvam is Tadaaam's speech-recognition AI** — it decides *what* was
>    said. **Whisper is only a timecode source** (per-word timing for
>    captions/SRT in the hybrid mode); its own words are discarded. Whisper is
>    never an alternative recogniser for Hindi/Hinglish. "Swappable providers"
>    means other *recognisers* (and aligners) can be added beside Sarvam.
> 3. Tadaaam has **only two templates today** (Street Glow, Doodle Marker);
>    more will be added later, so template work optimises for adding new ones
>    cheaply. Any "gallery" below is future work.
> 4. Work started at **Phase 1** (the backend Speech Service) on 2026-10-29;
>    Phase 0 (tscaps spike) is deferred and is not a prerequisite for Phase 1.
>    Phase 1 status: see Appendix D and `docs/TRACKER.md` (X-01).

**Status of this plan:** Phase 1 in progress. Decisions that need the owner are collected
in §12. Related docs: `docs/COMPREHENSIVE.md`, `docs/DECISIONS.md` (D-039),
`docs/TRACKER.md`.

---

## Contents

1. Recommendation in one paragraph
2. What tscaps is (findings)
3. What it solves for us — and what it does not
4. Licensing and the integration options
5. Target architecture
6. Swappable speech providers (Sarvam for words, Whisper for timing, others pluggable)
7. Multilingual design (Hindi, Hinglish, Indian languages, everything else)
8. Mapping Tadaaam concepts onto tscaps
9. What we keep, what we retire
10. Phase-wise implementation plan
11. Risks and mitigations
12. Decisions needed from the owner
13. Appendices: transcript schema, provider capability matrix, language table, task checklists

---

## 1. Recommendation in one paragraph

Treat tscaps as **"step one"** exactly as the owner framed it: adopt its
**rendering engine** (`@tscaps/engine`, MIT) and its **editor**
(`apps/studio`, AGPL-3.0, forked) as Tadaaam's new front end, and turn
our FastAPI backend into a **multilingual Speech Service** that the editor
calls through tscaps' existing *external transcriber* hook. Our differentiators
— Indian-language and code-mixed transcription (Sarvam and others), Roman
Hinglish and other transliteration, AI emphasis tagging, accounts and usage —
live in that service behind a **provider-agnostic interface**: Sarvam
recognises the words today, Whisper only contributes timecodes, and any future
recogniser or aligner can be swapped in by configuration. tscaps renders
captions with the **same HTML/CSS in preview and export**, which removes our
biggest structural problem (two renderers: CSS preview vs libass export). We
replace their templates over time with our own, rebuilt on their template
contract. Build in phases (§10), starting with a one-week spike that proves a
Hinglish video renders correctly through the tscaps engine.

---

## 2. What tscaps is (findings)

### 2.1 Product
A client-side caption editor for short-form video. Drop a video, transcribe it
in the browser with Whisper (tiny/base/small/medium via transformers.js +
onnxruntime-web, WebGPU or WASM), pick one of ~40 CSS templates, tune
controls, and export an MP4 with captions burned in — all in the browser, no
upload. A hosted product (tscaps.io) adds closed-source server transcription,
LLM tagging ("AI styling"), project sync and an automation API.

### 2.2 Repository layout (pnpm monorepo)

| Path | What | License |
| --- | --- | --- |
| `packages/engine` | `@tscaps/engine` — framework-agnostic TypeScript rendering pipeline (npm) | **MIT** |
| `apps/studio` | The editor web app (React 18, Vite 5, TypeScript 5.9, MediaBunny, IndexedDB) | **AGPL-3.0** |
| `templates/` | 47 template folders (`template.json` + `style.scss` [+ `filters.svg`]), shared Sass library, docs | **MIT** |
| `skills/tscaps-api` | Agent skill for their hosted API | MIT |

Upstream commits are mirrored "sync from internal" snapshots — the public repo
trails a private one; expect large, unannounced changes between syncs.

### 2.3 The engine (`@tscaps/engine`)

**Pipeline** (`RenderPipelineBuilder`), each stage replaceable:
`transcriber → segment splitter → semantic taggers → effects → line splitter →
structural tagger → rendering (video renderer)`. Per-step execution and
`getDocument()/setDocument()` let a host inspect or edit the document between stages.

**Document model**
```
Document (language, narrationPace, metadata)
└── Section[]  (kind → which style/splitter/tagger chain applies)
    └── Segment[]  one on-screen caption block, time range
        └── Line[]  one visible line
            └── Word[]  text, displayText, time, structureTags, semanticTags,
                        speakerId, decoration (emoji), boundaryScore, metadata
```

**Rendering.** Captions are real DOM (`.segment > .line > .word [> .letter]`).
Preview = that DOM over a `<video>`. Export = for each output frame, the same
DOM is wrapped in SVG `<foreignObject>`, rasterized to a canvas, composited with
the decoded video frame, and encoded via WebCodecs (MediaBunny) to MP4/WebM.
**Preview and export share one renderer.** Chromium is the reference browser;
Firefox/Safari have `<foreignObject>` quirks.

**Styling surfaces** exposed to CSS: element classes; per-frame state classes
(`word-being-narrated`, `line-already-narrated`, …); structural classes
(`first-word-in-line`, `last-line-in-segment`, …); semantic tag classes from
taggers; per-element custom properties for timing (`--on-word-being-narrated-starts`,
`--segment-duration`, …), structure (`--word-index`, `--segment-char-count`, …),
measured widths (`--line-width-em`), layout (`--subtitle-region-*`), and an
optional `--video-frame` image. Container units (`cqh`, `cqw`) size type
relative to the frame.

**Transcribers:** `WhisperTranscriber` (in-browser), `SrtTranscriber`,
`VttTranscriber`, `PassthroughTranscriber` (hand it a `Document`), or any class
implementing:
```ts
interface Transcriber {
  onProgress?: (e: { stage: 'loading'|'inferring'; progress?: number }) => void;
  onUntranscribedRegion?: (r: { startSeconds: number; endSeconds: number }) => void;
  transcribe(audio: Blob, options?: { language?: string }): Promise<Document>;
}
```

**Splitters.** Segment: `CompositeSegmentSplitter` (default: sentence boundary +
scaled character budget), `BoundarySegmentSplitter`,
`BoundaryScoreLimitByCharsSegmentSplitter` (uses each word's `boundaryScore`),
`LimitByWordsSegmentSplitter`, `LimitByScaledCharsSegmentSplitter`,
`PauseBasedSegmentSplitter`, `SpeakerChangeSegmentSplitter`. Line:
`BalancedLineSplitter` (chars), `BalancedPixelWidthLineSplitter` (measured
pixels), `FixedTailLineSplitter`, `IsolatedWordLineSplitter`. Word:
`GraphemeWordSplitter` (`Intl.Segmenter`, keeps grapheme clusters intact).

**Taggers:** `RegexTagger`, `WordlistTagger`, `SpanTagger`, custom `Tagger`
subclasses. Studio vocabulary (`TAG_NAMES`): `number, quote, emphasis, accent,
peak, hook, entity, cta, superlative, stat, cut`. The open-source build tags
numbers/quotes locally; LLM tagging exists only in their hosted product.

**Other:** Unicode bidi for RTL/mixed text; cuts (remove time ranges, captions
realign); subtitle serializers (SRT, VTT, ASS, SBV, TTML, TXT; word-level
optional); per-element overrides; multiple styles per document; overlay HTML;
streaming output; progress callbacks.

**Headless use:** `packages/engine/examples/cli` starts Vite, launches
Chromium via Playwright, calls `window.renderHeadless()` and saves the MP4 — a
ready pattern for server-side rendering.

### 2.4 The studio (`apps/studio`)
- Clean architecture: `core/<feature>/{actions,domain,infrastructure,services,store}`,
  boot functions per feature under `bootstrap/wiring/`.
- **Injection points** in `createEditorApp(options)`: `transcriber?:
  ConfigurableTranscriber` ("External transcriber; when omitted, picks the
  surface default"), `startFlow?`, `postExportPrompt?`, `exitHref?`,
  `projectPersistenceEnabled`. `ConfigurableTranscriber = Transcriber &
  { initialPhase; setConfig(config: unknown) }`. This is precisely the hook
  their own cloud uses — and the one we use.
- Features: templates gallery and per-template controls, CSS tab, per-word /
  per-scene / per-emoji editing, sheets (different looks for different parts,
  linkable), timeline with waveform, cuts and auto-silence removal, bad-take
  removal, text-behind-subject (on-device person segmentation), word tags
  editor, SRT/VTT import, subtitle export, IndexedDB projects, user templates,
  asset library, shortcuts, translations (UI i18n).
- Font system: **font stacks** — one face per writing system (Latin, Arabic,
  Hebrew, Urdu, Cyrillic, Greek, Devanagari, Bengali, Telugu, Tamil, Thai),
  `FontScriptRanges`, and a `check-language-coverage` script that fails when an
  offered language has no bundled face. **Missing Indian scripts:** Gujarati,
  Gurmukhi (Punjabi), Kannada, Malayalam, Odia (and Ol Chiki, Meetei Mayek for
  Sarvam's long-tail languages).
- Language catalog: Whisper's ~99 languages (`WhisperSupportedLanguages.ts`,
  includes Hindi `hi`), each with code, English name, endonym, ISO 639-1.
- Tests: Vitest unit tests (many), Playwright e2e, template contract and
  language-coverage scripts, CI workflows (verify, docker publish, engine publish).

---

## 3. What it solves for us — and what it does not

### 3.1 Our open issues that tscaps resolves or reshapes

| Tadaaam issue (TRACKER) | How tscaps changes it |
| --- | --- |
| #1, #3, P-01…P-05, P-07 — preview/export parity, font-size unit mismatch, faux-bold, font files | **Eliminated by design**: one DOM/CSS renderer for both preview and export; fonts loaded once by the browser. |
| #11 — two implementations per template | **Eliminated**: a template is one SCSS + JSON. |
| #13 — repeatable visual tests | Template contract checks + Playwright e2e exist; we add golden-frame tests on top (renderer is deterministic per browser). |
| #2 — phrase grouping | `BoundaryScoreLimitByCharsSegmentSplitter` lets the **backend** compute Hindi/Indic phrase-boundary scores; plus pause- and sentence-based splitters. |
| #5 — long words shrinking | Scaled-character budgets, pixel-balanced line splitting, `--segment-char-count`/`--line-width-em` auto-shrink rules in CSS. |
| #8 — split/merge/edit preserving timing and style | Mature structure-edit actions (split at cursor, merge with sibling, redistribute words, insert/delete word, edit word time) with unit tests. |
| #9 — preview performance | Purpose-built preview surfaces/proxies; to be measured on the owner's PC. |
| #10 — word-level reveal | Native: state classes + timing variables per word. |
| #12 — template-safe colour customization | Native: per-template controls and colour presets. |
| SRT one-cue-per-word (B-02) | Serializers for SRT/VTT/ASS/SBV/TTML with segment or word granularity. |
| Missing editor features (undo, cuts, silence removal, text behind subject, project list) | Present in the studio. |

### 3.2 What tscaps does not have (our job)

1. **Server-side, provider-agnostic transcription** — the open-source build is
   in-browser Whisper only; the hosted cloud transcriber is closed.
2. **Indian-language accuracy** — browser Whisper (≤ medium) is weak on Hindi
   and code-mixed speech; Sarvam is far better (our measured experience).
3. **Romanization / transliteration** — no Hinglish (Roman Hindi) output, no
   per-language script choice.
4. **AI tagging** — LLM tagging is hosted-only.
5. **Fonts for five more Indian scripts.**
6. **Accounts, usage limits, payments, cloud project storage.**
7. **Audio features we built:** synthesized SFX mixing in export, volume boost.
8. **Server rendering service** (only the headless example).
9. **Our two designs** (Street Glow, Doodle Marker) and an India-first template gallery.

---

## 4. Licensing and the integration options

> Not legal advice; confirm with a lawyer before a commercial launch.

- **Engine, templates, skills: MIT.** Use, modify, embed, ship commercially;
  keep the copyright notice.
- **Studio: AGPL-3.0.** You may use and modify it freely. If you **convey** it
  or **let users interact with a modified version over a network**, you must
  offer those users the complete corresponding source of *the studio* under
  AGPL. Personal/local use triggers nothing. A separate backend that the studio
  talks to over HTTP is generally treated as a separate program (keep it
  genuinely separate: own repo, own process, documented API).

### Options

| Option | What we do | Pros | Cons |
| --- | --- | --- | --- |
| **A. Engine only** | Keep/rebuild our own editor (React), embed `@tscaps/engine` for preview + export, write our own templates/UI | All-MIT; no source-disclosure duty; full control | Rebuild a lot of editor UX tscaps already has (timeline, cuts, sheets, per-element edits, templates gallery) — months |
| **B. Fork the studio** | Fork `apps/studio` as "Tadaaam Studio", inject our transcriber/tagger/auth, restyle, swap templates | Fastest path to a far better editor; inherits tests and future upstream work | AGPL: when hosted for others, publish the fork's source; upstream churn |
| **C. Staged (recommended)** | B now (local/personal use; no AGPL duty), architect so **all proprietary value sits in the backend API**; at the commercial gate choose: publish the studio fork (AGPL-compliant) **or** migrate to A using the engine + our own UI | Speed now, freedom later; the backend is reusable either way | Must keep the studio fork thin (adapters, theme, templates) to keep a later migration cheap |

**Recommendation: Option C.** Keep the fork's changes in a small number of
adapter modules (`core/captain-title/*`, `bootstrap/wiring/captain-title.ts`) and
templates; never put business logic in the studio.

---

## 5. Target architecture

```
┌──────────────────────── Tadaaam Studio (fork of tscaps apps/studio) ────────────────────────┐
│ React 18 + Vite. Editor, templates, timeline, cuts, sheets, per-element edits, export (WebCodecs).   │
│ @tscaps/engine renders captions as DOM/CSS for BOTH preview and export.                              │
│                                                                                                     │
│  Adapters (ours, thin):                                                                              │
│   • TadaaamTranscriber : ConfigurableTranscriber  → Speech Service /api/v2/transcriptions       │
│   • TadaaamTagger           : semantic tags from the service (emphasis, peak, hook, entity, …)       │
│   • Language & script picker, provider picker (start flow / settings)                               │
│   • Auth session + usage display; (later) project sync                                               │
│   • Tadaaam templates (Street Glow v2, Doodle Marker v2, India-first gallery) + Indic fonts    │
└───────────────┬─────────────────────────────────────────────────────────────────────────────────────┘
                │ HTTPS JSON + multipart audio (audio only — not the video)
┌───────────────▼──────────────────────── Tadaaam Speech Service (our FastAPI) ─────────────────┐
│ /api/auth/*  /api/usage  /api/v2/transcriptions  /api/v2/languages  /api/v2/providers               │
│                                                                                                     │
│  Transcription pipeline                                                                              │
│   1. Audio intake (any container → 16 kHz mono WAV)                                                 │
│   2. Language resolution (explicit / auto-detect / code-mix)                                         │
│   3. Provider routing (ProviderRegistry + routing table + per-request override + fallback chain)     │
│   4. Chunking (silence-snapped, overlap priming; sized per provider's max request length)            │
│   5. Provider call(s) → ProviderResult (words or phrases, confidence, language)                      │
│   6. Timing: native word timestamps | forced alignment | proportional spread (capability-driven)     │
│   7. Safety rails: repetition/hallucination rejection, overlap de-dup, timing normalization          │
│   8. Script layer: native / Roman / both / translation per language (rules, provider, LLM)           │
│   9. Tagging: LLM or heuristic → tscaps tag vocabulary; boundary scores for phrase-aware grouping    │
│  10. Canonical Transcript JSON (versioned) → client builds an engine Document                        │
│                                                                                                     │
│  Providers (pluggable): Sarvam · OpenAI Whisper · OpenAI gpt-4o(-mini)-transcribe · ElevenLabs       │
│  Scribe · Deepgram · AssemblyAI · Google Chirp · local faster-whisper / WhisperX · (browser Whisper  │
│  stays available client-side as an offline option)                                                  │
│                                                                                                     │
│  Optional later: Render Worker (headless Chromium + engine) for batch/mobile/automation              │
└───────────────┬───────────────────────────────┬─────────────────────────────────┬───────────────────┘
             MongoDB                     Provider APIs                     Object storage (later)
```

Key properties:
- **Video never needs to leave the device** for the default flow: the studio
  extracts audio and sends only audio to our service (smaller, faster, more private).
- **Rendering is client-side** by default (owner's Chromium). Server rendering is
  an optional worker, not a dependency.
- **The backend is the product moat**; the studio is a replaceable shell.

---

## 6. Swappable speech providers

### 6.1 Requirements (from the owner)
- Sarvam is the recogniser (decides the words). Whisper is used only for
  word-level timecodes. Add or swap in any other provider later without code
  changes in callers.
- Not English-specific: Hindi, Hinglish, all Indian languages, and other languages.

### 6.2 Provider interface (Python)

```python
class ProviderCapabilities(BaseModel):
    id: str                                  # "sarvam", "openai-whisper", "elevenlabs-scribe", ...
    languages: set[str] | Literal["*"]       # BCP-47 / ISO 639-1 codes it accepts
    auto_detect: bool                        # can it detect language itself
    code_switching: bool                     # handles mixed-language speech (e.g. Hinglish)
    timestamps: Literal["word", "phrase", "none"]
    max_request_seconds: float | None        # e.g. Sarvam 30
    diarization: bool
    keyterms: bool                           # accepts vocabulary/context hints
    native_script_output: bool               # returns Devanagari etc. (vs romanized/translated)
    cost_per_minute_inr: float | None        # for metering and routing
    runs_locally: bool

class TranscribeRequest(BaseModel):
    language: str | None                     # None = auto
    code_mix: bool = False
    keyterms: list[str] = []
    prompt: str = ""                         # carried context
    want_diarization: bool = False

class ProviderWord(BaseModel):
    text: str; start: float | None; end: float | None
    confidence: float | None = None; speaker: str | None = None

class ProviderPhrase(BaseModel):
    text: str; start: float; end: float

class ProviderResult(BaseModel):
    words: list[ProviderWord] | None         # when timestamps == "word"
    phrases: list[ProviderPhrase] | None     # when timestamps == "phrase"
    text: str
    language: str | None
    raw: dict                                # provider response, for debugging

class SpeechProvider(Protocol):
    capabilities: ProviderCapabilities
    async def transcribe(self, audio_path: str, request: TranscribeRequest) -> ProviderResult: ...
```

Errors are normalized into one taxonomy: `ProviderAuthError` (bad key / no
credit; never retried, surfaced verbatim), `ProviderQuotaError` (rate limit;
retried with backoff), `ProviderUnsupportedError` (language/duration; triggers
fallback), `ProviderTransientError` (5xx/network; retried then fallback),
`ProviderBadOutputError` (empty/garbage; fallback). Today's
`TranscriptionAuthError` becomes `ProviderAuthError`.

### 6.3 Registry, configuration and routing

- `ProviderRegistry` discovers providers whose credentials are present
  (`SARVAM_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, …)
  and local ones whose models are installed.
- **Routing table** (YAML/JSON in the backend, editable without code):
  ```yaml
  default: sarvam
  routes:
    - languages: [hi, bn, ta, te, kn, ml, mr, gu, pa, or, as, ur, ne, kok, ks, sd, sa, mai, doi, mni, brx, sat]
      code_mix: any
      provider: sarvam
      fallback: [elevenlabs-scribe, openai-whisper]
    - languages: ["*"]
      provider: openai-gpt4o-transcribe
      fallback: [elevenlabs-scribe, deepgram-nova3, openai-whisper, local-faster-whisper]
  ```
- Precedence: **request override** (the studio's provider dropdown) → user
  default → routing table → global default.
- `GET /api/v2/providers` returns available providers + capabilities so the UI
  shows only working choices (e.g. hides Whisper when no OpenAI key, as today's
  dropdown label hints).

### 6.4 Capability-driven timing
| Provider gives | Pipeline does |
| --- | --- |
| Word timestamps | Use them (normalize) |
| Phrase timestamps | Forced alignment of the phrase text to its audio span when the aligner supports the language; else proportional spread (today's Sarvam-only method) |
| No timestamps | Forced alignment over the chunk; else even spread with low confidence flag |
| Two providers (text from A, timing from B) | Existing global sequence alignment ("hybrid", today's Whisper+Sarvam) as a *composite provider* |

**Forced aligner** (Phase 6): a local CTC aligner — Meta **MMS** forced
alignment (1,100+ languages incl. all major Indic), or wav2vec2/IndicWav2Vec
per language, or WhisperX's alignment models — behind its own `Aligner`
interface with `languages` capability.

### 6.5 Contract tests
Every provider must pass the same suite: returns monotonic times within the
chunk, non-empty text on the corpus clip of its language, normalized errors on
a bad key (with a fake key set only in the test process), respects
`max_request_seconds`, and round-trips through the pipeline to a valid
Canonical Transcript.

### 6.6 Cost metering
Every provider call records `{provider, seconds, cost_inr}` into a usage
ledger → feeds minute-based pricing (D-030) and per-provider cost reports.

---

## 7. Multilingual design

### 7.1 Language model in the product
- **Spoken language**: explicit code, or `auto`. Plus a **code-mix** flag
  (Hinglish = Hindi + English; also Tanglish, Benglish, Manglish, etc.).
- **Output script** per language: `native` (देवनागरी), `roman`
  (Hinglish-style transliteration), `both` (two lines — great for a
  dual-script template), or `translation` (e.g. English subtitles of Hindi
  speech; optional, Phase 5+).
- **Language catalog** endpoint: union of providers' languages with metadata
  (endonym, script, direction, supported output scripts, recommended
  provider, font availability) — reusing tscaps' `SupportedLanguage` shape
  (`code`, `nameEn`, `nativeName`, `iso639_1`) extended with `script`,
  `direction`, `outputScripts`, `providers`.

### 7.2 Script / transliteration layer (backend)
Per word we always keep both forms when available:
`native` (provider output in its script) and `roman` (transliteration);
`display` = whichever the user chose. Engines, in order of preference per language:
1. **Dictionary** of high-frequency words per language (today: ~200 Hindi words).
2. **LLM** context-aware romanization (today: GPT for Hinglish), when available.
3. **Provider transliteration** (Sarvam `translit` mode / transliteration API) for Indic.
4. **Rule-based** (today: `indic_transliteration` + Hindi schwa deletion);
   extend schwa rules to Marathi, Punjabi, Gujarati; no schwa deletion for
   Bengali/Odia/Tamil/Telugu/Kannada/Malayalam (different phonology — use
   language-specific romanization conventions).
Never let a non-requested script leak into `display` (today's invariant, generalized).

### 7.3 Word segmentation and grouping across scripts
- Indic, Latin, Cyrillic, Arabic: whitespace words (providers already return words).
- Thai, Lao, Khmer, Chinese, Japanese: no spaces → segment with
  `Intl.Segmenter` (`GraphemeWordSplitter` client-side) or provider word lists;
  timestamps per token.
- Segment size: `LimitByScaledCharsSegmentSplitter` with **per-script scale
  factors** (Devanagari conjuncts and matras are wider/taller than Latin
  letters; CJK characters ≈ 2 Latin).
- **Boundary scores** from the backend (Phase 3/5): per word, a 0–1 score for
  "a caption may end after this word", computed from pause length,
  punctuation, language-specific function words (Hindi: है/हैं/था/रहे/को/से/में/के/की…
  attach to the left; postpositions never start a caption), and LLM phrase
  chunking when available → `BoundaryScoreLimitByCharsSegmentSplitter`.
  This is the "DP grouping" the old status table wanted, done properly.

### 7.4 Fonts and shaping
- Add stacks/faces for **Gujarati, Gurmukhi, Kannada, Malayalam, Odia** (Noto
  Sans variants), plus Devanagari display faces beyond Poppins/Kalam (e.g.
  Mukta, Hind, Baloo 2, Rozha One, Yatra One, Tiro Devanagari — we already
  bundle these), registered in `FontFamilyCatalog`, `FontScriptRanges`,
  `FontStackCatalog`; extend `check-language-coverage` to require them.
- **Template audit for Indic scripts** (and contract rules to enforce):
  `text-transform: uppercase` is a no-op for Indic (fine, but the design must
  still work without capitals); **`letter-spacing` breaks Indic conjunct
  shaping** — disable for non-Latin scripts; **`splitWordsIntoLetters`** must
  split by grapheme cluster, not code point, or matras detach — verify; line
  height must clear the shirorekha and below-base matras; italic/oblique
  synthesis on Devanagari looks broken — avoid.
- Verify Devanagari shaping inside SVG `<foreignObject>` in Chromium on
  Windows (Phase 0 spike).

### 7.5 RTL and mixed text
tscaps resolves bidi per line (Arabic, Hebrew, Persian, Urdu). Urdu speech via
Sarvam (`ur-IN`) or Whisper renders correctly without extra work; Roman Urdu is
a script option like Hinglish.

---

## 8. Mapping Tadaaam concepts onto tscaps

| Tadaaam today | tscaps equivalent / plan |
| --- | --- |
| Project document (Mongo) with `words[]` | Studio project (IndexedDB) holding an engine `Document` + template/sheet state. Our backend keeps the Canonical Transcript per job; project sync later (Phase 8). |
| `word.text` (Roman) / `word.original` (native) | `Word.text` = chosen display script; `Word.displayText` same; `Word.metadata = {native, roman, translation?, confidence, uncertain, provider}`; switching script = rebuild display from metadata. |
| `emphasis`: key / feature / support | Semantic tags: key → `peak` (or `emphasis`), feature → `accent`; support → no tag. Plus `hook`, `entity`, `number`, `cta` from the tagger. |
| `uncertain` | Custom tag `uncertain` styled only in the editor (excluded from export CSS) + transcript UI highlight. |
| `new_caption` / `new_line` manual overrides | Studio structure edits (split at cursor, merge with sibling, redistribute words). |
| Grouping heuristics (`_group_words_for_display`) | Engine segment splitters + our boundary scores. |
| Street Glow (two-line red/white) | New template: `.line.first-line-in-segment` = condensed red glow, `.line.last-line-in-segment` = italic white; entrance via `--on-segment-starts`; per-line glide via `--on-line-being-narrated-starts`. |
| Doodle Marker (pill/loop) | New template: `.word.peak` → highlighter pill (clip-path wipe keyed to `--on-word-being-narrated-starts`), `.word.accent` → SVG-filter/pseudo-element loop. |
| Outline/Shadow/Glow/Background controls | Template controls + CSS (`text-stroke` with `paint-order`, `text-shadow`, `filter`). Blur now identical in preview/export. |
| Stickers / text layers | Studio elements + decorations (emoji per word). |
| SFX markers | **Gap**: add an audio-mix stage to the export (MediaBunny audio track + generated SFX buffers) or post-process server-side with FFmpeg — Phase 7. |
| Volume / colour grade | Gap (studio export copies audio; grading not present) — low priority; can be CSS filter on a video layer or FFmpeg post-pass. |
| Re-listen | Re-run the transcriber for the project (same provider or another). |
| AI filler removal | Studio "remove bad takes" + cuts; add a `cut` tagger from the backend for fillers in Hindi/Indic. |
| SRT export | Studio subtitle export (SRT/VTT/ASS/SBV/TTML/TXT). |
| Auth, usage, paywall | Our backend; studio gets a login screen (start flow) and a usage badge. |

---

## 9. What we keep, what we retire

**Keep (and refactor into the Speech Service):** `auth.py`, usage/credits,
`caption_ai.py` (split into `providers/sarvam.py`, `providers/openai_whisper.py`,
`pipeline/chunking.py`, `pipeline/alignment.py`, `pipeline/safety.py`,
`script/hinglish.py`, `tagging/llm.py`), storage, payments scaffolding, the
test corpus and verification recipes.

**Retire after parity (Phase 4 exit):** `frontend/` (CRA editor), the ASS
writer and libass render path (`_write_ass`, `_render`, blur masks, Doodle
vector decorations), the duplicated grouping/line-break JS. Keep them on a
`legacy` branch and behind a feature flag until the studio path is proven on
the owner's real videos.

---

## 10. Phase-wise implementation plan

Estimates assume one developer working with an AI coding agent, part-time
evenings/weekends; "days" are focused working days. Each phase ends with an
exit check the owner can see.

### Phase 0 — Groundwork and spike (3–5 days)
**Goal:** prove tscaps renders our Hinglish/Hindi captions well on the owner's
PC, before committing to the path.
1. Housekeeping: revoke the GitHub token pasted in chat; commit the
   2026-10-27 Tadaaam work; tag `pre-tscaps`.
2. Toolchain on Windows: Node 20+, pnpm (corepack), `git config --global
   core.longpaths true` (the clone hit Windows path-length errors).
3. Fork `francozanardi/tscaps` → `yadavderkeval1995-ops/tadaaam-studio`
   (separate repo; AGPL isolated). Pin upstream commit; add `upstream` remote.
4. Run the studio locally (`pnpm install`, `pnpm --filter ./apps/studio dev`);
   run its unit tests and template contract check.
5. **Spike A (render fidelity):** export a Tadaaam project's words
   (`toe-protector-source.mp4`, 148 words) to a tiny script that builds an
   engine `Document` and loads it via `PassthroughTranscriber`; render in Roman
   Hinglish and in Devanagari with 3 templates; export MP4 in Chrome.
   Check: Devanagari shaping in `<foreignObject>`, font loading, timing, export
   speed for 38 s and 120 s clips at 1080×1920.
6. **Spike B (transcriber hook):** a throwaway `ConfigurableTranscriber` that
   POSTs audio to today's backend (Sarvam-only path) and returns a Document.
7. Decision record D-039 updated with findings; owner go/no-go.

**Exit:** two MP4s (Roman, Devanagari) rendered by the tscaps engine from our
transcript, reviewed by the owner; export time measured.

### Phase 1 — Speech Service v2: provider abstraction (6–9 days)
1. Canonical Transcript schema (Appendix A) + Pydantic models + JSON schema file
   shared with the studio (generate TS types).
2. `SpeechProvider` protocol, capabilities, error taxonomy, `ProviderRegistry`,
   routing table file, request overrides.
3. Port providers: `SarvamProvider` (phrase timestamps, keyterms, code-mix,
   22 languages), `OpenAIWhisperProvider` (word timestamps), `HybridProvider`
   (Sarvam text × Whisper timing, today's alignment code).
4. Pipeline modules extracted from `caption_ai.py` (chunking sized by
   `max_request_seconds`, safety rails, timing normalization, proportional
   spread). Behaviour identical to today for Hindi.
5. Endpoints: `POST /api/v2/transcriptions` (multipart audio, `language`,
   `code_mix`, `provider?`, `output_script`, `tagging`), returns `202 {job_id}`;
   `GET /api/v2/transcriptions/{id}` (status/progress/result);
   `GET /api/v2/providers`; `GET /api/v2/languages`.
6. Provider contract tests; corpus evaluation script (WER/CER per provider ×
   language; romanization accuracy) — first 3 reference transcripts hand-corrected.
7. Keep v1 endpoints working for the old frontend.

**Exit:** `curl` an audio file → Canonical Transcript for Sarvam, Whisper,
Hybrid; contract tests green; WER table for the corpus.

**As built (2026-10-29):** `backend/speech/` package —
`types.py` (protocol + capabilities, with a `role` of `text` / `timing` /
`text+timing`; Whisper is `timing` and the router never sends text work to
it), `errors.py`, `registry.py` + `routing.json`, `pipeline.py`,
`audio.py`/`quality.py`/`timing.py`/`alignment.py`/`romanize.py` (moved
verbatim from `caption_ai.py`), `providers/{sarvam,openai_whisper,hybrid}.py`,
`canonical.py` (schema `tadaaam.transcript/v1`, exported to
`schemas/tadaaam.transcript.v1.schema.json`), `languages.py`, `api.py`
(v2 endpoints). `caption_ai.transcribe_words` now delegates to the pipeline
(v1 engine `sarvam` → provider `sarvam`, `whisper` → `hybrid`). Tests:
`backend/speech/tests` (offline, fake provider) + network bad-key contract
tests behind `TADAAAM_NETWORK_TESTS=1`. Evaluation: `backend/scripts/eval_wer.py`
with `backend/eval/`. TS types are deferred to Phase 2 (generated from the
JSON Schema when the studio exists).

### Phase 2 — Studio integration (8–12 days)
1. `TadaaamTranscriber implements ConfigurableTranscriber`: extract audio
   in the browser (studio's audio decoder) → encode WAV/Opus → upload → poll →
   build `Document` (sections/segments/lines/words with metadata, tags,
   boundaryScore, language). Progress mapped to `loading`/`inferring`;
   untranscribed regions reported.
2. Wire through `createEditorApp({ transcriber })` in our app entry.
3. Start flow: language picker (auto + list with endonyms), code-mix toggle,
   output script (Roman / native / both), provider picker (from
   `/providers`, "Auto (recommended)" default), with "browser Whisper
   (offline)" kept as an option.
4. Auth: login screen (email/password + Google) against our backend; bearer
   token in memory/secure cookie; CORS restricted to the studio origin.
5. Usage badge and paywall hooks (credits now; minutes later).
6. Errors: map `ProviderAuthError` etc. into the studio's `AppNoticeChannel`
   with actionable text.
7. Tag mapping: emphasis → `peak`/`accent`; `uncertain` editor-only tag;
   transcript panel shows native/roman toggle.
8. Branding: name, colours, logo; remove tscaps.io references per AGPL/
   trademark courtesy (keep license notices and attribution).
9. Deploy the studio as a static site on Vercel (same model as today), backend local.

**Exit:** owner uploads a real reel in Tadaaam Studio, picks Hindi +
Roman + Sarvam, edits, exports — no step touches the old frontend.

### Phase 3 — Indian languages and scripts (6–10 days)
1. Language catalog service (Appendix C) with providers and output scripts.
2. Fonts: add Noto Sans Gujarati, Gurmukhi, Kannada, Malayalam, Oriya (+
   Devanagari display faces we already bundle); register in font catalogs;
   coverage script passes for every offered language.
3. Template rules for non-Latin scripts (no letter-spacing on Indic, grapheme
   letter splitting, line-height floors); contract check enforces them.
4. Transliteration for Marathi, Gujarati, Punjabi, Bengali, Tamil, Telugu,
   Kannada, Malayalam (dictionary + provider translit + rules); "both scripts" output.
5. Boundary scores v1 (rules: pauses, punctuation, Hindi/Indic function-word
   attachment) → studio uses `BoundaryScoreLimitByCharsSegmentSplitter`.
6. Per-script char scale factors for segment budgets.
7. Test clips: collect 30–60 s samples for Hindi, Hinglish, Marathi, Tamil,
   Telugu, Bengali, Gujarati, Punjabi, Urdu, English (Indian accent) + one
   non-Indic (e.g. Spanish); reference transcripts for each.

**Exit:** every language in the catalog renders in at least two templates
without tofu, broken conjuncts, or clipped matras; WER table per language.

### Phase 4 — Tadaaam templates (5–8 days)
*Today there are exactly two templates (Street Glow, Doodle Marker). This
phase ports those two first; new templates are added afterwards, one at a
time, each with its golden tests.*
1. Rebuild **Street Glow v2** and **Doodle Marker v2** on the tscaps template
   contract (JSON + SCSS), Indic-safe.
2. Curate an **India-first gallery** of 6–10 templates (owner's taste: the
   owner does not love tscaps' defaults) — designs reviewed as rendered clips.
3. Hide/remove upstream templates we do not want (keep MIT notices).
4. Golden-frame tests: for each template × {Roman Hinglish, Devanagari, long
   English word, 1/3/6-word segments}, export frames at fixed timestamps and
   compare against approved PNGs (Playwright + pixel/box diff).
5. Retire the old CRA editor and libass path (legacy branch + flag).

**Exit:** owner approves the gallery; golden tests green; old editor retired.

### Phase 5 — AI tagging and styling (5–7 days)
1. Backend tagger: LLM (provider-swappable too: OpenAI, Gemini, Claude, Sarvam-M)
   returns per-word tags from the tscaps vocabulary (`emphasis`, `peak`,
   `hook`, `entity`, `number`, `cta`, `superlative`, `stat`, `cut` for fillers)
   for any language; strict index-based JSON as today.
2. Offline heuristic tagger (numbers, English nouns in Hinglish, brand
   wordlists, sentence-final verbs) so templates still decorate without an LLM.
3. LLM phrase chunking → boundary scores v2.
4. Optional: translation output script (English subtitles for Indic speech).

**Exit:** tags appear automatically in Hindi and at least two other Indian
languages; templates style them; works (reduced) with no LLM key.

### Phase 6 — Accuracy and timing upgrades (6–10 days)
1. Forced aligner service (MMS / IndicWav2Vec / WhisperX) as an `Aligner`;
   Sarvam phrase timestamps → true word times.
2. More providers: ElevenLabs Scribe, Deepgram Nova-3, OpenAI
   gpt-4o-(mini-)transcribe, AssemblyAI, Google Chirp, local faster-whisper (GPU optional).
3. Fallback chains + retries; per-provider cost metering into the usage ledger.
4. Glossary per user (brand names) → keyterms/prompt for providers that accept them.
5. Re-run the evaluation; set routing defaults per language from data.

**Exit:** word-timing error (vs hand-labelled subset) under an agreed
threshold for Sarvam+aligner; routing table justified by the WER/cost table.

### Phase 7 — Server rendering and audio extras (5–8 days)
1. Render worker: headless Chromium (Playwright) running the engine (pattern
   from `examples/cli`) — `POST /api/v2/renders` with project JSON + video →
   MP4; queue + progress.
2. Use it for: mobile users, batch/automation, and long videos.
3. Audio stage: SFX markers and volume boost mixed into the export (client
   MediaBunny audio mixing, or FFmpeg post-pass on the server render).

**Exit:** the same project renders identically in the browser and in the
worker (golden frames match); SFX audible in exports.

### Phase 8 — Product layer (ongoing)
1. Project sync (IndexedDB ↔ backend) and project history across devices.
2. Minute-based usage ledger, plans as data, Razorpay checkout, watermark on Free.
3. Hosting: studio static (Vercel/Cloudflare Pages); backend container
   (Render/Railway/Fly/VPS) + MongoDB Atlas + S3/R2; queue for jobs.
4. **AGPL compliance** if the studio is offered to others: publish the fork's
   source (link in the app footer), keep notices; or execute the Option-A
   migration (engine-only UI) before launch.
5. Privacy: audio retention policy, deletion endpoint, provider data terms.

### Timeline sketch

| Phase | Effort (days) | Cumulative |
| --- | --- | --- |
| 0 Spike | 3–5 | ~1 week |
| 1 Speech Service v2 | 6–9 | ~3 weeks |
| 2 Studio integration | 8–12 | ~5–6 weeks |
| 3 Indic languages | 6–10 | ~8 weeks |
| 4 Templates | 5–8 | ~10 weeks |
| 5 Tagging | 5–7 | ~11–12 weeks |
| 6 Accuracy | 6–10 | ~14 weeks |
| 7 Server render/audio | 5–8 | ~16 weeks |
| 8 Product | ongoing | — |

Phases 3–5 can overlap once Phase 2 is done.

---

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| AGPL obligations on the studio fork | Must publish source when serving others | Option C; thin adapters; decide at the commercial gate |
| Upstream churn (pre-1.0, "sync from internal" dumps) | Merge conflicts, API breaks | Pin a commit; adapters only; upgrade deliberately with a checklist; contribute generic fixes upstream (e.g. Indic fonts) |
| Browser export depends on WebCodecs + `<foreignObject>` (Chromium best) | Firefox/Safari quirks; slower phones | Recommend Chrome/Edge; server render worker (Phase 7) as fallback |
| Indic shaping inside `<foreignObject>` | Broken conjuncts in export | Phase 0 spike; golden tests per script |
| Export speed on the owner's PC | Long waits for 120 s 1080p | Measure in Phase 0; draft/fast presets; server worker |
| Sarvam phrase timing is approximate | Word reveal off by a few hundred ms | Forced aligner (Phase 6); hybrid provider meanwhile |
| Provider outages/keys (today's OpenAI 401) | Failed jobs | Registry hides unavailable providers; fallback chains; named errors |
| Two codebases (studio TS + backend Py) | More to maintain | Shared JSON schema + generated types; contract tests |
| Windows toolchain (long paths, pnpm) | Setup friction | `core.longpaths`, corepack, documented setup |
| Owner dislikes upstream templates | Product feel | Phase 4 custom gallery; hide upstream ones |
| Privacy (audio sent to providers) | Trust/regulatory | Send audio only; retention policy; local providers option |

---

## 12. Decisions needed from the owner

1. **Integration option:** C (fork studio now, decide AGPL vs engine-only at
   launch) — recommended — or A (engine-only from the start), or B (fork and
   plan to open-source the studio).
2. **Repo layout:** separate `tadaaam-studio` repo (recommended for AGPL
   isolation) vs monorepo.
3. **Default output script** per language: Roman for Hindi (Hinglish); native
   for Tamil/Telugu/Bengali…? Or Roman everywhere by default?
4. **Provider order:** Sarvam default for Indic + which default for non-Indic
   (gpt-4o-transcribe vs ElevenLabs Scribe vs Deepgram) — to be settled by the
   Phase 1/6 WER + cost table.
5. **Keep in-browser Whisper** as an offline option? (Recommended: yes, it is free.)
6. **Old editor retirement date** (end of Phase 4 recommended).
7. **Budget** for provider trials (≈ ₹2,000–5,000 of API credit covers the
   evaluation corpus across providers).

---

## 13. Appendices

### Appendix A — Canonical Transcript JSON (v1)

```json
{
  "schema": "tadaaam.transcript/v1",
  "job_id": "tx_8f2c…",
  "audio": { "duration": 37.78, "sample_rate": 16000 },
  "language": { "requested": "auto", "detected": "hi", "code_mix": ["hi", "en"] },
  "provider": { "id": "sarvam", "model": "saaras:v4", "timing": "phrase+spread",
                "fallbacks_used": [] },
  "output_script": "roman",
  "words": [
    {
      "i": 0,
      "start": 1.79, "end": 2.09,
      "native": "जिसके", "roman": "jiske", "display": "jiske",
      "lang": "hi", "script": "Deva",
      "confidence": 0.91, "timing_confidence": "estimated",
      "uncertain": false,
      "tags": ["emphasis"],
      "boundary_score": 0.05,
      "speaker": null,
      "punct_after": ""
    }
  ],
  "phrases": [ { "start": 0.06, "end": 6.54, "word_range": [0, 26] } ],
  "untranscribed_regions": [],
  "diagnostics": { "chunks": 2, "unique_ratio": 0.615, "bigram_ratio": 0.027,
                   "ngram_repeat": 1, "cost_inr": 0.31 }
}
```
Client mapping: one `Section(kind="default")`, one provisional `Segment` per
phrase (the engine re-splits), `Word{text: display, displayText: display,
time, semanticTags: tags, boundaryScore, speakerId, metadata: {native, roman,
confidence, uncertain, lang}}`, `Document.language = detected`.

### Appendix B — Provider capability matrix (initial; verify in Phase 1/6)

| Provider | Languages | Code-mix | Timestamps | Max req | Keyterms | ≈ ₹/min | Local |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sarvam saaras:v4 | 22 Indian codes incl. en-IN (SDK enum) | Yes (codemix) | phrase | 30 s | Yes | 0.49 | No |
| OpenAI whisper-1 | ~99 | Partial | word | 25 MB file | prompt | 0.53 | No |
| OpenAI gpt-4o-transcribe / mini | ~99 | Partial | none/segment (verify) | file | prompt | 0.53 / 0.26 | No |
| ElevenLabs Scribe v2 | ~99 incl. Indic | Verify | word (verify for batch) | long | Verify | ≈ 0.32 | No |
| Deepgram Nova-3 multilingual | 45+ (verify hi) | Yes | word | long | Yes | ≈ 0.46 | No |
| AssemblyAI Universal | many (verify hi) | Verify | word | long | Yes | ≈ 0.22–0.31 | No |
| Google Chirp | 100+ incl. Indic | Verify | word | long | Yes | Verify | No |
| faster-whisper large-v3 | ~99 | Partial | word | — | prompt | 0 | Yes |
| Browser Whisper (tscaps) | ~99 | Partial | word | — | — | 0 | Yes (client) |
| MMS forced aligner | 1,100+ | n/a | aligns given text | — | — | 0 | Yes |

### Appendix C — Language table (first wave)

| Language | Code | Script | Fonts in tscaps today | Default provider | Default output |
| --- | --- | --- | --- | --- | --- |
| Hindi / Hinglish | hi (+en) | Devanagari | Yes (Poppins, Kalam) | Sarvam | Roman (Hinglish) |
| Marathi | mr | Devanagari | Yes | Sarvam | Owner to decide |
| Bengali | bn | Bengali | Yes (Noto) | Sarvam | Owner to decide |
| Tamil | ta | Tamil | Yes (Noto) | Sarvam | Owner to decide |
| Telugu | te | Telugu | Yes (Noto) | Sarvam | Owner to decide |
| Gujarati | gu | Gujarati | **No — add** | Sarvam | Owner to decide |
| Punjabi | pa | Gurmukhi | **No — add** | Sarvam | Owner to decide |
| Kannada | kn | Kannada | **No — add** | Sarvam | Owner to decide |
| Malayalam | ml | Malayalam | **No — add** | Sarvam | Owner to decide |
| Odia | or/od | Odia | **No — add** | Sarvam | Owner to decide |
| Urdu | ur | Arabic (RTL) | Yes | Sarvam / Whisper | Native or Roman Urdu |
| English (India) | en | Latin | Yes | Sarvam en-IN or Whisper | Native |
| Other (es, ar, fr, …) | * | various | mostly yes | routing table | Native |

### Appendix D — Phase checklists (copy into TRACKER as you start each phase)

**Phase 0**
- [ ] Revoke leaked GitHub token
- [ ] Commit current work; tag `pre-tscaps`
- [ ] Node 20 + pnpm + `core.longpaths`
- [ ] Fork to `tadaaam-studio`; pin upstream commit
- [ ] Studio runs locally; unit tests + template contract pass
- [ ] Spike A: Passthrough Document render (Roman + Devanagari), export timings recorded
- [ ] Spike B: throwaway remote transcriber against current backend
- [ ] Owner go/no-go recorded in DECISIONS (D-039)

**Phase 1**
- [x] Canonical Transcript schema (Pydantic + JSON Schema) — TS types deferred to Phase 2
- [x] Provider protocol, registry, routing file, error taxonomy
- [x] Sarvam, Whisper (timing), Hybrid providers ported; parity on toe-protector clip (148 words, identical metrics)
- [x] v2 endpoints (jobs, providers, languages) — verified over HTTP
- [x] Contract tests (25 offline + 6 network); WER script
- [ ] 3 reference transcripts hand-corrected by the owner (drafts in `backend/eval/references/*.draft.txt`)
- [ ] WER table for the corpus (needs the references; hybrid needs a valid OpenAI key)

**Phase 2**
- [ ] `TadaaamTranscriber`; audio extraction + upload; progress
- [ ] Start flow: language, code-mix, output script, provider
- [ ] Auth + usage in studio; CORS tightened
- [ ] Tag mapping; uncertain tag; script toggle
- [ ] Branding; deploy studio to Vercel

**Phase 3**
- [ ] Language catalog endpoint
- [ ] Fonts: Gujarati, Gurmukhi, Kannada, Malayalam, Odia; coverage script
- [ ] Template Indic rules + contract enforcement
- [ ] Transliteration for 8 Indic languages; "both scripts"
- [ ] Boundary scores v1; per-script char scales
- [ ] Multilingual corpus + references

**Phase 4**
- [ ] Street Glow v2, Doodle Marker v2
- [ ] India-first gallery (6–10), owner-approved
- [ ] Golden-frame tests
- [ ] Old editor + libass path retired behind flag

**Phase 5–8:** see §10.
