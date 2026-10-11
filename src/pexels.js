/**
 * Pexels API — Search & download video B-roll untuk scene longform.
 *
 * Strategi:
 *   1. Cari video landscape di Pexels berdasarkan visualKeywords scene.
 *   2. Pilih file video HD (preferensi ≥720p, landscape).
 *   3. Download ke generated/clips/ untuk dipakai render pipeline.
 *
 * Docs: https://www.pexels.com/api/documentation/#videos-search
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config, paths } from "./config.js";

const PEXELS_VIDEO_SEARCH_URL = "https://api.pexels.com/v1/videos/search";
export const PEXELS_SELECTOR_VERSION = 2;
const PEXELS_SEARCH_TIMEOUT_MS = 30_000;
const PEXELS_DOWNLOAD_TIMEOUT_MS = 120_000;

function assertPexels() {
  if (!config.pexels.apiKey) throw new Error("PEXELS_API_KEY belum diisi.");
}

function pexelsHeaders() {
  return { Authorization: config.pexels.apiKey };
}

/**
 * Cari video di Pexels.
 * @param {string} query - Kata kunci pencarian (bahasa Inggris).
 * @param {object} options
 * @param {string} [options.orientation] - landscape | portrait | square
 * @param {string} [options.size] - large | medium | small
 * @param {number} [options.perPage] - Jumlah hasil (1-80)
 * @returns {Promise<object[]>} Array of Pexels video objects
 */
