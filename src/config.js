import dotenv from "dotenv";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function clean(value) {
  return String(value || "").trim();
}

export function numberEnv(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function bool(value) {
  const cleaned = String(value || "").trim().toLowerCase();
  if (!cleaned) return false;
  return !["0", "false", "no", "off"].includes(cleaned);
}

function boolDefault(value, fallback) {
  const cleaned = String(value ?? "").trim();
  return cleaned ? bool(cleaned) : fallback;
}

function trimSlash(value) {
  return clean(value).replace(/\/+$/g, "");
}

/**
 * Parse "kategori:PLAYLIST_ID,kategori2:PLAYLIST_ID2" → Map
 * Contoh env: YOUTUBE_PLAYLISTS=sains:PLxxxxxxx,sejarah:PLyyyyyyy
 */
function parsePlaylistMap(value) {
  const map = new Map();
  const pairs = clean(value).split(",").map((p) => p.trim()).filter(Boolean);
  for (const pair of pairs) {
    const sep = pair.indexOf(":");
    if (sep <= 0) continue;
    const category = pair.slice(0, sep).trim().toLowerCase();
    const playlistId = pair.slice(sep + 1).trim();
    if (category && playlistId) map.set(category, playlistId);
  }
  return map;
}

function parseLanguageList(value, fallback = []) {
  const rows = clean(value).split(",").map((entry) => entry.trim()).filter(Boolean);
  const source = rows.length ? rows : fallback;
  const seen = new Set();
  return source.map((entry) => {
    const parts = String(entry).trim().split("-");
    const language = (parts.shift() || "").toLowerCase();
    const region = parts.join("-").toUpperCase();
    return region ? `${language}-${region}` : language;
  }).filter((entry) => {
    if (!/^[a-z]{2,3}(?:-[A-Z]{2,4})?$/.test(entry) || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
}

export const paths = {
  rootDir,
  dataDir: path.join(rootDir, "data"),
  generatedDir: path.join(rootDir, "generated"),
  imageDir: path.join(rootDir, "generated", "images"),
  audioDir: path.join(rootDir, "generated", "audio"),
  thumbnailDir: path.join(rootDir, "generated", "thumbnails"),
  videoDir: path.join(rootDir, "generated", "videos"),
  clipsDir: path.join(rootDir, "generated", "clips"),
  workDir: path.join(rootDir, "generated", "work"),
  fontDir: path.join(rootDir, "assets", "fonts"),
  publicDir: path.join(rootDir, "public")
};

export function ensureProjectDirs() {
  for (const dir of Object.values(paths)) {
    if (String(dir).startsWith(rootDir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export const DOCUMENTARY_TTS_INSTRUCTIONS = [
  "Bacakan sepenuhnya dalam Bahasa Indonesia sebagai narator dokumenter yang sedang menjelaskan penemuan menarik.",
  "Gunakan tempo lincah dan mengalir, artikulasi jelas, serta intonasi bervariasi sesuai makna kalimat.",
  "Bangun rasa penasaran secara alami. Tekankan fakta penting tanpa berteriak atau terdengar seperti iklan dan pidato motivasi.",
  "Berikan jeda singkat di batas gagasan. Ucapkan angka, nama, dan istilah dengan cermat agar mudah dipahami.",
  "Sesuaikan emosi dengan isi: hangat saat menjelaskan, tenang saat membahas peristiwa serius. Bacakan hanya naskah yang diberikan."
].join(" ");

export const config = {
  port: Math.max(1, Math.floor(numberEnv("PORT", 3050))),
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL),
  dashboardPin: clean(process.env.AUTO_DASHBOARD_PIN || "123456"),
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: trimSlash(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
    storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    imageSize: clean(process.env.IMAGE_SIZE || "1536x1024"),
    imageQuality: clean(process.env.IMAGE_QUALITY || "low"),
    imageGridMode: clean(process.env.IMAGE_GRID_MODE || "on").toLowerCase() !== "off",
    imageGridQuality: clean(process.env.IMAGE_GRID_QUALITY || "medium"),
    ttsModel: clean(process.env.OPENAI_TTS_MODEL || process.env.TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.OPENAI_TTS_VOICE || process.env.TTS_VOICE || "nova"),
    ttsSpeed: Math.min(4, Math.max(0.25, numberEnv("OPENAI_TTS_SPEED", 1.08))),
    ttsInstructions: clean(process.env.OPENAI_TTS_INSTRUCTIONS) || DOCUMENTARY_TTS_INSTRUCTIONS,
    transcribeModel: clean(process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1")
  },
  // === FROMMUSE: story/chat (naskah, ide, judul) via Hermes di 9Router ===
  // Endpoint OpenAI-compatible; default mengikuti OPENAI_* bila STORY_* tidak diisi.
  story: {
    baseUrl: trimSlash(process.env.STORY_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"),
    apiKey: clean(process.env.STORY_API_KEY || process.env.OPENAI_API_KEY || ""),
    model: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    timeoutMs: Math.max(15000, numberEnv("STORY_TIMEOUT_MS", 600000))
  },
  // === FROMMUSE: saklar provider gambar ("openai" | "flow") ===
  image: {
    provider: clean(process.env.IMAGE_PROVIDER || "flow").toLowerCase()
  },
  // === FROMMUSE: Google Flow via Chrome CDP (tab flow.google.com yang sudah login) ===
  flow: {
    cdpPort: Math.max(1, Math.floor(numberEnv("FLOW_CDP_PORT", 9222))),
    timeoutMs: Math.max(15000, numberEnv("FLOW_IMAGE_TIMEOUT_MS", 180000)),
    delayBetweenMs: Math.max(0, numberEnv("FLOW_IMAGE_DELAY_MS", 8000))
  },
  // === FROMMUSE: TTS via Groq (OpenAI-compatible, opsional) ===
  // Model aktif: canopylabs/orpheus-v1-english (playai-tts pensiun 2025-12-31).
  groq: {
    apiKey: clean(process.env.GROQ_API_KEY || ""),
    baseUrl: trimSlash(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"),
    ttsModel: clean(process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english"),
    ttsVoice: clean(process.env.GROQ_TTS_VOICE || "troy"),
    ttsSpeed: Math.min(2, Math.max(0.5, numberEnv("GROQ_TTS_SPEED", 1.0)))
  },
  piper: {
    voice: clean(process.env.PIPER_VOICE || "id_ID-news_tts-medium"),
    python: clean(process.env.PIPER_PYTHON || "python3"),
    voiceDir: clean(process.env.PIPER_VOICE_DIR || ""),
    timeoutMs: Math.max(15000, numberEnv("PIPER_TIMEOUT_MS", 120000))
  },
  supertonic: {
    voice: clean(process.env.SUPERTONIC_VOICE || "M2"),
    python: clean(process.env.SUPERTONIC_PYTHON || "python3"),
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: trimSlash(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"),
    model: clean(process.env.DEEPSEEK_MODEL || "deepseek-chat"),
    timeoutMs: Math.max(5000, numberEnv("DEEPSEEK_TIMEOUT_MS", 60000)),
    ideaTimeoutMs: Math.max(5000, numberEnv("DEEPSEEK_IDEA_TIMEOUT_MS", 30000)),
    languagesPerRequest: Math.min(10, Math.max(1, Math.floor(numberEnv("DEEPSEEK_LANGUAGES_PER_REQUEST", 5))))
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    model: clean(process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2"),
    voiceId: clean(process.env.ELEVENLABS_VOICE_ID || "wUrGnU2Kx934kbDdOWDo"),
    speed: Math.min(1.2, Math.max(0.7, numberEnv("ELEVENLABS_SPEED", 1.08)))
  },
  pollinations: {
    apiKey: clean(process.env.POLLINATIONS_API_KEY || ""),
    model: clean(process.env.POLLINATIONS_IMAGE_MODEL || "flux"),
    baseUrl: trimSlash(process.env.POLLINATIONS_BASE_URL || "https://image.pollinations.ai")
  },
  youtube: {
    enabled: bool(process.env.YOUTUBE_UPLOAD_ENABLED),
    clientId: clean(process.env.YOUTUBE_CLIENT_ID),
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || "",
    privacyStatus: clean(process.env.YOUTUBE_PRIVACY_STATUS || "public"),
    scheduledPublishEnabled: boolDefault(process.env.YOUTUBE_SCHEDULED_PUBLISH_ENABLED, true),
    scheduledPublishTime: clean(process.env.YOUTUBE_SCHEDULED_PUBLISH_TIME || "20:30"),
    scheduledPublishTimeZone: clean(process.env.YOUTUBE_SCHEDULED_PUBLISH_TIME_ZONE || "America/New_York"),
    scheduledPublishLeadMinutes: Math.max(5, Math.min(180,
      Math.floor(numberEnv("YOUTUBE_SCHEDULED_PUBLISH_LEAD_MINUTES", 30))
    )),
    defaultLanguage: clean(process.env.YOUTUBE_DEFAULT_LANGUAGE || "id") || "id",
    defaultAudioLanguage: clean(process.env.YOUTUBE_DEFAULT_AUDIO_LANGUAGE || "id") || "id",
    localizationEnabled: boolDefault(process.env.YOUTUBE_LOCALIZATION_ENABLED, true),
    localizationLanguages: parseLanguageList(
      process.env.YOUTUBE_LOCALIZATION_LANGUAGES,
      ["en", "es", "pt-BR", "hi", "ar", "fr", "de", "ja", "ko", "zh-CN", "ru", "it", "tr", "vi", "th"]
    ),
    categoryId: clean(process.env.YOUTUBE_CATEGORY_ID || "27"),
    tags: clean(process.env.YOUTUBE_TAGS || "BanyakTau,Edukasi,Pengetahuan,Sains,Sejarah,Teknologi")
      .split(",").map((tag) => clean(tag)).filter(Boolean),
    customThumbnailEnabled: boolDefault(process.env.YOUTUBE_CUSTOM_THUMBNAIL_ENABLED, true),
    // Unggah satu track subtitle bahasa sumber; YouTube menerjemahkannya otomatis.
    captionUploadEnabled: boolDefault(process.env.YOUTUBE_CAPTION_UPLOAD_ENABLED, true),
    thumbnailUploadAttempts: Math.min(3, Math.max(1, numberEnv("YOUTUBE_THUMBNAIL_UPLOAD_ATTEMPTS", 1))),
    dailyUploadLimit: Math.max(0, numberEnv("YOUTUBE_DAILY_UPLOAD_LIMIT", 2)),
    defaultPlaylistId: clean(process.env.YOUTUBE_DEFAULT_PLAYLIST_ID),
    playlists: parsePlaylistMap(process.env.YOUTUBE_PLAYLISTS || ""),
    dataApiKey: process.env.YOUTUBE_DATA_API_KEY || "",
    trendingEnabled: boolDefault(process.env.YOUTUBE_TRENDING_ENABLED, true),
    trendingRegion: clean(process.env.YOUTUBE_TRENDING_REGION || "US")
  },
  pricing: {
    storyInputUsdPer1MTokens: numberEnv("STORY_INPUT_USD_PER_1M_TOKENS", 0.4),
    storyOutputUsdPer1MTokens: numberEnv("STORY_OUTPUT_USD_PER_1M_TOKENS", 1.6),
    openaiTtsUsdPer1MChars: numberEnv("OPENAI_TTS_USD_PER_1M_CHARS", numberEnv("TTS_USD_PER_1M_CHARS", 15)),
    elevenlabsTtsUsdPer1KChars: numberEnv("ELEVENLABS_TTS_USD_PER_1K_CHARS", 0.1),
    videoUsdPerSecond: 0
  },
  render: {
    fontTitle: clean(process.env.RENDER_TITLE_FONT || "Bebas Neue"),
    fontBody: clean(process.env.RENDER_BODY_FONT || "Noto Sans"),
    fontMono: clean(process.env.RENDER_MONO_FONT || "JetBrains Mono"),
    speechTempo: Math.min(1.3, Math.max(0.9, numberEnv("SPEECH_TEMPO", 1.0))),
    introEnabled: boolDefault(process.env.YT_INTRO_ENABLED, false),
    outroEnabled: boolDefault(process.env.YT_OUTRO_ENABLED, false),
    bumperOutroEnabled: boolDefault(process.env.YT_BUMPER_OUTRO_ENABLED, false)
  },
  automation: {
    timeZone: clean(process.env.YT_TIME_ZONE || "Asia/Bangkok"),
    dailyGenerateLimit: Math.max(0, numberEnv("YT_DAILY_GENERATE_LIMIT", 1)),
    durationSec: Math.min(1200, Math.max(300, numberEnv("YT_DURATION_SEC", 900))),
    sceneCount: Math.min(48, Math.max(8, numberEnv("YT_SCENE_COUNT", 27))),
    workflowFile: clean(process.env.YT_WORKFLOW_FILE || "yt-longform-generate.yml"),
    strictRemote: bool(process.env.YT_STRICT_REMOTE),
    viralTitleEnabled: boolDefault(process.env.YT_VIRAL_TITLE_ENABLED, true),
    coldOpenEnabled: boolDefault(process.env.YT_COLD_OPEN_ENABLED, true)
  },
  topic: {
    defaultCategory: clean(process.env.YT_DEFAULT_CATEGORY || "vulkanologi"),
    disableNewsTrends: boolDefault(process.env.YT_DISABLE_NEWS_TRENDS, true),
    // Luar angkasa tetap ada sebagai variasi, bukan menjadi mayoritas kanal.
    spaceTargetRatio: Math.max(0, Math.min(1, numberEnv("YT_SPACE_TOPIC_RATIO", 0.15))),
    categoryHistoryWindow: Math.max(10, Math.min(80,
      Math.floor(numberEnv("YT_TOPIC_CATEGORY_WINDOW", 30))
    ))
  },
  pexels: {
    apiKey: process.env.PEXELS_API_KEY || "",
    preferVideo: boolDefault(process.env.PEXELS_PREFER_VIDEO, true),
    locale: clean(process.env.PEXELS_LOCALE || "en-US"),
    minDurationSec: Math.max(3, numberEnv("PEXELS_MIN_DURATION_SEC", 8)),
    maxResultsPerScene: Math.max(1, Math.min(80, Math.floor(numberEnv("PEXELS_MAX_RESULTS", 30)))),
    maxQueryAttempts: Math.max(1, Math.min(2, Math.floor(numberEnv("PEXELS_MAX_QUERY_ATTEMPTS", 2)))),
    // Pilih scene penerima video berdasarkan kekonkretan keyword (semantik), bukan paritas indeks.
    semanticSelection: boolDefault(process.env.PEXELS_SEMANTIC_SELECTION, true),
    // Porsi maksimum segmen visual yang diisi klip video (0-1, default 70%).
    clipRatio: Math.max(0, Math.min(1, numberEnv("PEXELS_CLIP_RATIO", 0.7))),
    // DEPRECATED: relevansi kini murni sinyal ranking, bukan gerbang penolakan.
    // Field dipertahankan untuk kompatibilitas audit lama.
    minRelevance: Math.max(0.01, Math.min(1, numberEnv("PEXELS_MIN_RELEVANCE", 0.34))),
    overlayEnabled: boolDefault(process.env.PEXELS_OVERLAY_ENABLED, true),
    overlayPath: clean(process.env.PEXELS_OVERLAY_PATH || path.join(rootDir, "assets", "overlays", "fire-sparks-black.mp4")),
    overlayOpacity: Math.min(1, Math.max(0.05, numberEnv("PEXELS_OVERLAY_OPACITY", 0.55))),
    blackKeySimilarity: Math.min(1, Math.max(0.01, numberEnv("PEXELS_BLACK_KEY_SIMILARITY", 0.16))),
    blackKeyBlend: Math.min(1, Math.max(0, numberEnv("PEXELS_BLACK_KEY_BLEND", 0.08)))
  },
  pixabay: {
    apiKey: clean(process.env.PIXABAY_API_KEY || "57557703-d564c9ce2e7c62284ab235767"),
    enabled: boolDefault(process.env.PIXABAY_ENABLED, true),
    preferVideo: boolDefault(process.env.PIXABAY_PREFER_VIDEO, true),
    maxAssetsPerVideo: Math.max(0, Math.min(30, Math.floor(numberEnv("PIXABAY_MAX_ASSETS_PER_VIDEO", 25)))),
    maxResults: Math.max(1, Math.min(50, Math.floor(numberEnv("PIXABAY_MAX_RESULTS", 15)))),
    timeoutMs: Math.max(3000, numberEnv("PIXABAY_TIMEOUT_MS", 15000)),
    downloadTimeoutMs: Math.max(5000, numberEnv("PIXABAY_DOWNLOAD_TIMEOUT_MS", 120000))
  },
  wikimedia: {
    // Commons gratis dan tidak memakai API key. Default lisensi dibuat
    // konservatif: Public Domain, CC0, dan CC BY.
    enabled: boolDefault(process.env.WIKIMEDIA_MEDIA_ENABLED, true),
    userAgent: clean(process.env.WIKIMEDIA_USER_AGENT
      || "yt-longform-studio/1.0 (+https://github.com/emsabiq-alt/yt-longform)"),
    maxAssetsPerVideo: Math.max(0, Math.min(12,
      Math.floor(numberEnv("WIKIMEDIA_MAX_ASSETS_PER_VIDEO", 8))
    )),
    maxResults: Math.max(1, Math.min(25,
      Math.floor(numberEnv("WIKIMEDIA_MAX_RESULTS", 12))
    )),
    maxQueryAttempts: Math.max(1, Math.min(2,
      Math.floor(numberEnv("WIKIMEDIA_MAX_QUERY_ATTEMPTS", 2))
    )),
    minRelevance: Math.max(0.1, Math.min(1, numberEnv("WIKIMEDIA_MIN_RELEVANCE", 0.2))),
    imageWidth: Math.max(720, Math.min(2560,
      Math.floor(numberEnv("WIKIMEDIA_IMAGE_WIDTH", 1920))
    )),
    maxImageBytes: Math.max(1, numberEnv("WIKIMEDIA_MAX_IMAGE_MB", 20)) * 1024 * 1024,
    maxVideoBytes: Math.max(1, numberEnv("WIKIMEDIA_MAX_VIDEO_MB", 120)) * 1024 * 1024,
    allowShareAlike: boolDefault(process.env.WIKIMEDIA_ALLOW_SHARE_ALIKE, true),
    timeoutMs: Math.max(3000, numberEnv("WIKIMEDIA_TIMEOUT_MS", 15000)),
    downloadTimeoutMs: Math.max(5000, numberEnv("WIKIMEDIA_DOWNLOAD_TIMEOUT_MS", 120000)),
    requestDelayMs: Math.max(0, numberEnv("WIKIMEDIA_REQUEST_DELAY_MS", 150))
  },
  openverse: {
    // Openverse mengindeks ratusan juta gambar CC dari Flickr, museum, NASA,
    // Smithsonian, dan Commons. Gratis, tanpa API key. Dipakai untuk slot yang
    // tidak terisi Pexels maupun Commons, sebelum jatuh ke gambar berbayar.
    enabled: boolDefault(process.env.OPENVERSE_ENABLED, false),
    // Foto tokoh via Wikidata P18: dicoba lebih dulu saat scene menyebut nama
    // orang, karena pemetaan entitas→foto jauh lebih akurat daripada cari teks.
    personLookup: boolDefault(process.env.OPENVERSE_PERSON_LOOKUP, true),
    maxAssetsPerVideo: Math.max(0, Math.min(12,
      Math.floor(numberEnv("OPENVERSE_MAX_ASSETS_PER_VIDEO", 6))
    )),
    maxResults: Math.max(1, Math.min(20,
      Math.floor(numberEnv("OPENVERSE_MAX_RESULTS", 12))
    )),
    maxQueryAttempts: Math.max(1, Math.min(2,
      Math.floor(numberEnv("OPENVERSE_MAX_QUERY_ATTEMPTS", 2))
    )),
    minRelevance: Math.max(0.1, Math.min(1, numberEnv("OPENVERSE_MIN_RELEVANCE", 0.34))),
    // Sengaja pendek: query dingin di Openverse bisa menggantung ~60 detik.
    // Lebih baik menyerah cepat dan pakai gambar OpenAI daripada menahan render.
    timeoutMs: Math.max(3000, numberEnv("OPENVERSE_TIMEOUT_MS", 10000)),
    downloadTimeoutMs: Math.max(5000, numberEnv("OPENVERSE_DOWNLOAD_TIMEOUT_MS", 60000)),
    requestDelayMs: Math.max(0, numberEnv("OPENVERSE_REQUEST_DELAY_MS", 150))
  },
  thumbnail: {
    enabled: boolDefault(process.env.THUMBNAIL_GENERATION_ENABLED, true)
  },
  wikipedia: {
    // Grounding fakta dari Wikipedia (GRATIS, tanpa API key). Lihat src/wikipedia.js.
    enabled: boolDefault(process.env.WIKIPEDIA_GROUNDING_ENABLED, true),
    lang: clean(process.env.WIKIPEDIA_LANG || "id"),
    userAgent: clean(process.env.WIKIPEDIA_USER_AGENT
      || "yt-longform-studio/1.0 (+https://yt.emsa.pro; kontak: admin@emsa.pro)"),
    maxArticles: Math.max(1, Math.min(4, numberEnv("WIKIPEDIA_MAX_ARTICLES", 2))),
    // 4000 char ≈ 1000 token input ≈ $0.0004 per naskah. Lead paragraph saja
    // (1800) tidak memuat bagian padat angka yang diminta prompt.
    maxChars: Math.max(400, Math.min(12000, numberEnv("WIKIPEDIA_MAX_CHARS", 4000))),
    timeoutMs: Math.max(2000, numberEnv("WIKIPEDIA_TIMEOUT_MS", 8000))
  },
  googleSearch: {
    apiKey: clean(process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_SEARCH_API_KEY || ""),
    cx: clean(process.env.GOOGLE_CSE_CX || process.env.GOOGLE_SEARCH_ENGINE_ID || ""),
    enabled: boolDefault(process.env.GOOGLE_SEARCH_IMAGE_ENABLED, true)
  },
  serper: {
    apiKey: clean(process.env.SERPER_API_KEY || "")
  }
};

export function publicConfig() {
  return {
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    durationSec: config.automation.durationSec,
    sceneCount: config.automation.sceneCount,
    ttsProvider: clean(process.env.YT_TTS_PROVIDER || "openai"),
    ttsVoice: config.openai.ttsVoice,
    openaiTtsSpeed: config.openai.ttsSpeed,
    elevenlabsVoiceId: config.elevenlabs.voiceId,
    elevenlabsSpeed: config.elevenlabs.speed,
    providers: {
      openai: Boolean(config.openai.apiKey),
      openaiBaseUrl: config.openai.baseUrl,
      elevenlabs: Boolean(config.elevenlabs.apiKey),
      storyBaseUrl: config.story.baseUrl,
      storyModel: config.story.model,
      storyKeySet: Boolean(config.story.apiKey),
      imageProvider: config.image.provider,
      flowCdpPort: config.flow.cdpPort,
      groq: Boolean(config.groq.apiKey),
      groqTtsModel: config.groq.ttsModel,
      groqTtsVoice: config.groq.ttsVoice,
      storyModel: config.openai.storyModel,
      imageModel: config.openai.imageModel,
      imageSize: config.openai.imageSize,
      imageQuality: config.openai.imageQuality,
      imageGridMode: config.openai.imageGridMode,
      imageGridQuality: config.openai.imageGridQuality,
      openaiTtsModel: config.openai.ttsModel,
      openaiTtsVoice: config.openai.ttsVoice,
      openaiTtsSpeed: config.openai.ttsSpeed,
      openaiTtsInstructions: config.openai.ttsInstructions,
      openaiTranscribeModel: config.openai.transcribeModel,
      deepseek: Boolean(config.deepseek.apiKey),
      deepseekBaseUrl: config.deepseek.baseUrl,
      deepseekModel: config.deepseek.model,
      elevenlabsModel: config.elevenlabs.model,
      elevenlabsVoiceId: config.elevenlabs.voiceId,
      elevenlabsSpeed: config.elevenlabs.speed,
      youtubeUploadEnabled: config.youtube.enabled,
      youtubeDefaultLanguage: config.youtube.defaultLanguage,
      youtubeDefaultAudioLanguage: config.youtube.defaultAudioLanguage,
      youtubeLocalizationEnabled: config.youtube.localizationEnabled,
      youtubeLocalizationLanguages: config.youtube.localizationLanguages,
      youtubeClientIdSet: bool(config.youtube.clientId),
      youtubeRefreshTokenSet: bool(config.youtube.refreshToken),
      pexels: Boolean(config.pexels.apiKey),
      pexelsPreferVideo: config.pexels.preferVideo,
      wikimedia: config.wikimedia.enabled,
      googleSearch: Boolean((config.googleSearch.apiKey && config.googleSearch.cx) || config.serper.apiKey)
    },
    render: config.render,
    automation: config.automation,
    dashboard: {
      productionMode: "longform-youtube-only",
      pinRequired: true
    }
  };
}

export async function updateRuntimeSettings(input = {}) {
  const updates = {};
  const map = {
    openaiApiKey: "OPENAI_API_KEY",
    openaiBaseUrl: "OPENAI_BASE_URL",
    storyModel: "STORY_MODEL",
    imageModel: "IMAGE_MODEL",
    openaiTtsVoice: "OPENAI_TTS_VOICE",
    openaiTtsModel: "OPENAI_TTS_MODEL",
    openaiTtsInstructions: "OPENAI_TTS_INSTRUCTIONS",
    openaiTranscribeModel: "OPENAI_TRANSCRIBE_MODEL",
    deepseekApiKey: "DEEPSEEK_API_KEY",
    deepseekBaseUrl: "DEEPSEEK_BASE_URL",
    deepseekModel: "DEEPSEEK_MODEL",
    elevenlabsApiKey: "ELEVENLABS_API_KEY",
    elevenlabsModel: "ELEVENLABS_MODEL",
    elevenlabsVoiceId: "ELEVENLABS_VOICE_ID",
    pexelsApiKey: "PEXELS_API_KEY",
    googleCseKey: "GOOGLE_CSE_KEY",
    googleCseCx: "GOOGLE_CSE_CX",
    serperApiKey: "SERPER_API_KEY"
  };
  for (const [key, envName] of Object.entries(map)) {
    const value = key.endsWith("ApiKey") || key.endsWith("Url") ? trimSlash(input[key]) : clean(input[key]);
    if (value) updates[envName] = value;
  }
  const openaiTtsSpeed = Number(input.openaiTtsSpeed);
  if (String(input.openaiTtsSpeed ?? "").trim() && Number.isFinite(openaiTtsSpeed)) {
    updates.OPENAI_TTS_SPEED = String(Math.min(4, Math.max(0.25, openaiTtsSpeed)));
  }
  const speechTempo = Number(input.speechTempo);
  if (Number.isFinite(speechTempo)) updates.SPEECH_TEMPO = String(Math.min(1.3, Math.max(0.9, speechTempo)));
  const elevenlabsSpeed = Number(input.elevenlabsSpeed);
  if (Number.isFinite(elevenlabsSpeed)) {
    updates.ELEVENLABS_SPEED = String(Math.min(1.2, Math.max(0.7, elevenlabsSpeed)));
  }

  if (Object.keys(updates).length) {
    await writeEnvUpdates(updates);
    applyConfigUpdates(updates);
  }
  return publicConfig();
}

async function writeEnvUpdates(updates) {
  const envPath = path.join(rootDir, ".env");
  let lines = [];
  try {
    lines = (await fsp.readFile(envPath, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const name = match[1];
    if (!(name in updates)) return line;
    seen.add(name);
    return `${name}=${updates[name]}`;
  });
  for (const [name, value] of Object.entries(updates)) {
    if (!seen.has(name)) next.push(`${name}=${value}`);
  }
  await fsp.writeFile(envPath, `${next.filter((line, index, arr) => index < arr.length - 1 || line).join("\n")}\n`);
}

function applyConfigUpdates(updates) {
  for (const [name, value] of Object.entries(updates)) process.env[name] = value;
  if (updates.OPENAI_API_KEY !== undefined) config.openai.apiKey = updates.OPENAI_API_KEY;
  if (updates.OPENAI_BASE_URL !== undefined) config.openai.baseUrl = trimSlash(updates.OPENAI_BASE_URL);
  if (updates.STORY_MODEL !== undefined) { config.openai.storyModel = updates.STORY_MODEL; config.story.model = updates.STORY_MODEL; }
  if (updates.STORY_BASE_URL !== undefined) config.story.baseUrl = trimSlash(updates.STORY_BASE_URL);
  if (updates.STORY_API_KEY !== undefined) config.story.apiKey = updates.STORY_API_KEY;
  if (updates.IMAGE_PROVIDER !== undefined) config.image.provider = clean(updates.IMAGE_PROVIDER).toLowerCase();
  if (updates.FLOW_CDP_PORT !== undefined) config.flow.cdpPort = Math.max(1, Math.floor(Number(updates.FLOW_CDP_PORT)));
  if (updates.FLOW_IMAGE_TIMEOUT_MS !== undefined) config.flow.timeoutMs = Math.max(15000, Number(updates.FLOW_IMAGE_TIMEOUT_MS));
  if (updates.GROQ_API_KEY !== undefined) config.groq.apiKey = updates.GROQ_API_KEY;
  if (updates.GROQ_TTS_MODEL !== undefined) config.groq.ttsModel = updates.GROQ_TTS_MODEL;
  if (updates.GROQ_TTS_VOICE !== undefined) config.groq.ttsVoice = updates.GROQ_TTS_VOICE;
  if (updates.GROQ_TTS_SPEED !== undefined) config.groq.ttsSpeed = Number(updates.GROQ_TTS_SPEED);
  if (updates.IMAGE_MODEL !== undefined) config.openai.imageModel = updates.IMAGE_MODEL;
  if (updates.IMAGE_GRID_MODE !== undefined) config.openai.imageGridMode = clean(updates.IMAGE_GRID_MODE).toLowerCase() !== "off";
  if (updates.IMAGE_GRID_QUALITY !== undefined) config.openai.imageGridQuality = clean(updates.IMAGE_GRID_QUALITY);
  if (updates.OPENAI_TTS_MODEL !== undefined) config.openai.ttsModel = updates.OPENAI_TTS_MODEL;
  if (updates.OPENAI_TTS_VOICE !== undefined) config.openai.ttsVoice = updates.OPENAI_TTS_VOICE;
  if (updates.OPENAI_TTS_SPEED !== undefined) config.openai.ttsSpeed = Number(updates.OPENAI_TTS_SPEED);
  if (updates.OPENAI_TTS_INSTRUCTIONS !== undefined) config.openai.ttsInstructions = updates.OPENAI_TTS_INSTRUCTIONS;
  if (updates.OPENAI_TRANSCRIBE_MODEL !== undefined) config.openai.transcribeModel = updates.OPENAI_TRANSCRIBE_MODEL;
  if (updates.DEEPSEEK_API_KEY !== undefined) config.deepseek.apiKey = updates.DEEPSEEK_API_KEY;
  if (updates.DEEPSEEK_BASE_URL !== undefined) config.deepseek.baseUrl = trimSlash(updates.DEEPSEEK_BASE_URL);
  if (updates.DEEPSEEK_MODEL !== undefined) config.deepseek.model = updates.DEEPSEEK_MODEL;
  if (updates.ELEVENLABS_API_KEY !== undefined) config.elevenlabs.apiKey = updates.ELEVENLABS_API_KEY;
  if (updates.ELEVENLABS_MODEL !== undefined) config.elevenlabs.model = updates.ELEVENLABS_MODEL;
  if (updates.ELEVENLABS_VOICE_ID !== undefined) config.elevenlabs.voiceId = updates.ELEVENLABS_VOICE_ID;
  if (updates.ELEVENLABS_SPEED !== undefined) config.elevenlabs.speed = Number(updates.ELEVENLABS_SPEED);
  if (updates.SPEECH_TEMPO !== undefined) config.render.speechTempo = Number(updates.SPEECH_TEMPO);
  if (updates.PEXELS_API_KEY !== undefined) config.pexels.apiKey = updates.PEXELS_API_KEY;
}
