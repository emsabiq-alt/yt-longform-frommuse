/**
 * YouTube Trends — mengambil data trending dari YouTube Data API v3
 * menggunakan OAuth token atau API key, lalu mengekstrak tema abstrak
 * yang relevan dengan niche edukasi BanyakTau.
 *
 * Strategi: kombinasi mostPopular + search query niche-specific.
 * Quota hemat: ~5-8 unit per run.
 */

import { config } from "./config.js";
import { requestTrendJsonWithFallback } from "./deepseek.js";
import { cleanText } from "./util.js";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** Search queries yang relevan dengan kategori BanyakTau. */
const NICHE_SEARCH_QUERIES = [
  "fakta menarik",
  "pengetahuan unik",
  "sains terbaru",
  "sejarah dunia",
  "kenapa bisa terjadi",
  "teknologi masa depan",
  "misteri belum terpecahkan",
  "rahasia tersembunyi",
  "edukasi Indonesia"
];

/**
 * Dapatkan access token dari OAuth refresh token.
 * Fallback ke API key jika OAuth tidak tersedia.
 */
async function getAuthHeaders() {
  // Prioritas 1: OAuth refresh token (sudah ada di project)
  const clientId = config.youtube.clientId;
  const clientSecret = config.youtube.clientSecret;
  const refreshToken = config.youtube.refreshToken;

  if (clientId && clientSecret && refreshToken) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token"
        })
      });
      if (res.ok) {
        const { access_token } = await res.json();
        if (access_token) return { Authorization: `Bearer ${access_token}` };
      }
    } catch (error) {
      console.warn(`[Trends] OAuth token gagal: ${error.message}`);
    }
  }

  // Prioritas 2: API key
  const apiKey = config.youtube.dataApiKey;
  if (apiKey) return { __apiKey: apiKey };

  return null;
}

/**
 * Fetch dari YouTube API dengan auth yang tersedia.
 */
async function ytFetch(endpoint, params = {}) {
  const auth = await getAuthHeaders();
  if (!auth) return null;

  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Jika pakai API key, tambahkan ke URL
  if (auth.__apiKey) {
    url.searchParams.set("key", auth.__apiKey);
    delete auth.__apiKey;
  }

  try {
    const res = await fetch(url, { headers: auth, cache: "no-store" });
    if (!res.ok) {
      console.warn(`[Trends] API ${endpoint} error ${res.status}`);
      return null;
    }
    return res.json();
  } catch (error) {
    console.warn(`[Trends] API ${endpoint} gagal: ${error.message}`);
    return null;
  }
}

/**
 * Ambil video trending dari kategori tertentu.
 */
async function fetchTrendingByCategory(regionCode, categoryId = "") {
  const params = {
    part: "snippet,statistics",
    chart: "mostPopular",
    regionCode,
    maxResults: "15"
  };
  if (categoryId) params.videoCategoryId = categoryId;

  const data = await ytFetch("videos", params);
  return parseVideoItems(data?.items || []);
}

/**
 * Search video populer minggu ini berdasarkan query niche.
 */
async function searchNicheVideos(regionCode, query) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const data = await ytFetch("search", {
    part: "snippet",
    q: query,
    type: "video",
    regionCode,
    order: "viewCount",
    publishedAfter: weekAgo,
    maxResults: "5",
    relevanceLanguage: "id"
  });
  return (data?.items || []).map((item) => ({
    videoId: item.id?.videoId || "",
    title: item.snippet?.title || "",
    channelTitle: item.snippet?.channelTitle || "",
    tags: [],
    categoryId: "",
    publishedAt: item.snippet?.publishedAt || "",
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    searchQuery: query
  }));
}

function parseVideoItems(items) {
  return items.map((item) => ({
    videoId: item.id?.videoId || item.id || "",
    title: item.snippet?.title || "",
    channelTitle: item.snippet?.channelTitle || "",
    tags: item.snippet?.tags || [],
    categoryId: item.snippet?.categoryId || "",
    publishedAt: item.snippet?.publishedAt || "",
    viewCount: Number(item.statistics?.viewCount || 0),
    likeCount: Number(item.statistics?.likeCount || 0),
    commentCount: Number(item.statistics?.commentCount || 0)
  }));
}

/**
 * Ambil trending dari beberapa sumber dan gabungkan.
 * 1. mostPopular kategori Education (27) dan Science & Tech (28)
 * 2. Search niche queries (fakta menarik, sains, sejarah, dll)
 */
