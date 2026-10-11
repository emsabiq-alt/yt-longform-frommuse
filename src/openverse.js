/**
 * Openverse — ~700 juta gambar berlisensi terbuka dari Flickr, museum,
 * Smithsonian, NASA, Rawpixel, Commons, dan puluhan sumber lain.
 *
 * Alasan modul ini ada: Wikimedia Commons satu repositori, dan untuk topik
 * sehari-hari koleksinya tipis. Openverse memberi jangkauan seluas mesin
 * pencari gambar umum TANPA masalah lisensinya, karena setiap hasil membawa
 * field lisensi terstruktur yang bisa disaring.
 *
 * Sengaja memakai ulang scoreWikimediaCandidate/selectWikimediaCandidate:
 * kandidat dinormalisasi ke bentuk yang sama, jadi aturan relevansi,
 * mustMatchTerms, dan dedup persis sama dengan jalur Commons. Nol logika
 * ranking baru untuk dirawat.
 *
 * Gratis, tanpa API key. Docs: https://api.openverse.org/v1/
 *
 * CATATAN OPERASIONAL (terukur, bukan dugaan): query yang sudah ter-cache
 * dijawab ~40ms, tapi query dingin bisa menggantung ~60 detik lalu dibalas
 * halaman error gateway. Karena itu modul ini memutus cepat lewat timeout dan
 * memperlakukan setiap kegagalan sebagai "tidak ada kandidat" — pipeline
 * lanjut ke gambar OpenAI, tidak pernah menahan render.
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config, paths } from "./config.js";
import { buildPexelsQueryPlan } from "./pexels.js";
import { selectWikimediaCandidate } from "./wikimedia.js";

const OPENVERSE_API_URL = "https://api.openverse.org/v1/images/";
export const OPENVERSE_SELECTOR_VERSION = 1;

// Hanya lisensi yang aman untuk video monetisasi. ShareAlike menular ke karya
// turunan, jadi butuh opt-in eksplisit — sama seperti kebijakan Commons.
const SAFE_LICENSES = ["pdm", "cc0", "by"];
const SHARE_ALIKE_LICENSES = ["by-sa"];

const EXTENSIONS = {
  jpg: ".jpg",
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp"
};

function licenseLabel(entry) {
  const code = String(entry?.license || "").toUpperCase();
  const version = String(entry?.license_version || "").trim();
  if (code === "PDM") return "Public Domain Mark";
  if (code === "CC0") return version ? `CC0 ${version}` : "CC0";
  return version ? `CC ${code} ${version}` : `CC ${code}`;
}

/**
 * Bentuk respons Openverse → bentuk kandidat Wikimedia, supaya scorer yang
 * sudah teruji bisa dipakai apa adanya.
 */
