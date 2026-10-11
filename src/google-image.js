/**
 * google-image.js
 * Modul resmi untuk pencarian gambar langsung dari Google Images via API.
 *
 * Provider yang didukung:
 *  1. Google Custom Search JSON API (Official Google Images API)
 *     - Memerlukan GOOGLE_CSE_KEY (API Key) dan GOOGLE_CSE_CX (Search Engine ID).
 *     - 100 pencarian gratis per hari.
 *  2. Serper.dev Images API (Google Images scraper API)
 *     - Memerlukan SERPER_API_KEY (2.500 pencarian gratis).
 *  3. SerpApi (Google Images Engine)
 *     - Memerlukan SERPAPI_API_KEY (100 pencarian gratis/bulan).
 *
 * Fitur:
 *  - Pencarian multi-kandidat beresolusi tinggi dengan fallback thumbnail CDN Google.
 *  - Filter otomatis untuk logo/ikon Google News dan file tidak cocok (svg, ico).
 *  - Multi-attempt download dengan header anti-hotlink (Referer & User-Agent).
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { isGoogleLogo } from "./news-research.js";
import { isValidImageBuffer } from "./util.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DL_TIMEOUT_MS = 15_000;

/**
 * Cek apakah salah satu API Google Image telah dikonfigurasi.
 */
export function isGoogleImageApiAvailable() {
  const hasGoogleCse = Boolean(
    (process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_SEARCH_API_KEY) &&
    (process.env.GOOGLE_CSE_CX || process.env.GOOGLE_SEARCH_ENGINE_ID)
  );
  const hasSerper = getSerperKeys().length > 0;
  const hasSerpApi = Boolean(process.env.SERPAPI_API_KEY);
  return hasGoogleCse || hasSerper || hasSerpApi;
}

/**
 * Deteksi apakah query pencarian hanyalah kata placeholder/dummy generik
 * (misal "Fakta 1", "Fakta 2", "Intro", "Scene 1", "Temuan Baru") yang tidak memiliki
 * nilai visual nyata, untuk mencegah pemborosan kuota API pencarian gambar.
 */
export function isGenericPlaceholderQuery(text) {
  if (!text || typeof text !== "string") return true;
  const clean = text.trim().toLowerCase();
  if (clean.length < 3 || /^\d+$/.test(clean)) return true;
  const placeholderRegex = /^(fakta\s*\d*|intro\w*|outro\w*|hook\w*|penutup\w*|pembuka\w*|scene\s*\d*|segmen\s*\d*|temuan\s*baru|berita\s*terkini|dokumen\s*referensi|pembahasan\s*utama|informasi\s*\d*|poin\s*\d*|subtopik\s*\d*)$/i;
  return placeholderRegex.test(clean);
}

/**
 * Bersihkan string pencarian untuk query Google Images.
 */
export function cleanSearchQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") return "";
  return rawQuery
    .replace(/<[^>]+>/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

let googleCseBlocked = false;

/**
 * Cari gambar di Google Images via Google Custom Search JSON API.
 * @param {string} query
 * @param {object} options
 * @returns {Promise<Array<{imageUrl: string, thumbnail: string|null, title: string, source: string, contextUrl: string, width: number, height: number}>>}
 */
async function searchViaGoogleCse(query, options = {}) {
  if (googleCseBlocked) return [];
  const apiKey = process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX || process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!apiKey || !cx) return [];

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const num = Math.min(10, Math.max(1, options.num || 5));

  try {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("num", String(num));
    url.searchParams.set("safe", options.safe || "active");
    url.searchParams.set("hl", options.hl || "id");
    url.searchParams.set("gl", options.gl || "id");
    if (options.imgType) url.searchParams.set("imgType", options.imgType);
    if (options.imgSize) url.searchParams.set("imgSize", options.imgSize);

    const res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      if (res.status === 403) {
        googleCseBlocked = true;
        console.warn(`[GoogleImage] Google CSE HTTP 403 (layanan ditutup Google untuk akun baru). Mengalihkan otomatis ke Serper.`);
      } else {
        console.warn(`[GoogleImage] Google CSE HTTP ${res.status} untuk query "${query}": ${res.statusText}`);
      }
      return [];
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const results = [];

    for (const item of items) {
      const link = item.link;
      if (!link || typeof link !== "string" || !link.startsWith("http")) continue;
      const lower = link.toLowerCase();
      if (lower.endsWith(".svg") || lower.endsWith(".ico") || lower.includes("favicon")) continue;
      if (isGoogleLogo(link)) continue;

      results.push({
        imageUrl: link,
        thumbnail: item.image?.thumbnailLink || null,
        title: String(item.title || "").trim(),
        source: String(item.displayLink || "").trim(),
        contextUrl: item.image?.contextLink || "",
        width: Number(item.image?.width) || 0,
        height: Number(item.image?.height) || 0
      });
    }

    return results;
  } catch (err) {
    console.warn(`[GoogleImage] Google CSE error untuk query "${query}": ${err.message}`);
    return [];
  }
}