export async function fetchMultiCategoryTrending(regionCode = "ID") {
  const allVideos = [];
  const seenIds = new Set();

  function addUnique(videos) {
    for (const v of videos) {
      const id = v.videoId || v.title;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        allVideos.push(v);
      }
    }
  }

  // 1. Trending kategori Education & Science.
  // Catatan: chart=mostPopular dengan videoCategoryId mengembalikan 404 untuk
  // beberapa region (termasuk ID). Jika keduanya kosong, fallback ke chart
  // umum tanpa kategori lalu saring ke kategori edukasi/sains di sisi kita.
  console.log("[Trends] Fetching trending Education & Science...");
  const [edu, sci] = await Promise.all([
    fetchTrendingByCategory(regionCode, "27"),
    fetchTrendingByCategory(regionCode, "28")
  ]);
  addUnique(edu);
  addUnique(sci);

  if (!edu.length && !sci.length) {
    console.log("[Trends] Chart per-kategori tidak tersedia untuk region ini, fallback ke chart umum...");
    const general = await fetchTrendingByCategory(regionCode);
    addUnique(general.filter((v) => v.categoryId === "27" || v.categoryId === "28"));
  }

  // 2. Search niche queries — pilih 4 random agar hemat quota
  const shuffled = [...NICHE_SEARCH_QUERIES].sort(() => Math.random() - 0.5);
  const selectedQueries = shuffled.slice(0, 4);
  console.log(`[Trends] Searching niche: ${selectedQueries.join(", ")}...`);

  for (const query of selectedQueries) {
    const results = await searchNicheVideos(regionCode, query);
    addUnique(results);
  }

  // Sort by view count, tapi search results tanpa viewCount tetap masuk
  allVideos.sort((a, b) => b.viewCount - a.viewCount);
  console.log(`[Trends] Total ${allVideos.length} video terkumpul.`);
  return allVideos.slice(0, 40);
}

/**
 * Gunakan DeepSeek (OpenAI sebagai fallback) untuk mengekstrak tema abstrak
 * dari judul-judul trending.
 * Fokus pada tema yang RELEVAN untuk channel edukasi BanyakTau.
 */
export async function extractTrendingThemes(videos) {
  if (!videos.length) return { themes: [], topKeywords: [], trendingScore: 0 };

  const titlesBlock = videos
    .slice(0, 25)
    .map((v, i) => {
      const metrics = [
        v.viewCount ? `${formatViewCount(v.viewCount)} views` : "baru",
        v.likeCount ? `${formatViewCount(v.likeCount)} likes` : "",
        v.commentCount ? `${formatViewCount(v.commentCount)} comments` : ""
      ].filter(Boolean).join(", ");
      const source = v.searchQuery ? `[search: ${v.searchQuery}]` : "[trending]";
      return `${i + 1}. ${source} "${v.title}" (${metrics})`;
    })
    .join("\n");

  const tagsBlock = [...new Set(videos.flatMap((v) => v.tags))]
    .filter(Boolean)
    .slice(0, 40)
    .join(", ");

  const prompt = [
    "Analisis daftar video YouTube trending dan populer Indonesia berikut.",
    "Ekstrak TEMA yang bisa menjadi inspirasi video EDUKASI channel BanyakTau.",
    "",
    "Konteks channel BanyakTau: video longform edukasi bahasa Indonesia.",
    "Kategori konten: sains, sejarah, teknologi, psikologi, tubuh manusia, alam semesta,",
    "penemuan, ekonomi, misteri, arsitektur, transportasi, energi, ekologi, bahasa dan budaya.",
    "",
    "DAFTAR VIDEO TRENDING/POPULER:",
    titlesBlock,
    "",
    tagsBlock ? `TAG POPULER: ${tagsBlock}` : "",
    "",
    "INSTRUKSI:",
    "1. ABAIKAN video musik, sinetron, gaming, dan vlog yang tidak edukasi.",
    "2. Fokus HANYA pada tema yang bisa diangkat sebagai video edukasi mendalam.",
    "3. Dari setiap video yang relevan, abstraksi ke TEMA UNIVERSAL (bukan copy judul).",
    "   Tema harus berlaku global: JANGAN terpaku pada kota, daerah, tokoh, atau peristiwa",
    "   lokal Indonesia dari judul trending. Contoh: video tentang banjir Jakarta diabstraksi",
    "   menjadi 'kenapa kota-kota besar dunia kesulitan mengendalikan banjir', bukan tema tentang Jakarta.",
    "4. Beri sudut pandang spesifik yang menarik untuk video 6-10 menit.",
    "5. Skor relevansi: 80-100 sangat cocok, 60-79 cukup cocok, <60 skip.",
    "6. Gunakan views, likes, dan comments sebagai sinyal ketertarikan. Bedakan tema yang banyak ditonton dari tema yang engagement-nya kuat.",
    "7. Berikan keywords trending bahasa Indonesia untuk SEO.",
    "",
    "Kembalikan JSON valid:",
    '{ "themes": [{ "theme": "string", "relevance": 0-100, "angle": "sudut edukasi spesifik", "category": "kategori BanyakTau yang cocok" }], "topKeywords": ["string"], "overallScore": 0-100 }'
  ].filter(Boolean).join("\n");

  try {
    const aiResult = await requestTrendJsonWithFallback(prompt);
    const result = aiResult.data;
    return {
      themes: Array.isArray(result?.themes)
        ? result.themes.filter((t) => t?.theme && t.relevance >= 50).sort((a, b) => b.relevance - a.relevance)
        : [],
      topKeywords: Array.isArray(result?.topKeywords) ? result.topKeywords.slice(0, 15) : [],
      trendingScore: Number(result?.overallScore) || 0,
      aiProvider: aiResult.provider
    };
  } catch (error) {
    console.warn(`[Trends] Ekstraksi tema gagal: ${error.message}`);
    return { themes: [], topKeywords: [], trendingScore: 0 };
  }
}

