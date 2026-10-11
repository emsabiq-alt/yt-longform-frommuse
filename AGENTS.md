# YT Longform Studio — Agent Instructions

## Project Overview

Studio otomasi video panjang (longform 16:9) edukasi Bahasa Indonesia.
Pipeline: **Topic AI → Script → Image/B-roll → TTS → FFmpeg Render → SFTP Upload → YouTube Publish**.

- **Language**: JavaScript (ESM, Node.js 20+), Python (desktop app)
- **Package manager**: npm
- **Test runner**: `node --test` (built-in)
- **Deployment**: Vercel (dashboard API) + GitHub Actions (pipeline)
- **Local dev**: `npm run dev` → `http://localhost:3050`

## Knowledge Graph

Proyek ini dilengkapi **Graphify knowledge graph** di `graphify-out/`.

- Sebelum grepping codebase atau menjawab pertanyaan arsitektur, **konsultasi `graphify-out/GRAPH_REPORT.md`** terlebih dahulu.
- Gunakan `graphify query "pertanyaan"` untuk lookup struktur spesifik.
- Top architectural hubs (god nodes):
  1. `YTStudioApp` (app/yt_studio.py) — 61 edges
  2. `renderLongformVideo()` (src/longform-render.js) — 34 edges
  3. `createLongformDraft()` (src/longform-story-engine.js) — 22 edges
  4. `pickFreshTopic()` (src/topic-engine.js) — 19 edges
  5. `config` (src/config.js) — 18 edges

## Architecture Quick Map

```
src/                 ← Node.js core modules (ESM)
├── server.js        ← Express dev server + SSE run-local
├── run-once.js      ← CLI entrypoint: generate → upload → publish
├── pipeline.js      ← orchestrator: script → media → audio → render
├── longform-story-engine.js ← AI script generation (OpenAI)
├── topic-engine.js  ← anti-duplicate topic picker
├── continuity-engine.js ← long-term memory freshness check
├── format-engine.js ← format types (listicle, deep-dive, etc.)
├── viral-angle-library.js ← viral angle selection
├── title-engine.js  ← viral title generation
├── story-language.js ← lay-audience polish
├── longform-render.js ← FFmpeg render assembly (1521 lines)
├── openai.js        ← OpenAI API wrapper (chat→story config, image, TTS, whisper)
├── flow-image.js    ← FROMMUSE: Google Flow image via Chrome CDP (IMAGE_PROVIDER=flow)
├── groq.js          ← FROMMUSE: Groq TTS OpenAI-compatible (YT_TTS_PROVIDER=groq)
├── elevenlabs.js    ← ElevenLabs TTS wrapper
├── pexels.js        ← Pexels B-roll video search
├── wikipedia.js     ← Wikipedia fact grounding
├── thumbnail.js     ← AI thumbnail generation
├── youtube-publisher.js ← YouTube upload (resumable)
├── youtube-playlist.js  ← auto-playlist by category
├── youtube-trends.js    ← trending topic discovery
├── youtube-meta.js  ← title/description builder
├── remote.js        ← SFTP/FTP upload adapter
├── storage.js       ← JSON file storage (items + memory)
├── config.js        ← env-based configuration
├── cost.js          ← cost estimator
├── progress.js      ← stdout progress markers
├── util.js          ← shared utilities
├── preflight.js     ← system check (ffmpeg, keys, remote)
├── rerender.js      ← re-render existing item
├── upload-only.js   ← upload-only mode
└── sftp-cleanup.js  ← remote media cleanup

api/                 ← Vercel serverless functions
├── _utils.js        ← shared auth, SFTP, state reader
├── auth.js          ← PIN-based auth with session cookie
├── state.js         ← dashboard state (items + workflow runs)
├── run.js           ← trigger GitHub Actions workflow
├── queue.js         ← queue management
└── preflight.js     ← remote diagnostics

app/                 ← Python desktop app (CustomTkinter)
└── yt_studio.py     ← GUI: generate, monitor, upload

public/              ← Vercel dashboard (static)
├── index.html
├── app.js
└── styles.css

docs/                ← Project documentation
├── PRD.md           ← Product Requirements Document
└── PROJECT_SEQUENCE_AND_MEMORY.md ← Sequence diagrams + memory notes
```

## Code Conventions

1. **ESM only** — semua file Node menggunakan `import`/`export`, `"type": "module"` di package.json.
2. **Bahasa Indonesia** untuk log, UI text, progress messages, dan comments.
3. **Progress markers** — `@@PROGRESS{...}@@` dan `@@LOCAL_OUTPUT{...}@@` di stdout, diparsing oleh `app/yt_studio.py` dan `src/server.js` SSE. **Jangan ubah format tanpa koordinasi.**
4. **No external test framework** — menggunakan `node:test` built-in.
5. **Config via env** — semua config dari `.env`, diparse di `src/config.js`. Gunakan `.env.example` sebagai referensi.
6. **JSON storage** — `data/items.json` (aktif) dan `data/memory.json` (compact long-term). Bisa sangat besar, jangan dibuka kecuali memang perlu.
7. **Render gate** — `assertReadyToRender()` di `pipeline.js` adalah gerbang sebelum render. Perubahan media generation harus update `test/pipeline.test.js`.

## Files to Avoid Opening

- `.env` — berisi secrets, gunakan `.env.example` sebagai referensi
- `data/items.json` — runtime state, bisa sangat besar
- `data/memory.json` — compact memory, bisa 2000+ entries
- `node_modules/` — dependencies
- `generated/` — output assets (video, audio, images)

## Key Invariants

1. Setiap scene non-reaction harus punya ≥1 media (klip video ATAU gambar) per visual segment sebelum render.
2. ≥1 scene audio entry harus ada sebelum render.
3. `data/memory.json` compact max 2000 entries.
4. Wikipedia grounding menambah atribusi CC BY-SA di deskripsi YouTube.
5. Pexels selection: scene konkret → video, scene abstrak → gambar DALL-E.
6. YouTube publish = resumable upload + optional thumbnail + optional playlist.
7. SFTP cleanup tidak menyentuh `state/` dan `thumbnails/`.

## Running the Project

```bash
npm install                    # install dependencies
cp .env.example .env           # fill in credentials
npm run preflight              # check ffmpeg, API keys, remote
npm run dev                    # start local server at :3050
npm run run:once               # generate one video end-to-end
npm run rerender -- --id=<id>  # re-render existing item
npm test                       # run all tests
npm run check                  # syntax check all modules
```

## Refreshing the Knowledge Graph

```bash
graphify extract . --code-only --no-cluster
graphify tree
graphify god-nodes
```