let serperKeyIndex = 0;
const exhaustedSerperKeys = new Set();

export function getSerperKeys() {
  const raw = process.env.SERPER_API_KEYS || process.env.SERPER_API_KEY || "";
  return raw.split(",").map(k => k.trim()).filter(Boolean);
}

/**
 * Cari gambar via Serper.dev (Google Images search API alternatif).
 * Mendukung Round-Robin dan auto-failover multi-akun/multi-kunci (dipisahkan koma).
 */
async function searchViaSerper(query, options = {}) {
  const allKeys = getSerperKeys();
  if (!allKeys.length) return [];

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const num = Math.min(10, Math.max(1, options.num || 5));

  // Ambil key yang belum tercatat habis, atau reset jika semua tercatat habis
  let availableKeys = allKeys.filter(k => !exhaustedSerperKeys.has(k));
  if (!availableKeys.length) {
    exhaustedSerperKeys.clear();
    availableKeys = allKeys;
  }

  // Putar kunci secara Round-Robin dengan failover otomatis
  for (let attempt = 0; attempt < availableKeys.length; attempt++) {
    const key = availableKeys[(serperKeyIndex + attempt) % availableKeys.length];

    try {
      const res = await fetchImpl("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: query,
          gl: options.gl?.toLowerCase() || "id",
          hl: options.hl || "id",
          num
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!res.ok) {
        if (res.status === 400 || res.status === 403 || res.status === 429) {
          exhaustedSerperKeys.add(key);
          console.warn(`[GoogleImage] Serper key (${key.slice(0, 8)}...) HTTP ${res.status} (kredit habis/invalid). Auto-failover ke key berikutnya...`);
          continue;
        }
        continue;
      }

      // Majukan index round-robin untuk panggilan berikutnya
      serperKeyIndex = (serperKeyIndex + attempt + 1) % availableKeys.length;

      const data = await res.json();
      const images = Array.isArray(data.images) ? data.images : [];
      const results = [];

      for (const item of images) {
        const link = item.imageUrl;
        if (!link || typeof link !== "string" || !link.startsWith("http")) continue;
        const lower = link.toLowerCase();
        if (lower.endsWith(".svg") || lower.endsWith(".ico") || lower.includes("favicon")) continue;
        if (isGoogleLogo(link)) continue;

        results.push({
          imageUrl: link,
          thumbnail: item.thumbnailUrl || null,
          title: String(item.title || "").trim(),
          source: String(item.source || "").trim(),
          contextUrl: item.link || "",
          width: Number(item.imageWidth) || 0,
          height: Number(item.imageHeight) || 0
        });
      }

      if (results.length) return results;
    } catch (err) {
      console.warn(`[GoogleImage] Serper error dengan key (${key.slice(0, 8)}...) untuk query "${query}": ${err.message}`);
    }
  }

  return [];
}

/**
 * Cari gambar via SerpApi (Google Images).
 */
