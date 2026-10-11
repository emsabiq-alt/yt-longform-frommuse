/**
 * pixabay.js
 * Integrasi Pixabay REST API untuk video B-roll dan gambar stock gratis.
 *
 * Mendukung pencarian video (MP4 landscape 1080p/720p) dan foto horizontal,
 * dilengkapi seleksi resolusi terbaik, unduhan atomic (.part -> rename),
 * serta metadata lengkap untuk atribusi lisensi di YouTube.
 *
 * Docs: https://pixabay.com/api/docs/
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config, paths } from "./config.js";
import { cleanText } from "./util.js";

const PIXABAY_VIDEOS_URL = "https://pixabay.com/api/videos/";
const PIXABAY_IMAGES_URL = "https://pixabay.com/api/";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

function apiKey() {
  return config.pixabay?.apiKey || "57557703-d564c9ce2e7c62284ab235767";
}

/**
 * Cari video stock di Pixabay.
 * @param {string} query - Kata kunci pencarian (Inggris diutamakan)
 * @param {object} options
 * @returns {Promise<object[]>} Array of Pixabay video hit objects
 */
export async function searchPixabayVideos(query, options = {}) {
  const key = options.apiKey || apiKey();
  if (!key) throw new Error("PIXABAY_API_KEY belum diisi.");

  const cleanQuery = cleanText(query || "", 100);
  if (!cleanQuery) return [];

  const url = new URL(PIXABAY_VIDEOS_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(Math.max(3, Math.min(50, options.perPage || config.pixabay?.maxResults || 15))));
  url.searchParams.set("video_type", options.videoType || "all");

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || config.pixabay?.timeoutMs || DEFAULT_TIMEOUT_MS;

  const response = await fetchImpl(url.toString(), {
    headers: { "User-Agent": "yt-longform-studio/1.0" },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Pixabay video search error HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  return Array.isArray(data.hits) ? data.hits : [];
}

/**
 * Pilih varian video terbaik dari sebuah hit Pixabay (prioritas 1080p -> 720p landscape).
 */
export function pickBestPixabayVideoFile(hit) {
  if (!hit || !hit.videos) return null;
  const variants = [
    hit.videos.medium,
    hit.videos.large,
    hit.videos.small,
    hit.videos.tiny
  ].filter(Boolean);

  const candidates = variants.filter((v) => (
    v.url
    && Number(v.width || 0) >= Number(v.height || 0) // landscape
  ));

  if (!candidates.length) return null;

  // Skor: preferensi 720p - 1080p
  candidates.sort((a, b) => {
    const hA = Number(a.height || 0);
    const hB = Number(b.height || 0);
    const scoreA = (hA >= 720 && hA <= 1080 ? 100 : 50) + (hA >= 1080 ? 10 : 0);
    const scoreB = (hB >= 720 && hB <= 1080 ? 100 : 50) + (hB >= 1080 ? 10 : 0);
    return scoreB - scoreA;
  });

  return candidates[0];
}

/**
 * Cari foto stock di Pixabay.
 * @param {string} query - Kata kunci pencarian
 * @param {object} options
 * @returns {Promise<object[]>} Array of Pixabay image hit objects
 */
export async function searchPixabayImages(query, options = {}) {
  const key = options.apiKey || apiKey();
  if (!key) throw new Error("PIXABAY_API_KEY belum diisi.");

  const cleanQuery = cleanText(query || "", 100);
  if (!cleanQuery) return [];

  const url = new URL(PIXABAY_IMAGES_URL);
  url.searchParams.set("key", key);
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("image_type", options.imageType || "photo");
  url.searchParams.set("orientation", options.orientation || "horizontal");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(Math.max(3, Math.min(50, options.perPage || config.pixabay?.maxResults || 15))));

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || config.pixabay?.timeoutMs || DEFAULT_TIMEOUT_MS;

  const response = await fetchImpl(url.toString(), {
    headers: { "User-Agent": "yt-longform-studio/1.0" },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Pixabay image search error HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  return Array.isArray(data.hits) ? data.hits : [];
}

/**
 * Unduh berkas media (video/gambar) dari URL ke disk secara atomic (.part -> rename).
 */
export async function downloadPixabayMedia(mediaUrl, outputPath, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || config.pixabay?.downloadTimeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS;

  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const tempPath = path.join(
    outputDir,
    `.${path.basename(outputPath)}.${process.pid}-${randomUUID()}.part`
  );

  try {
    const res = await fetchImpl(mediaUrl, {
      headers: { "User-Agent": "yt-longform-studio/1.0" },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      throw new Error(`Download HTTP ${res.status} dari ${mediaUrl}`);
    }

    if (!res.body) {
      throw new Error(`Body kosong saat mengunduh ${mediaUrl}`);
    }

    const nodeStream = Readable.fromWeb(res.body);
    const fileStream = createWriteStream(tempPath);
    await pipeline(nodeStream, fileStream);

    const stat = await fs.stat(tempPath);
    if (stat.size < 1024) {
      throw new Error(`Ukuran file hasil unduh terlalu kecil (${stat.size} bytes)`);
    }

    await fs.rename(tempPath, outputPath);
    return outputPath;
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Susun kandidat query dari scene untuk Pixabay.
 */
export function buildPixabayQueryPlan(scene, topicFallback = "") {
  const candidates = [];
  if (scene?.pexelsQuery) candidates.push(scene.pexelsQuery);
  if (scene?.visualKeywords) {
    const kw = scene.visualKeywords.replace(/,/g, " ").trim();
    if (kw) candidates.push(kw);
  }
  if (topicFallback) candidates.push(topicFallback);

  const clean = candidates
    .map((c) => cleanText(c, 95))
    .filter((c) => c && c.length >= 3);

  return [...new Set(clean)].slice(0, 3);
}

/**
 * Cari dan unduh media Pixabay (video atau gambar) untuk sebuah scene.
 * @param {object} params
 * @param {string} params.itemId
 * @param {object} params.scene
 * @param {string} [params.topicFallback]
 * @param {boolean} [params.preferVideo=true]
 * @returns {Promise<object|null>} metadata aset atau null jika tidak ada hasil
 */
export async function fetchPixabayMediaForScene({
  itemId,
  scene,
  topicFallback = "",
  preferVideo = true,
  fetchImpl = fetch
}) {
  const queries = buildPixabayQueryPlan(scene, topicFallback);
  if (!queries.length) return null;

  const clipsDir = path.join(paths.generatedDir, "clips");
  const imagesDir = path.join(paths.generatedDir, "images");
  await Promise.all([
    fs.mkdir(clipsDir, { recursive: true }),
    fs.mkdir(imagesDir, { recursive: true })
  ]);

  const segSuffix = typeof scene.segmentIndex === "number" ? `-seg-${scene.segmentIndex}` : "";

  // 1. Coba pencarian video jika preferVideo aktif
  if (preferVideo) {
    for (const q of queries) {
      try {
        const hits = await searchPixabayVideos(q, { fetchImpl });
        for (const hit of hits) {
          const videoFile = pickBestPixabayVideoFile(hit);
          if (!videoFile || !videoFile.url) continue;

          const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}${segSuffix}-pixabay-${hit.id}.mp4`;
          const outputPath = path.join(clipsDir, filename);

          try {
            await downloadPixabayMedia(videoFile.url, outputPath, { fetchImpl });
            console.log(`[Pixabay] Download video scene ${scene.index} seg ${scene.segmentIndex || 0}: ${videoFile.width}x${videoFile.height} (${hit.id}) query="${q}"`);
            return {
              sceneIndex: Number(scene.index),
              segmentIndex: Number(scene.segmentIndex || 0),
              provider: "pixabay",
              pixabayId: hit.id,
              title: hit.tags || "Pixabay Stock Video",
              creator: hit.user || "Kontributor Pixabay",
              license: "Pixabay Content License",
              licenseUrl: "https://pixabay.com/service/license-summary/",
              sourceUrl: hit.pageURL || `https://pixabay.com/videos/id-${hit.id}/`,
              width: Number(videoFile.width || 1280),
              height: Number(videoFile.height || 720),
              duration: Number(hit.duration || 0),
              path: outputPath,
              url: `/generated/clips/${filename}`
            };
          } catch (err) {
            console.warn(`[Pixabay] Download video gagal hit ${hit.id}: ${err.message}`);
          }
        }
      } catch (err) {
        console.warn(`[Pixabay] Query video "${q}" gagal: ${err.message}`);
      }
    }
  }

  // 2. Fallback ke gambar foto Pixabay jika video tidak ditemukan
  for (const q of queries) {
    try {
      const hits = await searchPixabayImages(q, { fetchImpl });
      for (const hit of hits) {
        const imgUrl = hit.largeImageURL || hit.webformatURL || hit.imageURL;
        if (!imgUrl) continue;

        const ext = imgUrl.match(/\.(jpe?g|png|webp)/i)?.[1]?.replace("jpeg", "jpg") || "jpg";
        const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}${segSuffix}-pixabay-${hit.id}.${ext}`;
        const outputPath = path.join(imagesDir, filename);

        try {
          await downloadPixabayMedia(imgUrl, outputPath, { fetchImpl });
          console.log(`[Pixabay] Download foto scene ${scene.index} seg ${scene.segmentIndex || 0}: ${hit.imageWidth}x${hit.imageHeight} (${hit.id}) query="${q}"`);
          return {
            sceneIndex: Number(scene.index),
            segmentIndex: Number(scene.segmentIndex || 0),
            provider: "pixabay",
            pixabayId: hit.id,
            title: hit.tags || "Pixabay Stock Photo",
            creator: hit.user || "Kontributor Pixabay",
            license: "Pixabay Content License",
            licenseUrl: "https://pixabay.com/service/license-summary/",
            sourceUrl: hit.pageURL || `https://pixabay.com/photos/id-${hit.id}/`,
            width: Number(hit.imageWidth || 1920),
            height: Number(hit.imageHeight || 1080),
            path: outputPath,
            url: `/generated/images/${filename}`
          };
        } catch (err) {
          console.warn(`[Pixabay] Download foto gagal hit ${hit.id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`[Pixabay] Query foto "${q}" gagal: ${err.message}`);
    }
  }

  return null;
}