export async function searchPexelsVideos(query, options = {}) {
  assertPexels();
  const url = new URL(PEXELS_VIDEO_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", options.orientation || "landscape");
  url.searchParams.set("size", options.size || "medium");
  url.searchParams.set("locale", options.locale || config.pexels.locale || "en-US");
  url.searchParams.set("page", String(Math.max(1, Math.floor(Number(options.page) || 1))));
  const perPage = Math.max(1, Math.min(80,
    Math.floor(Number(options.perPage) || config.pexels.maxResultsPerScene || 30)
  ));
  url.searchParams.set("per_page", String(perPage));

  const response = await fetch(url.toString(), {
    headers: pexelsHeaders(),
    signal: AbortSignal.timeout(PEXELS_SEARCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Pexels search gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  const data = await response.json();
  return Array.isArray(data.videos) ? data.videos : [];
}

/**
 * Pilih file video terbaik dari hasil Pexels (preferensi HD landscape).
 * @param {object} video - Pexels video object
 * @returns {object|null} { url, width, height, quality }
 */
export function pickBestVideoFile(video) {
  if (!video?.video_files?.length) return null;
  const files = video.video_files
    .filter((f) => (
      f.file_type === "video/mp4"
      && Boolean(f.link)
      && Number(f.width || 0) > Number(f.height || 0)
    ))
    .sort((a, b) => {
      // Prefer HD (720p-1080p), landscape, not too large
      const scoreA = videoFileScore(a);
      const scoreB = videoFileScore(b);
      return scoreB - scoreA;
    });
  return files[0] || null;
}

/**
 * Nilai file video untuk seleksi.
 */
function videoFileScore(file) {
  const w = Number(file.width || 0);
  const h = Number(file.height || 0);
  let score = 0;
  // Landscape bonus
  if (w > h) score += 100;
  // HD sweet spot (720p - 1080p)
  if (h >= 720 && h <= 1080) score += 80;
  else if (h >= 480 && h < 720) score += 40;
  else if (h > 1080) score += 30; // Too large, still ok
  // Prefer not too small
  if (w >= 1280) score += 20;
  // Quality label
  if (file.quality === "hd") score += 15;
  else if (file.quality === "sd") score += 5;
  return score;
}

// --- Seleksi semantik & relevansi -----------------------------------------
// Heuristik murni (gratis, tanpa panggilan API) untuk dua hal:
//   1. Memilih scene mana yang layak dapat B-roll video (kekonkretan keyword).
//   2. Merangking/menyaring klip Pexels berdasarkan overlap keyword↔judul klip.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "with", "by",
  "at", "from", "as", "is", "are", "be", "this", "that", "these", "those",
  "its", "their", "our", "your"
]);

// Kata bermuatan abstrak/intangible: sulit difilmkan apa adanya, lebih cocok
// dilukiskan gambar DALL-E ketimbang dicari sebagai B-roll nyata di Pexels.
const ABSTRACT_WORDS = new Set([
  "history", "historical", "future", "past", "era", "age", "concept", "idea",
  "theory", "policy", "strategy", "system", "crisis", "growth", "decline",
  "rise", "fall", "power", "strength", "weakness", "dominance", "dominion",
  "influence", "trust", "confidence", "stability", "instability", "uncertainty",
  "freedom", "democracy", "economy", "economic", "finance", "financial",
  "inflation", "recession", "diversification", "globalization", "geopolitics",
  "geopolitical", "relations", "diplomacy", "sentiment", "fear", "hope",
  "change", "transformation", "evolution", "impact", "effect", "importance",
  "significance", "value", "wealth", "debt", "aftermath", "reserve", "reserves"
]);

/**
 * Pecah teks jadi kata bermakna. Unicode dilipat ke bentuk ASCII bila ada
 * padanannya (São -> sao), huruf/angka dipertahankan (G20 -> g20), lalu
 * stopword dan token satu karakter dibuang.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeWords(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((w) => (
      w.length >= 2
      && !STOPWORDS.has(w)
    ));
}

/**
 * Skor "kekonkretan" visual sebuah scene berdasarkan visualKeywords.
 * Makin tinggi → makin mudah dapat B-roll nyata di Pexels; makin rendah →
 * lebih baik diserahkan ke gambar DALL-E (yang bisa melukiskan konsep abstrak).
 * @param {object} scene - butuh field visualKeywords (string dipisah koma).
 * @returns {number}
 */
export function scoreSceneVisualConcreteness(scene) {
  const phrases = String(scene?.visualKeywords || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!phrases.length) return -5; // tanpa keyword: query Pexels lemah → utamakan gambar
  let score = 0;
  for (const phrase of phrases) {
    const tokens = tokenizeWords(phrase);
    if (!tokens.length) continue;
    const abstract = tokens.filter((t) => ABSTRACT_WORDS.has(t)).length;
    const concrete = tokens.length - abstract;
    score += concrete - abstract;                       // konkret menambah, abstrak mengurangi
    if (concrete > 0 && abstract === 0) score += 0.5;   // frasa murni konkret: bonus kecil
  }
  return score;
}

/**
 * "Judul" klip Pexels — diturunkan dari slug URL (Pexels tak punya field title).
 * Contoh: https://www.pexels.com/video/aerial-view-of-a-city-3209828/ → "aerial view of a city".
 * @param {object} video - Pexels video object
 * @returns {string}
 */
export function clipTitleFromVideo(video) {
  const url = String(video?.url || "");
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // URL parsial/malformed tetap dapat dipakai sebagai fallback tanpa throw.
  }
  const match = pathname.match(/\/video\/(.+?)-\d+\/?$/);
  let slug = match
    ? match[1]
    : pathname.replace(/^https?:\/\/[^/]+\//, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Encoding persen yang rusak tidak boleh menggagalkan seluruh pipeline.
  }
  return slug.replace(/-/g, " ");
}

/**
 * Relevansi klip = jumlah kata keyword unik yang muncul di judul klip Pexels.
 * @param {string[]} keywordTokens - hasil tokenizeWords(visualKeywords)
 * @param {object} video - Pexels video object
 * @returns {number}
 */
export function clipRelevanceScore(keywordTokens, video) {
  if (!keywordTokens?.length) return 0;
  const titleTokens = new Set(tokenizeWords(clipTitleFromVideo(video)));
  if (!titleTokens.size) return 0;
  let hits = 0;
  for (const kw of new Set(keywordTokens)) {
    if (titleTokens.has(kw)) hits += 1;
  }
  return hits;
}

function cleanQuery(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenForms(token) {
  const word = String(token || "").toLowerCase();
  if (!word) return new Set();

  const forms = new Set([word]);
  if (SAFE_PLURAL_TOKENS.has(word)) {
    forms.add(SAFE_PLURAL_TOKENS.get(word));
    return forms;
  }
  return forms;
}

function tokensEquivalent(left, right) {
  const leftForms = tokenForms(left);
  const rightForms = tokenForms(right);
  for (const form of leftForms) {
    if (rightForms.has(form)) return true;
  }
  return false;
}

function uniqueTokens(tokens) {
  const result = [];
  for (const token of tokens) {
    const normalized = String(token || "").toLowerCase();
    if (!normalized || result.some((existing) => tokensEquivalent(existing, normalized))) continue;
    result.push(normalized);
  }
  return result;
}

// Plural matching sengaja berbasis allow-list. Stemming generik akhiran `s`
// membuat nama entitas berbeda terlihat sama (Paris/pari, Hamas/hama,
// BRICS/bric), sehingga false negative lebih aman daripada B-roll salah.
const SAFE_PLURAL_TOKENS = new Map([
  ["analyses", "analysis"],
  ["biases", "bias"],
  ["buses", "bus"],
  ["campuses", "campus"],
  ["cities", "city"],
  ["cookies", "cookie"],
  ["crises", "crisis"],
  ["focuses", "focus"],
  ["gases", "gas"],
  ["horses", "horse"],
  ["houses", "house"],
  ["lenses", "lens"],
  ["movies", "movie"],
  ["pipelines", "pipeline"],
  ["pipes", "pipe"],
  ["refineries", "refinery"],
  ["selfies", "selfie"],
  ["statuses", "status"],
  ["theses", "thesis"],
  ["viruses", "virus"],
  ["workers", "worker"],
  ["zombies", "zombie"]
]);

function canonicalToken(token) {
  const word = String(token || "").toLowerCase();
  return SAFE_PLURAL_TOKENS.get(word) || word;
}

function termTokens(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return uniqueTokens(values.flatMap((entry) => tokenizeWords(entry)));
}

/**
 * Susun maksimal dua query Pexels. Field pexelsQuery yang eksplisit selalu
 * menang; string kosong berarti storyboard sengaja meminta fallback gambar.
 * Query kedua dipersempit ke subjek wajib, bukan sekadar dua kata pertama.
 *
 * @param {object} scene
 * @param {string} [topicFallback]
 * @returns {string[]}
 */
export function buildPexelsQueryPlan(scene = {}, topicFallback = "") {
  const hasExplicitIntent = Object.prototype.hasOwnProperty.call(scene, "pexelsQuery");
  const source = hasExplicitIntent
    ? cleanQuery(scene.pexelsQuery)
    : cleanQuery(scene.visualKeywords) || cleanQuery(topicFallback);

  if (!source) return [];

  const plan = [source];
  const primaryTokens = uniqueTokens(tokenizeWords(source));
  const explicitMustTokens = termTokens(scene.mustMatchTerms);
  const subjectTokens = explicitMustTokens.length
    ? explicitMustTokens
    : primaryTokens.slice(0, Math.min(3, primaryTokens.length));

  const fallbackTokens = uniqueTokens([
    ...subjectTokens,
    ...primaryTokens.filter((token) => (
      !subjectTokens.some((subject) => canonicalToken(subject) === canonicalToken(token))
    ))
  ]).slice(0, Math.max(3, subjectTokens.length));
  const fallback = fallbackTokens.join(" ");

  if (fallback && fallback.toLowerCase() !== source.toLowerCase()) plan.push(fallback);
  return plan.slice(0, 2);
}

function idSet(value) {
  if (value instanceof Set) return new Set([...value].map(String));
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map(String));
}

function matchedTokens(expectedTokens, actualTokens) {
  return expectedTokens.filter((expected) => (
    actualTokens.some((actual) => tokensEquivalent(expected, actual))
  ));
}

/**
 * Nilai satu kandidat secara murni. Sinyal semantik selalu menjadi skor utama;
 * mutu file hanya disimpan sebagai tie-break.
 *
 * @param {object} video
 * @param {object} options
 * @returns {object}
 */
export function scorePexelsCandidate(video, options = {}) {
  const queryTokens = uniqueTokens(tokenizeWords(options.query || ""));
  // SEMUA kecocokan slug (query maupun mustMatchTerms) kini murni sinyal
  // RANKING, bukan gerbang penolakan. Alasan: slug URL Pexels sering generik
  // atau tidak deskriptif (mis. "video-855"), sedangkan hasil pencarian
  // Pexels sendiri SUDAH terurut berdasarkan relevansi query. Menolak
  // kandidat karena slug-nya tidak memuat token membuat hampir semua hasil
  // valid terbuang dan scene jatuh ke gambar AI yang lebih mahal.
  const mustMatchTokens = termTokens(options.mustMatchTerms);
  const titleTokens = uniqueTokens(tokenizeWords(clipTitleFromVideo(video)));
  const matchedQueryTerms = matchedTokens(queryTokens, titleTokens);
  const matchedMustTerms = matchedTokens(mustMatchTokens, titleTokens);
  const matchedTerms = uniqueTokens([...matchedMustTerms, ...matchedQueryTerms]);
  const relevance = queryTokens.length ? matchedQueryTerms.length / queryTokens.length : 0;
  const mustMatchCoverage = mustMatchTokens.length
    ? matchedMustTerms.length / mustMatchTokens.length
    : 1;
  const file = pickBestVideoFile(video);
  const excludedIds = new Set([
    ...idSet(options.usedPexelsIds),
    ...idSet(options.excludedPexelsIds)
  ]);
  const minDurationSec = Math.max(0, Number(options.minDurationSec) || 0);
  const requiredMustMatches = mustMatchTokens.length;

  // Gerbang keras hanya yang TEKNIS: id yang sudah dipakai/di-exclude,
  // durasi kurang, atau tidak ada file mp4 landscape.
  let rejectionReason = "";
  if (excludedIds.has(String(video?.id))) rejectionReason = "excluded-id";
  else if (Number(video?.duration || 0) < minDurationSec) rejectionReason = "duration";
  else if (!file) rejectionReason = "no-landscape-mp4";

  // Slug yang deskriptif dan cocok tetap menang telak lewat bobot skor;
  // slug generik (skor 0) kalah dari yang cocok, dan antar sesama skor 0
  // urutan hasil pencarian Pexels (searchRank) yang menentukan.
  const score = (matchedMustTerms.length * 12)
    + (matchedQueryTerms.length * 3)
    + (mustMatchCoverage === 1 && mustMatchTokens.length ? 2 : 0);

  return {
    video,
    file,
    score,
    relevance,
    mustMatchCoverage,
    requiredMustMatches,
    matchedTerms,
    matchedMustTerms,
    queryTokens,
    eligible: !rejectionReason,
    rejectionReason,
    fileScore: file ? videoFileScore(file) : 0
  };
}

/**
 * Pilih kandidat terbaik secara deterministik.
 *
 * @param {object[]} videos
 * @param {object} options
 * @returns {object|null} hasil scorePexelsCandidate atau null
 */
export function selectPexelsCandidate(videos, options = {}) {
  const ranked = (Array.isArray(videos) ? videos : [])
    .map((video, searchRank) => ({ ...scorePexelsCandidate(video, options), searchRank }))
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => (
      (b.score - a.score)
      || (b.relevance - a.relevance)
      // Pexels mengurutkan hasil berdasarkan relevansi query; saat sinyal slug
      // seri (termasuk sama-sama nol karena slug generik), hormati urutan itu.
      || (a.searchRank - b.searchRank)
      || (b.fileScore - a.fileScore)
      || String(a.video?.id ?? "").localeCompare(String(b.video?.id ?? ""), "en", { numeric: true })
    ));
  return ranked[0] || null;
}