async function searchViaSerpApi(query, options = {}) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return [];

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  try {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_images");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("gl", options.gl?.toLowerCase() || "id");
    url.searchParams.set("hl", options.hl || "id");

    const res = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) return [];
    const data = await res.json();
    const images = Array.isArray(data.images_results) ? data.images_results : [];
    const results = [];

    for (const item of images) {
      const link = item.original || item.link;
      if (!link || typeof link !== "string" || !link.startsWith("http")) continue;
      const lower = link.toLowerCase();
      if (lower.endsWith(".svg") || lower.endsWith(".ico") || lower.includes("favicon")) continue;
      if (isGoogleLogo(link)) continue;

      results.push({
        imageUrl: link,
        thumbnail: item.thumbnail || null,
        title: String(item.title || "").trim(),
        source: String(item.source || "").trim(),
        contextUrl: item.link || "",
        width: 0,
        height: 0
      });
    }

    return results;
  } catch (err) {
    console.warn(`[GoogleImage] SerpApi error untuk query "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Cari kumpulan kandidat gambar dari Google Images API.
 * Mendukung fallback queries secara berurutan jika query utama tidak menghasilkan hasil.
 *
 * @param {string} query - Query utama (misal judul headline atau topik)
 * @param {object} options
 * @param {string[]} [options.fallbackQueries] - Query alternatif jika query utama kosong
 * @returns {Promise<Array<{imageUrl: string, thumbnail: string|null, title: string, source: string, contextUrl: string, width: number, height: number}>>}
 */
export async function searchGoogleImages(query, options = {}) {
  const mainQuery = cleanSearchQuery(query);
  const rawQueries = [mainQuery, ...(options.fallbackQueries || []).map(cleanSearchQuery)].filter(Boolean);
  const validQueries = rawQueries.filter((q) => !isGenericPlaceholderQuery(q));
  const uniqueQueries = [...new Set(validQueries)];

  if (!uniqueQueries.length) {
    return [];
  }

  for (const q of uniqueQueries) {
    // 1. Coba Google Custom Search API
    let results = await searchViaGoogleCse(q, options);
    if (results.length) {
      console.log(`[GoogleImage] Google CSE: "${q}" → ${results.length} gambar ditemukan`);
      return results;
    }

    // 2. Coba Serper.dev jika CSE tidak aktif/habis
    results = await searchViaSerper(q, options);
    if (results.length) {
      console.log(`[GoogleImage] Serper: "${q}" → ${results.length} gambar ditemukan`);
      return results;
    }

    // 3. Coba SerpApi jika ada
    results = await searchViaSerpApi(q, options);
    if (results.length) {
      console.log(`[GoogleImage] SerpApi: "${q}" → ${results.length} gambar ditemukan`);
      return results;
    }

    // 4. Cadangan Abadi: Bing Images (Microsoft) — Gratis, Unlimited, Legal & Bebas Blokir di Indonesia
    results = await searchViaBingImages(q, options);
    if (results.length) {
      console.log(`[GoogleImage] Bing Images: "${q}" → ${results.length} gambar ditemukan`);
      return results;
    }
  }

  return [];
}

/**
 * Cari gambar via Bing Images (Microsoft) — 100% GRATIS, tanpa API key, unlimited.
 * Sepenuhnya legal dan bebas blokir di seluruh jaringan Indonesia.
 */
export async function searchViaBingImages(query, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const num = Math.min(10, Math.max(1, options.num || 5));

  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2`;
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const matches = [...html.matchAll(/murl&quot;:&quot;(https?:[^&]+?)&quot;.*?turl&quot;:&quot;(https?:[^&]+?)&quot;.*?t&quot;:&quot;([^&]+?)&quot;.*?desc&quot;:&quot;([^&]+?)&quot;/g)];
    const rawMatches = matches.length ? matches : [...html.matchAll(/murl&quot;:&quot;(https?:[^&]+?)&quot;/g)];

    for (const match of rawMatches) {
      const link = match[1];
      if (!link || typeof link !== "string" || !link.startsWith("http")) continue;
      const lower = link.toLowerCase();
      if (lower.endsWith(".svg") || lower.endsWith(".ico") || lower.includes("favicon")) continue;
      if (isGoogleLogo(link)) continue;

      let host = "";
      try { host = new URL(link).hostname.replace(/^www\./, ""); } catch {}

      results.push({
        imageUrl: link,
        thumbnail: match[2] || null,
        title: match[3] || match[4] || `${query} (${host})`,
        source: host || "Bing Images",
        contextUrl: link,
        width: 0,
        height: 0
      });

      if (results.length >= num) break;
    }

    return results;
  } catch (err) {
    console.warn(`[GoogleImage] Bing Images error untuk query "${query}": ${err.message}`);
    return [];
  }
}