export function parseOpenverseResults(results) {
  return (Array.isArray(results) ? results : []).flatMap((entry) => {
    const url = String(entry?.url || "");
    if (!/^https:\/\//i.test(url)) return [];
    const filetype = String(entry?.filetype || "").toLowerCase();
    const extension = EXTENSIONS[filetype] || (/\.(jpe?g|png|webp)(\?|$)/i.test(url)
      ? `.${url.split(/[?#]/)[0].split(".").pop().toLowerCase().replace("jpeg", "jpg")}`
      : "");
    if (!extension) return [];

    return [{
      pageId: String(entry.id || ""),
      pageTitle: String(entry.title || ""),
      title: String(entry.title || ""),
      description: String(entry.attribution || ""),
      categories: (Array.isArray(entry.tags) ? entry.tags : [])
        .map((tag) => String(tag?.name || "")).filter(Boolean).join(" "),
      creator: String(entry.creator || "").trim() || "Kontributor Openverse",
      license: licenseLabel(entry),
      licenseUrl: String(entry.license_url || ""),
      pageUrl: String(entry.foreign_landing_url || entry.detail_url || ""),
      originalUrl: url,
      thumbnailUrl: String(entry.thumbnail || ""),
      downloadUrl: url,
      mime: filetype ? `image/${filetype === "jpg" ? "jpeg" : filetype}` : "image/jpeg",
      thumbMime: "",
      mediaType: "image",
      source: String(entry.source || entry.provider || ""),
      width: Number(entry.width || 0),
      height: Number(entry.height || 0),
      size: Number(entry.filesize || 0)
    }];
  }).filter((candidate) => candidate.pageId && candidate.license);
}

export async function searchOpenverseImages(query, options = {}) {
  const cleaned = String(query || "").replace(/[^\p{L}\p{N}'’-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!cleaned) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const licenses = options.allowShareAlike
    ? [...SAFE_LICENSES, ...SHARE_ALIKE_LICENSES]
    : SAFE_LICENSES;
  const url = new URL(OPENVERSE_API_URL);
  url.searchParams.set("q", cleaned);
  url.searchParams.set("license", licenses.join(","));
  url.searchParams.set("page_size", String(Math.max(1, Math.min(20,
    Math.floor(Number(options.maxResults) || config.openverse.maxResults)
  ))));
  url.searchParams.set("mature", "false");
  // Aspek landscape lebih cocok untuk kanvas 16:9; hemat kandidat terbuang.
  url.searchParams.set("aspect_ratio", "wide");

  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": config.wikimedia.userAgent,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(config.openverse.timeoutMs)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Openverse search gagal HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }
  // Openverse mengembalikan HTML error gateway (bukan JSON) saat query dingin
  // membuat backend-nya kehabisan waktu. Ditangkap di sini supaya pemanggil
  // melihat "tidak ada kandidat", bukan SyntaxError yang menyesatkan.
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Openverse membalas non-JSON (kemungkinan timeout gateway).");
  }
  return parseOpenverseResults(data?.results || []);
}

/**
 * Download gambar Openverse. Berbeda dari Commons, host-nya bisa apa saja
 * (Flickr, museum, CDN), jadi yang bisa dijamin hanya HTTPS + batas ukuran.
 */
export async function downloadOpenverseImage(mediaUrl, outputPath, options = {}) {
  let safeUrl;
  try {
    const parsed = new URL(String(mediaUrl || ""));
    if (parsed.protocol !== "https:") throw new Error("bukan https");
    safeUrl = parsed.toString();
  } catch {
    throw new Error("URL Openverse tidak valid.");
  }
  const maxBytes = Math.max(1, Number(options.maxBytes) || config.wikimedia.maxImageBytes);
  const fetchImpl = options.fetchImpl || fetch;
  const tempPath = `${outputPath}.${randomUUID()}.part`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  try {
    const response = await fetchImpl(safeUrl, {
      redirect: "follow",
      headers: { "User-Agent": config.wikimedia.userAgent },
      signal: AbortSignal.timeout(config.openverse.downloadTimeoutMs)
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      throw new Error(`file ${Math.ceil(contentLength / 1024 / 1024)} MB melebihi batas`);
    }

    let downloadedBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          callback(new Error("Download Openverse melebihi batas ukuran."));
          return;
        }
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      createWriteStream(tempPath, { flags: "wx" })
    );
    if (downloadedBytes <= 0) throw new Error("file kosong");
    await fs.rename(tempPath, outputPath);
    return outputPath;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw new Error(`Download Openverse gagal: ${error.message}`);
  }
}

/**
 * Nama tokoh yang layak dicoba lewat Wikidata P18. Diambil dari mustMatchTerms
 * dan narrativeContext karena di situlah subjek konkret scene berada.
 */
export function personNameCandidates(scene = {}) {
  const pool = [
    ...(Array.isArray(scene.mustMatchTerms) ? scene.mustMatchTerms : []),
    ...String(scene.narrativeContext || "").split(/[,.;:]/)
  ];
  const names = [];
  for (const raw of pool) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    // Ambil rentetan kata berhuruf kapital: "ilmuwan Ibnu Sina menulis" → "Ibnu Sina".
    for (const match of text.matchAll(/\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*)+/gu)) {
      const name = match[0].trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names.slice(0, 2);
}

/**
 * Cari satu gambar untuk satu visual segment: foto tokoh (Wikidata P18) kalau
 * scene menyebut nama orang, kalau tidak jatuh ke pencarian Openverse.
 * Mengembalikan null agar pipeline dapat melanjutkan ke gambar OpenAI.
 */
export async function fetchOpenverseImageForScene({
  itemId,
  scene,
  topicFallback = "",
  usedPageIds = [],
  searchImages = searchOpenverseImages,
  downloadImage = downloadOpenverseImage,
  personImage = null
}) {
  const excluded = new Set((usedPageIds || []).map(String));
  let selected = null;
  let selectedQuery = "";
  let person = null;

  if (personImage) {
    for (const name of personNameCandidates(scene)) {
      const found = await personImage(name);
      if (found && !excluded.has(String(found.entityId))) {
        person = found;
        break;
      }
    }
  }

  if (!person) {
    const queryPlan = buildPexelsQueryPlan(scene, topicFallback)
      .slice(0, config.openverse.maxQueryAttempts);
    if (!queryPlan.length) return null;

    for (const query of queryPlan) {
      let candidates;
      try {
        candidates = await searchImages(query, {
          maxResults: config.openverse.maxResults,
          allowShareAlike: config.wikimedia.allowShareAlike
        });
      } catch (error) {
        console.warn(`[Openverse] Search gagal scene ${scene.index} query "${query}": ${error.message}`);
        continue;
      }
      const best = selectWikimediaCandidate(candidates, {
        query,
        mustMatchTerms: scene.mustMatchTerms,
        usedPageIds,
        minRelevance: config.openverse.minRelevance,
        allowShareAlike: config.wikimedia.allowShareAlike
      });
      if (best) {
        selected = best;
        selectedQuery = query;
        break;
      }
    }
    if (!selected) return null;
  }

  const segmentIndex = Number(scene.segmentIndex || 0);
  const suffix = randomUUID().slice(0, 8);
  const source = person
    ? { provider: "wikidata", id: person.entityId, extension: ".jpg", url: person.url }
    : { provider: "openverse", id: selected.candidate.pageId, extension: selected.extension, url: selected.candidate.downloadUrl };
  const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}-seg-${segmentIndex}`
    + `-${source.provider}-${String(source.id).replace(/[^\w-]/g, "").slice(0, 24)}-${suffix}${source.extension}`;
  const outputPath = path.join(paths.imageDir, filename);

  try {
    await downloadImage(source.url, outputPath, { maxBytes: config.wikimedia.maxImageBytes });
  } catch (error) {
    console.warn(`[Openverse] Download gagal scene ${scene.index}: ${error.message}`);
    return null;
  }

  if (person) {
    console.log(`[Wikidata] Foto tokoh scene ${scene.index} seg ${segmentIndex}: "${person.label}" (${person.entityId})`);
    return {
      sceneIndex: scene.index,
      segmentIndex,
      provider: "wikidata",
      selectorVersion: OPENVERSE_SELECTOR_VERSION,
      mediaType: "image",
      openversePageId: person.entityId,
      title: person.label,
      creator: "Kontributor Wikimedia Commons",
      license: "Lihat halaman sumber",
      licenseUrl: "",
      sourceUrl: person.sourceUrl,
      originalUrl: person.url,
      query: person.label,
      path: outputPath,
      url: `/generated/images/${filename}`
    };
  }

  const candidate = selected.candidate;
  console.log(
    `[Openverse] Gambar scene ${scene.index} seg ${segmentIndex}: `
    + `"${candidate.title}" (${candidate.license}) score=${selected.score} query="${selectedQuery}"`
  );
  return {
    sceneIndex: scene.index,
    segmentIndex,
    provider: "openverse",
    selectorVersion: OPENVERSE_SELECTOR_VERSION,
    mediaType: "image",
    openversePageId: candidate.pageId,
    title: candidate.title,
    creator: candidate.creator,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    sourceUrl: candidate.pageUrl,
    originalUrl: candidate.originalUrl,
    query: selectedQuery,
    score: selected.score,
    relevance: selected.relevance,
    matchedTerms: selected.matchedTerms,
    width: candidate.width,
    height: candidate.height,
    path: outputPath,
    url: `/generated/images/${filename}`
  };
}


