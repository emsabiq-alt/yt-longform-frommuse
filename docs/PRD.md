# YT Longform Studio — Product Requirements Document (PRD)

> **Last Updated**: 2026-07-27  
> **Repository**: [emsabiq-alt/yt-longform](https://github.com/emsabiq-alt/yt-longform)  
> **Version**: 0.1.0  
> **Status**: Active Development

---

## 1. Vision & Objectives

### 1.1 Vision
Studio otomasi end-to-end untuk menghasilkan video YouTube panjang (longform, 16:9) edukasi Bahasa Indonesia. Dari ide topik sampai video ter-publish di YouTube — sepenuhnya otomatis, hanya perlu satu perintah.

### 1.2 Objectives
1. **Otomasi Penuh** — Satu perintah (`npm run run:once`) menghasilkan video 6–15 menit yang siap upload.
2. **Kualitas Profesional** — Naskah AI yang faktual (Wikipedia-grounded), TTS natural, B-roll video + gambar, subtitle sinkron, thumbnail menarik.
3. **Anti-Repetisi** — Continuity memory (2000+ entri) memastikan topik dan sudut pandang selalu segar.
4. **Multi-Platform Control** — Bisa dijalankan dari GitHub Actions (cloud), desktop app (lokal), atau dashboard web (Vercel).
5. **Cost-Efficient** — Estimasi biaya per video transparan; default model murah (gpt-4.1-mini, gpt-image-1-mini).

### 1.3 Value Proposition
- **Untuk kreator**: Menghasilkan konten edukasi berkualitas tanpa crew, studio, atau keahlian editing video.
- **Untuk channel**: Konsistensi upload harian/mingguan otomatis dengan topik yang selalu unik.

---

## 2. User Personas

### 2.1 Operator Studio (Primary)
- **Siapa**: Developer/content manager yang mengelola channel YouTube edukasi.
- **Tujuan**: Menjadwalkan dan memonitor produksi video otomatis.
- **Workflow**: Konfigurasi `.env` → preflight check → jalankan pipeline → monitor progress → review video → publish.
- **Akses**: Dashboard web (Vercel), desktop app (Python), CLI (`npm run`).

### 2.2 Penonton YouTube (End User)
- **Siapa**: Penonton Indonesia yang mencari konten edukasi menarik.
- **Ekspektasi**: Video 6–15 menit dengan narasi jelas, visual menarik, subtitle akurat, fakta terpercaya.

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTROL SURFACES                         │
├───────────────┬──────────────────┬──────────────────────────┤
│  Vercel       │  Desktop App     │  CLI                     │
│  Dashboard    │  (Python/        │  (npm run                │
│  (public/)    │   CustomTkinter) │   run:once)              │
│  api/*.js     │  app/yt_studio.py│  src/run-once.js         │
├───────────────┴──────────────────┴──────────────────────────┤
│                                                             │
│                   PIPELINE CORE (Node.js ESM)               │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Topic    │→ │ Story    │→ │ Media     │→ │ Render    │  │
│  │ Engine   │  │ Engine   │  │ Pipeline  │  │ (FFmpeg)  │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────┘  │
│       ↕              ↕             ↕              ↕         │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │Continuity│  │Wikipedia │  │ Pexels    │  │ Subtitle  │  │
│  │ Memory   │  │Grounding │  │ B-roll    │  │ (Whisper) │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                   DISTRIBUTION                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐                 │
│  │ SFTP/FTP │  │ YouTube  │  │ GitHub    │                 │
│  │ Upload   │  │ Publish  │  │ Actions   │                 │
│  └──────────┘  └──────────┘  └───────────┘                 │
├─────────────────────────────────────────────────────────────┤
│                   DATA LAYER                                │
│  data/items.json    data/memory.json    generated/*          │
│  (active items)     (compact 2000 max)  (media assets)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Functional Requirements

### 4.1 Topic Selection (src/topic-engine.js)

| ID | Requirement | Status |
|----|-------------|--------|
| T-01 | Auto-pick topik segar jika input kosong | ✅ Done |
| T-02 | 24 kategori edukasi (sains, sejarah, teknologi, dll) | ✅ Done |
| T-03 | 6–10 sudut pandang per kategori | ✅ Done |
| T-04 | Anti-duplikat via continuity memory | ✅ Done |
| T-05 | YouTube Trending integration (Data API v3) | ✅ Done |
| T-06 | Format type selection (listicle, deep-dive, dll) | ✅ Done |
| T-07 | Viral angle selection (10+ pattern) | ✅ Done |

### 4.2 Script Generation (src/longform-story-engine.js)

| ID | Requirement | Status |
|----|-------------|--------|
| S-01 | Naskah AI via OpenAI (gpt-4.1-mini default) | ✅ Done |
| S-02 | Wikipedia fact grounding (gratis, CC BY-SA) | ✅ Done |
| S-03 | Per-scene storyboard (narration, imagePrompt, visualKeywords, visualSegments) | ✅ Done |
| S-04 | Cold open hook (kalimat pembuka punchy) | ✅ Done |
| S-05 | Lay-audience language polish (simplify jargon) | ✅ Done |
| S-06 | Viral title generation | ✅ Done |
| S-07 | Reaction scene support | ✅ Done |
| S-08 | Duration target: 300–900 detik (default 360) | ✅ Done |
| S-09 | Scene count: 8–20 (default 14) | ✅ Done |
| S-10 | Category-specific story notes | ✅ Done |
| S-11 | 10 story variation patterns | ✅ Done |

### 4.3 Media Pipeline (src/pipeline.js, src/pexels.js, src/openai.js)

| ID | Requirement | Status |
|----|-------------|--------|
| M-01 | Pexels B-roll video search (semantic selection) | ✅ Done |
| M-02 | DALL-E image generation (fallback) | ✅ Done |
| M-03 | Multi-segment visual per scene (2–3 gambar/klip) | ✅ Done |
| M-04 | Semantic vs alternating scene selection | ✅ Done |
| M-05 | Rate limiting (200ms antar request Pexels) | ✅ Done |
| M-06 | Image retry with safe prompt fallback | ✅ Done |

### 4.4 TTS & Subtitle (src/pipeline.js, src/openai.js, src/elevenlabs.js)

| ID | Requirement | Status |
|----|-------------|--------|
| A-01 | Per-scene TTS (OpenAI gpt-4o-mini-tts / ElevenLabs) | ✅ Done |
| A-02 | ElevenLabs → OpenAI fallback otomatis | ✅ Done |
| A-03 | Whisper transcription per scene audio | ✅ Done |
| A-04 | Caption alignment ke source text | ✅ Done |
| A-05 | Cold open hook TTS terpisah | ✅ Done |
| A-06 | Bahasa Indonesia TTS instructions (energik, dinamis) | ✅ Done |

### 4.5 Video Render (src/longform-render.js)

| ID | Requirement | Status |
|----|-------------|--------|
| R-01 | FFmpeg render assembly (30fps, 720p/1080p) | ✅ Done |
| R-02 | Ken Burns zoom effect pada gambar statis | ✅ Done |
| R-03 | Pexels overlay (fire sparks, chromakey) | ✅ Done |
| R-04 | ASS subtitle burn | ✅ Done |
| R-05 | Logo watermark | ✅ Done |
| R-06 | Background music (volume 0.07) | ✅ Done |
| R-07 | Bumper intro/outro per kategori | ✅ Done |
| R-08 | Cold open visual + audio mux | ✅ Done |
| R-09 | Reaction segment assembly | ✅ Done |
| R-10 | Speech tempo adjustment (0.9–1.3x) | ✅ Done |
| R-11 | Scene audio timing sync | ✅ Done |

### 4.6 Thumbnail (src/thumbnail.js)

| ID | Requirement | Status |
|----|-------------|--------|
| TH-01 | AI thumbnail generation (DALL-E) | ✅ Done |
| TH-02 | Cinematic / vector style | ✅ Done |
| TH-03 | Toggle enable/disable | ✅ Done |

### 4.7 Upload & Publish

| ID | Requirement | Status |
|----|-------------|--------|
| U-01 | SFTP/FTP upload (video, thumbnail, images, state) | ✅ Done |
| U-02 | FTP adapter + SFTP adapter (ssh2-sftp-client) | ✅ Done |
| U-03 | Retry upload (3 attempts, exponential backoff) | ✅ Done |
| U-04 | YouTube resumable upload | ✅ Done |
| U-05 | YouTube custom thumbnail upload | ✅ Done |
| U-06 | Auto-playlist by category | ✅ Done |
| U-07 | Daily upload limit (default 2/hari) | ✅ Done |
| U-08 | State sync setelah publish | ✅ Done |

### 4.8 Dashboard & Control

| ID | Requirement | Status |
|----|-------------|--------|
| D-01 | Vercel dashboard (PIN auth, session cookie) | ✅ Done |
| D-02 | Generate via GitHub Actions dispatch | ✅ Done |
| D-03 | Queue management (add, run, delete) | ✅ Done |
| D-04 | Real-time workflow status monitoring | ✅ Done |
| D-05 | Preflight diagnostics | ✅ Done |
| D-06 | Local dev server (Express, SSE progress) | ✅ Done |
| D-07 | Desktop app (Python CustomTkinter) | ✅ Done |
| D-08 | Desktop app: setup wizard (auto-install Node/FFmpeg) | ✅ Done |
| D-09 | Runtime settings update via API | ✅ Done |

### 4.9 Continuity & Memory

| ID | Requirement | Status |
|----|-------------|--------|
| C-01 | Compact memory (2000 max entries) | ✅ Done |
| C-02 | Remote memory sync (SFTP ↔ local) | ✅ Done |
| C-03 | Anti-duplikat: topik, sudut pandang, viral angle | ✅ Done |
| C-04 | History load (80 entries for freshness check) | ✅ Done |

---

## 5. Data Model

### 5.1 Item Schema (data/items.json)

```json
{
  "id": "yt-20260727-abc123",
  "title": "Mengapa Langit Biru?",
  "status": "rendered | published",
  "createdAt": "2026-07-27T10:00:00Z",
  "updatedAt": "2026-07-27T10:30:00Z",
  "input": {
    "topic": "hamburan rayleigh",
    "category": "sains",
    "formatType": "deep-dive",
    "viralAngleId": "hidden-mechanism",
    "viralAngleLabel": "Mekanisme Tersembunyi",
    "ttsProvider": "openai",
    "ttsVoice": "cedar",
    "imageQuality": "low",
    "imageSize": "1536x1024",
    "durationSec": 360,
    "sceneCount": 14,
    "resolution": "720p"
  },
  "plan": {
    "title": "...",
    "hook": "Tahukah kamu...",
    "summary": "...",
    "importantPoints": ["..."],
    "scenes": [
      {
        "index": 0,
        "sceneType": "image | reaction | summary",
        "narration": "...",
        "screenText": "...",
        "imagePrompt": "...",
        "visualKeywords": ["..."],
        "visualSegments": [
          { "imagePrompt": "...", "visualKeywords": ["..."] }
        ]
      }
    ],
    "wikiSources": [{ "title": "...", "url": "...", "license": "CC BY-SA" }]
  },
  "assets": {
    "images": [{ "sceneIndex": 0, "segmentIndex": 0, "path": "...", "url": "..." }],
    "clips": [{ "sceneIndex": 0, "segmentIndex": 0, "path": "...", "url": "...", "pexelsId": "..." }],
    "sceneAudio": [{ "sceneIndex": 0, "provider": "openai", "path": "...", "captions": [...] }],
    "hookAudio": { "provider": "openai", "path": "...", "text": "..." },
    "video": { "path": "...", "url": "...", "durationSec": 420 },
    "thumbnail": { "path": "...", "url": "..." }
  },
  "cost": {
    "storyUsd": 0.002,
    "imageUsd": 0.05,
    "ttsUsd": 0.01,
    "videoUsd": 0,
    "totalUsd": 0.062
  },
  "publish": {
    "youtube": {
      "videoId": "...",
      "url": "https://youtu.be/...",
      "publishedAt": "...",
      "playlist": "PLxxxxxxx",
      "thumbnailStatus": "uploaded"
    }
  }
}
```

### 5.2 Memory Item Schema (data/memory.json)

```json
{
  "version": 1,
  "updatedAt": "2026-07-27T10:30:00Z",
  "items": [
    {
      "id": "yt-20260727-abc123",
      "title": "...",
      "topic": "...",
      "category": "...",
      "viralAngleId": "...",
      "viralAngleLabel": "...",
      "hook": "...",
      "summary": "...",
      "importantPoints": ["..."],
      "createdAt": "...",
      "updatedAt": "...",
      "videoUrl": "..."
    }
  ]
}
```

---

## 6. API Contract

### 6.1 Local Server API (Express, src/server.js)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/health` | Health check + config + FFmpeg status | No |
| GET | `/api/state` | Full state (config + items) | PIN |
| GET | `/api/items` | List all items | PIN |
| GET | `/api/items/:id` | Get single item | PIN |
| POST | `/api/items` | Create draft (script only) | PIN |
| POST | `/api/items/full` | Full pipeline (script → render) | PIN |
| POST | `/api/items/:id/render` | Render existing item | PIN |
| POST | `/api/settings` | Update runtime settings | PIN |
| GET | `/api/run-status` | Check if run:once is active | No |
| POST | `/api/run-local` | Start run:once via SSE | PIN |

### 6.2 Vercel Serverless API (api/*.js)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth` | Login with PIN → session cookie | No |
| GET | `/api/state` | Dashboard state (items, runs, queue, stats) | Session |
| POST | `/api/run` | Trigger GitHub Actions workflow | Session |
| POST/GET/DELETE | `/api/queue` | Queue CRUD | Session |
| GET | `/api/preflight` | Remote diagnostics | Session |

### 6.3 Authentication
- **Local**: `X-Dashboard-Pin` header atau `?pin=` query parameter.
- **Vercel**: Cookie-based session (HMAC dari PIN).
- **Rate limiting**: Login brute-force protection di `api/_utils.js`.

---

## 7. External Dependencies

| Service | Purpose | Config Key | Required |
|---------|---------|------------|----------|
| OpenAI | Script, image, TTS, transcription | `OPENAI_API_KEY` | ✅ Yes |
| ElevenLabs | Alternative TTS | `ELEVENLABS_API_KEY` | ❌ Optional |
| Pexels | B-roll stock video | `PEXELS_API_KEY` | ❌ Optional |
| Wikipedia | Fact grounding | (no key needed) | ❌ Optional |
| SFTP/FTP | Media hosting upload | `SFTP_HOST`, etc. | ❌ Optional |
| YouTube Data API | Publish, playlist, trending | `YOUTUBE_CLIENT_ID`, etc. | ❌ Optional |
| GitHub Actions | Cloud pipeline execution | `GITHUB_TOKEN` | ❌ Optional |
| FFmpeg | Video rendering | (system binary) | ✅ Yes |

---

## 8. Cost Model

Estimasi biaya per video (default settings):

| Component | Model | Est. Cost/Video |
|-----------|-------|-----------------|
| Script (story) | gpt-4.1-mini | ~$0.002 |
| Images (14 scenes × ~2 seg) | gpt-image-1-mini (low) | ~$0.05 |
| TTS (14 scenes × ~200 chars) | gpt-4o-mini-tts | ~$0.01 |
| Pexels B-roll | Free tier | $0.00 |
| Wikipedia grounding | Free | $0.00 |
| FFmpeg render | Local CPU | $0.00 |
| **Total** | | **~$0.06/video** |

Config pricing di `.env`:
- `STORY_INPUT_USD_PER_1M_TOKENS=0.40`
- `STORY_OUTPUT_USD_PER_1M_TOKENS=1.60`
- `OPENAI_TTS_USD_PER_1M_CHARS=15`
- `ELEVENLABS_TTS_USD_PER_1K_CHARS=0.10`

---

## 9. Non-Functional Requirements

### 9.1 Performance
- Pipeline end-to-end: ~5–15 menit per video (tergantung scene count dan API latency).
- FFmpeg render: ~2–5 menit untuk video 6–10 menit.
- Pexels rate limit: 200ms antar request.

### 9.2 Reliability
- TTS fallback: ElevenLabs → OpenAI otomatis.
- Image retry: policy-violation → safe prompt fallback.
- SFTP upload: 3 attempts dengan exponential backoff.
- Daily generate/upload limits mencegah overspending.

### 9.3 Security
- PIN-based dashboard auth (≥12 karakter recommended).
- HMAC session cookies.
- Login rate limiting.
- Secrets di `.env` / GitHub Secrets, tidak di-commit.

### 9.4 Maintainability
- Graphify knowledge graph untuk onboarding AI agent.
- Comprehensive test suite (6 test files).
- `npm run check` — syntax check seluruh modul.
- Modular architecture (30 modul terpisah).

---

## 10. Deployment

### 10.1 Local Development
```bash
npm install
cp .env.example .env  # isi credentials
npm run preflight      # cek ffmpeg, keys, remote
npm run dev            # http://localhost:3050
```

### 10.2 Vercel Dashboard
```bash
vercel link            # project: dashboard-yt
vercel --prod          # deploy folder public/
# Set domain: dashboard-yt.emsa.pro
```

### 10.3 GitHub Actions
- Workflow: `.github/workflows/yt-longform-generate.yml`
- Trigger: schedule (cron) atau workflow_dispatch (dari dashboard)
- Requires: All secrets configured in repo settings

### 10.4 Media Hosting
- Buat folder `public_html/yt` → subdomain `yt.emsa.pro`
- Set `SFTP_REMOTE_DIR` di `.env` / GitHub Secrets

---

## 11. Future Roadmap

| Priority | Feature | Description |
|----------|---------|-------------|
| P1 | Multi-language support | Extend beyond Bahasa Indonesia |
| P1 | A/B thumbnail testing | Generate 2+ thumbnails, pick best CTR |
| P2 | Analytics dashboard | View/subscribe counts per video |
| P2 | Batch queue processing | Auto-process queued items sequentially |
| P2 | Higher resolution (1080p/4K) | Default 720p → upgrade render pipeline |
| P3 | Multi-platform publish | TikTok, Instagram Reels, Facebook |
| P3 | Voice cloning | Custom voice model for brand consistency |
| P3 | Live monitoring | Real-time cost tracking during generation |

---

## 12. Glossary

| Term | Definition |
|------|------------|
| **Item** | Satu unit video: dari draft sampai published |
| **Scene** | Satu segmen visual+narasi dalam video |
| **Visual Segment** | Sub-bagian scene yang punya media sendiri (multi-image/clip per scene) |
| **Reaction** | Scene khusus dengan klip reaksi (tanpa gambar AI) |
| **Cold Open** | Hook teaser di awal video sebelum bumper/intro |
| **Viral Angle** | Pola narasi yang terbukti menarik perhatian |
| **Format Type** | Gaya penceritaan (listicle, deep-dive, myth-buster, dll) |
| **Continuity Memory** | Riwayat compact untuk mencegah duplikasi topik |
| **Grounding** | Penyuntikan fakta dari Wikipedia ke naskah AI |
| **B-roll** | Footage video pendukung dari Pexels |
| **ASS** | Advanced SubStation Alpha — format subtitle untuk FFmpeg |
| **Ken Burns** | Efek zoom/pan perlahan pada gambar statis |