/**
 * Ambil satu URL gambar terbaik dari Google Images.
 * @param {string} query
 * @param {object} options
 * @returns {Promise<{imageUrl: string, thumbnail: string|null, title: string, source: string, contextUrl: string}|null>}
 */
export async function fetchGoogleImageUrl(query, options = {}) {
  const results = await searchGoogleImages(query, options);
  return results[0] || null;
}

/**
 * Unduh gambar dari daftar kandidat hasil Google Images.
 * Mencoba resolusi penuh terlebih dahulu dengan header anti-hotlink (Referer + User-Agent).
 * Jika situs media memblokir hotlinking (HTTP 403), secara otomatis mencoba kandidat berikutnya
 * atau thumbnail CDN Google (encrypted-tbn0.gstatic.com) yang dijamin tidak pernah diblokir.
 *
 * @param {Array|object} candidates - Kandidat dari searchGoogleImages atau objek tunggal
 * @param {string} destPath - Path tujuan penyimpanan file lokal
 * @param {object} options
 * @returns {Promise<{success: boolean, url?: string, title?: string, source?: string, error?: string}>}
 */
export async function downloadImageWithCandidates(candidates, destPath, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [candidates].filter(Boolean);
  if (!list.length) return { success: false, error: "Tidak ada kandidat gambar" };

  const excludedUrls = options.excludedUrls instanceof Set
    ? options.excludedUrls
    : new Set(Array.isArray(options.excludedUrls) ? options.excludedUrls : []);

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DL_TIMEOUT_MS;

  for (const item of list) {
    // Jika semua URL kandidat ini sudah pernah dipakai di adegan lain, lewati ke kandidat berikutnya
    const itemUrls = [item.imageUrl, item.thumbnail].filter(Boolean);
    if (itemUrls.length && itemUrls.every((u) => excludedUrls.has(u))) {
      continue;
    }

    // Coba URL asli resolusi tinggi dulu (yang belum pernah dipakai), lalu thumbnail Google CDN (yang belum dipakai)
    const attemptUrls = itemUrls.filter((u) => !excludedUrls.has(u));
    if (!attemptUrls.length) continue;

    for (const url of attemptUrls) {
      if (excludedUrls.has(url)) continue;
      try {
        const headers = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        };
        try {
          const parsed = new URL(url);
          headers["Referer"] = `${parsed.origin}/`;
        } catch {
          // Abaikan jika parse URL gagal
        }

        const res = await fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow"
        });

        if (!res.ok) continue;

        const contentType = res.headers?.get ? (res.headers.get("content-type") || "") : "";
        if (contentType.includes("text/html") || contentType.includes("text/plain") || contentType.includes("application/json")) {
          continue;
        }

        let buffer;
        if (typeof res.arrayBuffer === "function") {
          const ab = await res.arrayBuffer();
          buffer = Buffer.from(ab);
        } else if (res.body) {
          const chunks = [];
          for await (const chunk of res.body) {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          }
          buffer = Buffer.concat(chunks);
        } else {
          continue;
        }

        if (!isValidImageBuffer(buffer)) {
          continue;
        }

        // Pastikan direktori tujuan ada
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, buffer);

        return {
          success: true,
          url,
          title: item.title,
          source: item.source
        };
      } catch (err) {
        // Lanjutkan ke kandidat berikutnya
      }
    }
  }

  await fs.unlink(destPath).catch(() => {});
  return { success: false, error: "Semua kandidat gambar gagal diunduh" };
}
