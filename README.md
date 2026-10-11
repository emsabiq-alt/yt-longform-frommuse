# YT Longform Studio — varian **frommuse**

> Duplikat `yt-longform` dengan provider AI yang diganti:
> | Kebutuhan | Asli | Varian frommuse |
> |---|---|---|
> | Naskah/storyboard/ide/judul | OpenAI | **Hermes via 9Router** (endpoint OpenAI-compatible, `STORY_*`) |
> | Gambar scene | OpenAI `gpt-image` | **Google Flow** via Chrome CDP (`IMAGE_PROVIDER=flow`, modul `src/flow-image.js`) |
> | TTS | OpenAI / ElevenLabs | + **Groq** opsional (`YT_TTS_PROVIDER=groq`, modul `src/groq.js`) |
> | Thumbnail | Pollinations | tidak berubah |
> | Upload YouTube | YouTube Data API | tidak berubah |
>
> Varian ini dirancang jalan di **Muse VM** (tempat 9Router + Chrome Flow berada),
> bukan di GitHub Actions — Flow dan 9Router hanya bisa dijangkau dari localhost VM.

## Setup frommuse

```bash
npm install
cp .env.example .env   # isi kredensial
npm run preflight      # cek ffmpeg, key, Chrome Flow, remote
```

### Yang wajib disiapkan

1. **9Router + Hermes** berjalan di `127.0.0.1:20128` (Hermuse stack).
   Isi `.env`:
   ```
   STORY_BASE_URL=http://127.0.0.1:20128/v1
   STORY_API_KEY=<9router-api-key>
   STORY_MODEL=ag/gemini-3.8-flash
   ```
   Tanpa `STORY_*`, otomatis memakai `OPENAI_*` seperti aslinya.
2. **Chrome Flow** (sudah login Google) dengan remote debugging:
   ```bash
   ~/workspace/flow-chrome/start.sh   # CDP di 127.0.0.1:9222
   ```
   lalu buka satu tab `flow.google.com/project/...`. Gambar di-generate
   berurutan lewat tab ini (`FLOW_IMAGE_DELAY_MS` = jeda antar gambar).
3. **Groq** (opsional): isi `GROQ_API_KEY` lalu `YT_TTS_PROVIDER=groq`.
   Bila Groq gagal, otomatis fallback ke OpenAI.

### Menjalankan

- `npm run dev` — server + dashboard lokal di `http://localhost:3050`
- `npm run run:once -- --topic "..." --category sains` — generate satu video end-to-end
- `IMAGE_PROVIDER=openai npm run run:once -- ...` — paksa gambar via OpenAI (perilaku asli)

### File yang ditambah/diubah dari aslinya

- `src/flow-image.js` *(baru)* — klien CDP Google Flow (port dari `GoogleFlowRunner` repo cinematic)
- `src/groq.js` *(baru)* — TTS Groq OpenAI-compatible
- `src/config.js` — section `story`, `image`, `flow`, `groq`
- `src/openai.js` — chat memakai `config.story.*`; gambar delegasi ke Flow bila `IMAGE_PROVIDER=flow`
- `src/pipeline.js` — provider TTS `groq` + fallback; assert gambar longgar untuk Flow
- `src/preflight.js`, `src/run-once.js`, `api/_utils.js`, `api/run.js` — sadar provider baru
- `package.json` — tambah `ws` (WebSocket untuk CDP)

---

# YT Longform Studio

Studio video panjang (longform 16:9) edukasi Bahasa Indonesia. Naskah AI, gambar,
TTS **per scene** yang sinkron dengan subtitle, render FFmpeg, dan auto-upload
**khusus YouTube**. Terpisah total dari proyek `banyaktau`.

## Arsitektur

| Komponen | Lokasi |
|---|---|
| Repo | `emsabiq/yt-longform` (private) |
| Media publik | `https://yt.emsa.pro` → `public_html/yt` |
| Dashboard monitoring | `dashboard-yt.emsa.pro` (Vercel, static, read-only) |
| Aplikasi kontrol lokal | `app/yt_studio.py` (Python Tkinter) |
| Otomatisasi | GitHub Action (jadwal/manual) |

Media berat + FFmpeg jalan di GitHub Action atau lokal, hasilnya diupload via
SFTP ke `public_html/yt`. Dashboard di Vercel hanya membaca `yt.emsa.pro/state/items.json`.

## Setup

```bash
npm install
cp .env.example .env   # isi kredensial
npm run preflight      # cek ffmpeg, key, remote
```

### Menjalankan
- `npm run dev` — server + dashboard lokal di `http://localhost:3050`
- `npm run run:once` — generate satu video panjang lalu upload + publish YouTube
- `npm run rerender -- --id=<item-id>` — render ulang item yang sudah ada
- `npm run localize:youtube -- --video-id=<VIDEO_ID>` — terjemahkan judul/deskripsi video YouTube yang sudah ada
- `npm run localize:youtube:all -- --limit=0` — terjemahkan semua video channel yang belum punya lokalisasi