/**
 * Fungsi utama: ambil trending + ekstrak tema.
 * Gracefully returns empty context jika auth tidak tersedia.
 */
export async function buildTrendingContext() {
  // Cek apakah ada auth (OAuth atau API key)
  const hasOAuth = config.youtube.clientId && config.youtube.clientSecret && config.youtube.refreshToken;
  const hasApiKey = Boolean(config.youtube.dataApiKey);

  if ((!hasOAuth && !hasApiKey) || !config.youtube.trendingEnabled) {
    return { themes: [], topKeywords: [], trendingScore: 0, videos: [], enabled: false };
  }

  console.log("[Trends] Mengambil data trending YouTube Indonesia...");
  const regionCode = config.youtube.trendingRegion || "ID";
  const videos = await fetchMultiCategoryTrending(regionCode);

  if (!videos.length) {
    console.log("[Trends] Tidak ada data trending.");
    return { themes: [], topKeywords: [], trendingScore: 0, videos: [], enabled: true };
  }

  console.log(`[Trends] ${videos.length} video ditemukan. Mengekstrak tema edukasi...`);
  const { themes, topKeywords, trendingScore } = await extractTrendingThemes(videos);

  console.log(`[Trends] ${themes.length} tema edukasi diekstrak, skor: ${trendingScore}/100`);
  for (const t of themes.slice(0, 5)) {
    console.log(`  - [${t.relevance}] "${t.theme}" → ${t.angle} (${t.category})`);
  }

  return { themes, topKeywords, trendingScore, videos, enabled: true };
}

/**
 * Format trending context jadi teks untuk diinjeksi ke prompt topic-engine.
 */
export function formatTrendingForPrompt(context) {
  if (!context?.themes?.length) return "";

  const themeLines = context.themes
    .slice(0, 6)
    .map((t) => `- ${t.theme} [kategori: ${t.category || "umum"}] (sudut: ${t.angle})`)
    .join("\n");

  const keywordLine = context.topKeywords?.length
    ? `Keywords trending: ${context.topKeywords.slice(0, 10).join(", ")}`
    : "";

  return [
    "SINYAL TRENDING YouTube Indonesia saat ini (khusus edukasi):",
    themeLines,
    keywordLine,
    "",
    "INSTRUKSI TRENDING:",
    "- Gunakan tema trending sebagai INSPIRASI sudut pandang, JANGAN copy judul trending.",
    "- Buat topik yang related dengan tren tapi dari sudut EDUKASI MENDALAM.",
    "- Topik hasil akhir harus UNIVERSAL (menarik bagi siapa pun di negara mana pun),",
    "  jangan sempitkan ke kota/daerah/tokoh lokal dari judul trending.",
    "- Fokus pada angle 'kenapa', 'bagaimana', atau 'rahasia di balik' dari tema trending.",
    "- Jika tidak ada tema yang cocok, abaikan dan usulkan berdasarkan kategori."
  ].filter(Boolean).join("\n");
}

/**
 * Format trending keywords untuk YouTube tags/SEO.
 */
export function getTrendingSeoKeywords(context) {
  if (!context?.topKeywords?.length) return [];
  return context.topKeywords
    .filter((kw) => kw && kw.length > 2 && kw.length < 40)
    .slice(0, 8);
}

function formatViewCount(count) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}