/**
 * Download file video dari URL Pexels ke disk.
 * @param {string} videoUrl - URL file video
 * @param {string} outputPath - Path output lokal
 * @returns {Promise<string>} outputPath
 */
export async function downloadPexelsVideo(videoUrl, outputPath) {
  const outputDir = path.dirname(outputPath);
  const tempPath = path.join(
    outputDir,
    `.${path.basename(outputPath)}.${process.pid}-${randomUUID()}.part`
  );
  await fs.mkdir(outputDir, { recursive: true });
  try {
    const response = await fetch(videoUrl, {
      signal: AbortSignal.timeout(PEXELS_DOWNLOAD_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`Download Pexels video gagal HTTP ${response.status}`);
    }
    const contentType = String(response.headers?.get?.("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (
      contentType
      && !contentType.startsWith("video/")
      && contentType !== "application/octet-stream"
    ) {
      throw new Error(`Download Pexels video ditolak: Content-Type ${contentType} bukan video`);
    }
    const nodeStream = Readable.fromWeb(response.body);
    const writer = createWriteStream(tempPath, { flags: "wx" });
    await pipeline(nodeStream, writer);
    const tempStat = await fs.stat(tempPath);
    if (!tempStat.isFile() || tempStat.size <= 0) {
      throw new Error("Download Pexels video gagal: file hasil kosong atau bukan file reguler");
    }
    // ISO BMFF/MP4 harus dimulai dengan box `ftyp`, memakai major brand yang
    // dikenal, lalu memiliki box top-level kedua yang masuk akal. Pemeriksaan
    // struktur kecil ini menolak HTML/error body yang menyisipkan teks `ftyp`
    // atau file yang terpotong tepat setelah header.
    if (tempStat.size < 24) {
      throw new Error("Download Pexels video ditolak: signature MP4 ftyp tidak ditemukan");
    }
    const tempHandle = await fs.open(tempPath, "r");
    try {
      const ftypHeader = Buffer.alloc(16);
      const { bytesRead: headerBytesRead } = await tempHandle.read(
        ftypHeader,
        0,
        ftypHeader.length,
        0
      );
      const firstBoxSize = headerBytesRead === ftypHeader.length
        ? ftypHeader.readUInt32BE(0)
        : 0;
      const firstBoxType = ftypHeader.toString("ascii", 4, 8);
      const majorBrand = ftypHeader.toString("ascii", 8, 12);
      const knownMajorBrands = new Set([
        "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9",
        "mp41", "mp42", "avc1", "dash", "M4V ", "M4A ", "qt  ",
        "3gp4", "3gp5", "3g2a"
      ]);
      const hasPlausibleFtyp = (
        firstBoxSize >= 16
        && firstBoxSize % 4 === 0
        && firstBoxSize <= tempStat.size - 8
        && firstBoxType === "ftyp"
        && knownMajorBrands.has(majorBrand)
      );
      if (!hasPlausibleFtyp) {
        throw new Error("Download Pexels video ditolak: signature MP4 ftyp tidak ditemukan");
      }

      const nextBoxHeader = Buffer.alloc(8);
      const { bytesRead: nextHeaderBytesRead } = await tempHandle.read(
        nextBoxHeader,
        0,
        nextBoxHeader.length,
        firstBoxSize
      );
      const nextBoxSize = nextHeaderBytesRead === nextBoxHeader.length
        ? nextBoxHeader.readUInt32BE(0)
        : 0;
      const nextBoxType = nextBoxHeader.toString("ascii", 4, 8);
      const knownNextBoxTypes = new Set(["moov", "mdat", "free", "skip", "wide", "moof"]);
      const remainingBytes = tempStat.size - firstBoxSize;
      const hasPlausibleNextBox = (
        nextHeaderBytesRead === nextBoxHeader.length
        && knownNextBoxTypes.has(nextBoxType)
        && (
          nextBoxSize === 0
          || (nextBoxSize >= 8 && nextBoxSize <= remainingBytes)
        )
      );
      if (!hasPlausibleNextBox) {
        throw new Error("Download Pexels video ditolak: struktur MP4 terpotong atau tidak valid");
      }
    } finally {
      await tempHandle.close();
    }
    await fs.rename(tempPath, outputPath);
    return outputPath;
  } catch (error) {
    // Hanya bersihkan file parsial milik percobaan ini. Destination yang sudah
    // valid tidak boleh rusak ketika network/stream gagal.
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Cari dan download satu klip video Pexels untuk sebuah scene.
 * @param {object} params
 * @param {string} params.itemId - ID item
 * @param {object} params.scene - Scene object dari storyboard
 * @param {string} [params.topicFallback] - Fallback query jika visualKeywords kosong
 * @param {Array|Set} [params.usedPexelsIds] - ID yang sudah dipakai
 * @param {Array|Set} [params.excludedPexelsIds] - ID yang tidak boleh dipilih
 * @param {Function} [params.onAudit] - Callback audit tanpa mengubah return contract
 * @returns {Promise<object|null>} metadata clip atau null untuk fallback gambar
 */
export async function fetchPexelsClipForScene({
  itemId,
  scene,
  topicFallback = "",
  usedPexelsIds = [],
  excludedPexelsIds = [],
  onAudit
}) {
  const emitAudit = (audit) => {
    if (typeof onAudit !== "function") return;
    try {
      onAudit(audit);
    } catch {
      // Audit observability tidak boleh menggagalkan pencarian media.
    }
  };
  const queryPlan = buildPexelsQueryPlan(scene, topicFallback)
    .slice(0, config.pexels.maxQueryAttempts || 2);
  if (!queryPlan.length) {
    console.log(`[Pexels] Scene ${scene.index} tidak memiliki intent video; gunakan fallback gambar.`);
    emitAudit({ status: "image-fallback", query: "", fallbackReason: "no-search-intent" });
    return null;
  }

  assertPexels();
  const clipsDir = path.join(paths.generatedDir, "clips");
  await fs.mkdir(clipsDir, { recursive: true });

  const queryAttemptLog = [];
  let accepted = null;
  let acceptedQuery = "";
  let candidateCount = 0;

  for (const query of queryPlan) {
    let videos = [];
    try {
      // Rotasi halaman 1-3 agar tidak selalu mendapat klip yang sama di semua scene.
      const page = (Number(scene.index || 0) % 3) + 1;
      videos = await searchPexelsVideos(query, {
        orientation: "landscape",
        size: "medium",
        locale: config.pexels.locale,
        page,
        perPage: config.pexels.maxResultsPerScene
      });
    } catch (error) {
      queryAttemptLog.push({ query, candidateCount: 0, accepted: false, error: error.message });
      console.warn(`[Pexels] Search gagal untuk scene ${scene.index} (query: "${query}"): ${error.message}`);
      continue;
    }

    candidateCount += videos.length;
    const candidate = selectPexelsCandidate(videos, {
      query,
      mustMatchTerms: scene.mustMatchTerms,
      minDurationSec: config.pexels.minDurationSec,
      minRelevance: config.pexels.minRelevance,
      usedPexelsIds,
      excludedPexelsIds
    });
    queryAttemptLog.push({
      query,
      candidateCount: videos.length,
      accepted: Boolean(candidate),
      score: candidate?.score || 0,
      relevance: candidate?.relevance || 0,
      matchedTerms: candidate?.matchedTerms || []
    });

    if (candidate) {
      accepted = candidate;
      acceptedQuery = query;
      break;
    }
    console.warn(`[Pexels] Tidak ada kandidat layak untuk scene ${scene.index} (query: "${query}", hasil=${videos.length}).`);
  }

  if (!accepted) {
    console.warn(`[Pexels] Scene ${scene.index} jatuh ke gambar setelah ${queryAttemptLog.length} query.`);
    const searchOnlyFailed = queryAttemptLog.length > 0
      && queryAttemptLog.every((attempt) => Boolean(attempt.error));
    emitAudit({
      status: "image-fallback",
      query: queryAttemptLog.at(-1)?.query || queryPlan[0],
      fallbackReason: searchOnlyFailed ? "search-error" : "no-relevant-candidate"
    });
    return null;
  }

  const chosen = accepted.video;
  const bestFile = accepted.file;

  const segSuffix = typeof scene.segmentIndex === "number" ? `-seg-${scene.segmentIndex}` : "";
  const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}${segSuffix}-pexels-${chosen.id}.mp4`;
  const outputPath = path.join(clipsDir, filename);

  try {
    await downloadPexelsVideo(bestFile.link, outputPath);
    console.log(`[Pexels] Downloaded scene ${scene.index} seg ${scene.segmentIndex || 0}: ${bestFile.width}x${bestFile.height} (${chosen.id}) score=${accepted.score} relevance=${accepted.relevance.toFixed(2)} query="${acceptedQuery}"`);
    emitAudit({ status: "selected", query: acceptedQuery });
    return {
      sceneIndex: scene.index,
      segmentIndex: scene.segmentIndex || 0,
      provider: "pexels",
      selectorVersion: PEXELS_SELECTOR_VERSION,
      pexelsId: chosen.id,
      pexelsUrl: chosen.url,
      query: acceptedQuery,
      queryAttempts: queryAttemptLog.length,
      queryAttemptLog,
      candidateCount,
      score: accepted.score,
      relevance: accepted.relevance,
      matchedTerms: accepted.matchedTerms,
      width: bestFile.width,
      height: bestFile.height,
      path: outputPath,
      url: `/generated/clips/${filename}`
    };
  } catch (error) {
    console.warn(`[Pexels] Download gagal scene ${scene.index}: ${error.message}`);
    emitAudit({ status: "image-fallback", query: acceptedQuery, fallbackReason: "download-error" });
    return null;
  }
}