### Aplikasi lokal (Python)
```bash
cd app
cp config.example.json config.json   # isi token GitHub & state URL
python yt_studio.py                   # atau klik run-app.bat di Windows
```
Tab **Generate** bisa menjalankan pipeline lokal (Node) atau men-trigger GitHub Action.
Tab **Monitor** menampilkan daftar video dari state hosting.

## Sinkronisasi TTS (longform)
Default pembuatan video memakai target **1200 detik (20 menit)**, **36 scene awal**,
dan OpenAI TTS dengan `OPENAI_TTS_SPEED=1.08`. Storyboard awal menargetkan sekitar
2.280 kata dalam enam bab dengan bukti, contoh, sebab-akibat, dan perspektif berbeda.
Sesudah TTS, sistem mengukur durasi audio termasuk hook, intro, dan outro.
Jika masih kurang, sistem menyisipkan scene baru berdasarkan sumber dan laju bicara
terukur, maksimal empat tahap pengayaan dan 60 scene. Narasi scene lama tetap utuh
dan audionya digunakan kembali. File storyboard JSON menyimpan narasi lengkap.

Penyesuaian akhir memakai tempo render 0.98–1.12x dengan timestamp subtitle,
pergantian visual, dan spotlight yang ikut disesuaikan. Audio tidak dipotong untuk
mengejar durasi. FFprobe memeriksa MP4 akhir dengan toleransi satu detik dari target;
run berhenti sebelum publikasi bila target tidak bisa dipenuhi dalam batas tersebut.
Mockup tetap memakai `assets/phone-mockup.png` dan `assets/tablet-mockup.png`, dengan
sekitar 6–8 penempatan relevan di seluruh cerita; kuota 22 spotlight tersebar hingga
bab terakhir ketika tersedia pemicu yang cocok dengan audio.

Samakan `YT_DURATION_SEC=1200` dan `YT_SCENE_COUNT=36` di `.env`, GitHub Secrets,
dan Vercel production. Pengaturan eksplisit pengguna tetap didahulukan.

Gaya suara bawaan adalah narator dokumenter yang lincah, jelas, dan bervariasi
sesuai isi. `OPENAI_TTS_INSTRUCTIONS` dapat mengganti gaya ini untuk
`gpt-4o-mini-tts`; model `tts-1` dan `tts-1-hd` hanya menerima pengaturan speed.
Untuk membandingkan pacing, uji `OPENAI_TTS_SPEED=1.08` dan `1.10` dengan naskah
serta voice yang sama sebelum mengganti default. Pengaturan ini berlaku untuk
audio yang baru dibuat.

`npm run preview:speech` membuat dua sampel tersebut di
`generated/audio/pacing-preview/` (memerlukan key OpenAI dan FFprobe).
Workflow manual **YT Speech Pacing Preview** menjalankan perbandingan yang sama
dengan secret produksi dan menyimpan MP3 serta `comparison.json` sebagai artifact;
workflow ini tidak membuat atau mengunggah video ke YouTube.

Setiap scene (image / reaction / summary) punya file TTS sendiri. Durasi visual
mengikuti durasi audio yang telah disesuaikan, dan subtitle memakai timestamp
transkripsi per scene yang dikoreksi dengan tempo yang sama. Reaction ikut bersuara.

## Deploy

### Hosting media (SFTP)
Buat folder `public_html/yt` dan arahkan subdomain `yt.emsa.pro` ke sana.
Isi `SFTP_REMOTE_DIR` di `.env` / GitHub Secrets.

### Dashboard (Vercel)
```bash
vercel link        # project: dashboard-yt
vercel --prod      # deploy folder public/
```
Set domain `dashboard-yt.emsa.pro` di project Vercel.

### GitHub Secrets yang diperlukan
`PUBLIC_BASE_URL`, `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD`,
`SFTP_REMOTE_DIR`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` (opsional),
`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.
Token YouTube sama persis dengan akun banyaktau.

## Metadata multibahasa YouTube

Bahasa utama selalu `id` melalui `YOUTUBE_DEFAULT_LANGUAGE=id`. Setelah upload,
DeepSeek membuat judul dan deskripsi untuk 30 bahasa pada
`YOUTUBE_LOCALIZATION_LANGUAGES`, lalu YouTube Data API menyimpannya sebagai
localizations pada video yang sama. Terjemahan dibagi beberapa batch agar
aman untuk konteks model. Simpan `DEEPSEEK_API_KEY` hanya di `.env` lokal atau
secret CI; jangan pernah commit key ke Git.
