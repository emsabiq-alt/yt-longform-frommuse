/**
 * Wikimedia Commons — pencarian media edukasi berlisensi bebas.
 *
 * Strategi:
 *   1. Cari file gambar/video melalui MediaWiki Action API.
 *   2. Tolak lisensi yang tidak aman untuk video YouTube secara default.
 *   3. Ranking kandidat berdasarkan kecocokan judul/deskripsi dengan intent scene.
 *   4. Download thumbnail gambar atau file video ke generated/.
 *
 * Docs:
 * - https://www.mediawiki.org/wiki/API:Search
 * - https://www.mediawiki.org/wiki/API:Imageinfo
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config, paths } from "./config.js";
import { buildPexelsQueryPlan, tokenizeWords } from "./pexels.js";

const WIKIMEDIA_API_URL = "https://commons.wikimedia.org/w/api.php";
const WIKIMEDIA_UPLOAD_HOSTS = new Set([
  "upload.wikimedia.org",
  "thumb.wikimedia.org"
]);
const WIKIMEDIA_UPLOAD_HOST = "upload.wikimedia.org";
export const WIKIMEDIA_SELECTOR_VERSION = 1;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const VIDEO_MIME_TYPES = new Set([
  "video/webm",
  "video/ogg",
  "application/ogg"
]);

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function cleanSearchQuery(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function decodeHtmlEntities(value) {
  const named = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["hellip", "…"],
    ["lt", "<"],
    ["nbsp", " "],
    ["quot", "\""]
  ]);
  return String(value || "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named.get(lower) ?? match;
  });
}

export function stripWikimediaHtml(value, max = 500) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function metadataValue(metadata, key, max = 500) {
  return stripWikimediaHtml(metadata?.[key]?.value, max);
}

/**
 * Default sengaja konservatif: Public Domain, CC0, dan CC BY.
 * CC BY-SA hanya dipakai bila operator mengaktifkannya secara eksplisit karena
 * kewajiban ShareAlike dapat memengaruhi lisensi karya turunan.
 */
export function isAllowedWikimediaLicense(licenseName, options = {}) {
  const normalized = String(licenseName || "").trim().toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes("public domain")
    || normalized === "pd"
    || normalized.includes("public domain mark")
    || normalized.includes("cc0")
    || normalized.includes("creative commons zero")
  ) {
    return true;
  }
  if (!normalized.includes("cc by")) return false;
  if (normalized.includes("-nc") || normalized.includes("-nd")) return false;
  if (normalized.includes("-sa") || normalized.includes("share alike") || normalized.includes("sharealike")) {
    return Boolean(options.allowShareAlike);
  }
  return true;
}

function safeUploadUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && WIKIMEDIA_UPLOAD_HOSTS.has(url.hostname)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function mediaTypeFromInfo(info) {
  const mediatype = String(info?.mediatype || "").toUpperCase();
  if (mediatype === "VIDEO") return "video";
  const mime = String(info?.mime || "").toLowerCase();
  const thumbMime = String(info?.thumbmime || "").toLowerCase();
  if (VIDEO_MIME_TYPES.has(mime)) return "video";
  if (IMAGE_MIME_TYPES.has(thumbMime) || IMAGE_MIME_TYPES.has(mime)) return "image";
  return "";
}

function extensionForCandidate(candidate) {
  if (candidate.mediaType === "video") {
    const mime = String(candidate.mime || "").toLowerCase();
    if (mime === "video/webm") return ".webm";
    if (mime === "video/ogg" || mime === "application/ogg") return ".ogv";
    if (candidate.originalUrl?.endsWith(".webm")) return ".webm";
    if (candidate.originalUrl?.endsWith(".ogv")) return ".ogv";
    return ".ogv";
  }
  const mime = candidate.thumbMime || candidate.mime;
  const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
  };
  return extensions[String(mime || "").toLowerCase()] || "";
}

function defaultLicenseUrl(licenseName) {
  const normalized = String(licenseName || "").toLowerCase();
  if (normalized.includes("cc0")) return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (normalized.includes("public domain")) return "https://creativecommons.org/publicdomain/mark/1.0/";
  return "";
}

export function parseWikimediaPages(pages) {
  return (Array.isArray(pages) ? pages : []).flatMap((page) => {
    const info = page?.imageinfo?.[0];
    if (!info) return [];
    const metadata = info.extmetadata || {};
    const mediaType = mediaTypeFromInfo(info);
    const originalUrl = safeUploadUrl(info.url);
    const thumbnailUrl = safeUploadUrl(info.thumburl);
    const downloadUrl = mediaType === "video" ? originalUrl : thumbnailUrl || originalUrl;
    if (!mediaType || !downloadUrl) return [];

    const rawTitle = String(page.title || "").replace(/^File:/i, "");
    const title = rawTitle.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim();
    const license = metadataValue(metadata, "LicenseShortName", 80)
      || metadataValue(metadata, "UsageTerms", 80);
    const creator = metadataValue(metadata, "Attribution", 160)
      || metadataValue(metadata, "Artist", 160)
      || metadataValue(metadata, "Credit", 160)
      || "Kontributor Wikimedia Commons";

    return [{
      pageId: page.pageid,
      pageTitle: page.title || "",
      title,
      description: metadataValue(metadata, "ImageDescription", 600),
      categories: metadataValue(metadata, "Categories", 500),
      creator,
      license,
      licenseUrl: metadataValue(metadata, "LicenseUrl", 300) || defaultLicenseUrl(license),
      pageUrl: String(info.descriptionurl || ""),
      originalUrl,
      thumbnailUrl,
      downloadUrl,
      mime: String(info.mime || "").toLowerCase(),
      thumbMime: String(info.thumbmime || "").toLowerCase(),
      mediaType,
      width: Number(info.width || 0),
      height: Number(info.height || 0),
      size: Number(info.size || 0)
    }];
  });
}

function matchedTokens(expectedTokens, actualTokens) {
  const available = new Set(actualTokens);
  return expectedTokens.filter((token) => available.has(token));
}

function flattenMustMatchTerms(value) {
  return unique(
    (Array.isArray(value) ? value : [value])
      .flatMap((term) => tokenizeWords(term))
  );
}

export function scoreWikimediaCandidate(candidate, options = {}) {
  const queryTokens = unique(tokenizeWords(options.query || ""));
  const mustMatchTokens = flattenMustMatchTerms(options.mustMatchTerms || []);
  const haystack = [
    candidate?.title,
    candidate?.description,
    candidate?.categories
  ].filter(Boolean).join(" ");
  const candidateTokens = unique(tokenizeWords(haystack));
  const matchedQueryTerms = matchedTokens(queryTokens, candidateTokens);
  const matchedMustTerms = matchedTokens(mustMatchTokens, candidateTokens);
  const relevance = queryTokens.length ? matchedQueryTerms.length / queryTokens.length : 0;
  const mustMatchCoverage = mustMatchTokens.length
    ? matchedMustTerms.length / mustMatchTokens.length
    : 1;
  const minRelevance = Math.max(0, Math.min(1, Number(options.minRelevance) || 0));
  const excludedIds = new Set([
    ...(options.usedPageIds || []),
    ...(options.excludedPageIds || [])
  ].map(String));
  const maxVideoBytes = Math.max(1, Number(options.maxVideoBytes) || Number.MAX_SAFE_INTEGER);
  const licenseAllowed = isAllowedWikimediaLicense(candidate?.license, {
    allowShareAlike: options.allowShareAlike
  });
  const extension = extensionForCandidate(candidate || {});
  const normalizedQuery = cleanSearchQuery(options.query).toLowerCase();
  const normalizedTitle = cleanSearchQuery(candidate?.title).toLowerCase();
  const exactPhrase = normalizedQuery.length >= 4 && normalizedTitle.includes(normalizedQuery);

  let rejectionReason = "";
  if (!candidate?.pageId || excludedIds.has(String(candidate.pageId))) rejectionReason = "excluded-page";
  else if (!licenseAllowed) rejectionReason = "unsafe-license";
  else if (!extension || !candidate?.downloadUrl) rejectionReason = "unsupported-media";
  else if (candidate.mediaType === "video" && candidate.size > maxVideoBytes) rejectionReason = "video-too-large";
  else if (queryTokens.length && matchedQueryTerms.length === 0) rejectionReason = "no-query-match";
  else if (mustMatchTokens.length && matchedMustTerms.length === 0) rejectionReason = "no-required-term";
  else if (!exactPhrase && relevance < minRelevance) rejectionReason = "low-relevance";

  const landscapeBonus = candidate.width > candidate.height ? 2 : 0;
  const resolutionBonus = candidate.width >= 1280 ? 1 : 0;
  const licenseBonus = /public domain|cc0/i.test(candidate.license || "") ? 1 : 0;
  const score = (matchedMustTerms.length * 14)
    + (matchedQueryTerms.length * 5)
    + (mustMatchCoverage === 1 && mustMatchTokens.length ? 4 : 0)
    + (exactPhrase ? 6 : 0)
    + landscapeBonus
    + resolutionBonus
    + licenseBonus;

  return {
    candidate,
    score,
    relevance,
    mustMatchCoverage,
    matchedTerms: unique([...matchedMustTerms, ...matchedQueryTerms]),
    eligible: !rejectionReason,
    rejectionReason,
    extension
  };
}

export function selectWikimediaCandidate(candidates, options = {}) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, searchRank) => ({
      ...scoreWikimediaCandidate(candidate, options),
      searchRank
    }))
    .filter((entry) => entry.eligible)
    .sort((a, b) => (
      (b.score - a.score)
      || (b.relevance - a.relevance)
      || (a.searchRank - b.searchRank)
      || String(a.candidate.pageId).localeCompare(String(b.candidate.pageId), "en", { numeric: true })
    ));
  return ranked[0] || null;
}

export async function searchWikimediaMedia(query, options = {}) {
  const cleanedQuery = cleanSearchQuery(query);
  if (!cleanedQuery) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const maxResults = Math.max(1, Math.min(25,
    Math.floor(Number(options.maxResults) || config.wikimedia.maxResults)
  ));
  const url = new URL(WIKIMEDIA_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${cleanedQuery} filetype:bitmap|video`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", String(maxResults));
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size|mime|thumbmime|mediatype|extmetadata");
  url.searchParams.set("iiurlwidth", String(config.wikimedia.imageWidth));
  url.searchParams.set(
    "iiextmetadatafilter",
    "LicenseShortName|LicenseUrl|UsageTerms|Artist|Credit|Attribution|ImageDescription|Categories"
  );
  url.searchParams.set("iiextmetadatalanguage", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");

  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": config.wikimedia.userAgent,
      "Api-User-Agent": config.wikimedia.userAgent,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(config.wikimedia.timeoutMs)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Wikimedia search gagal HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const data = await response.json();
  return parseWikimediaPages(data?.query?.pages || []);
}

export async function downloadWikimediaMedia(mediaUrl, outputPath, options = {}) {
  const safeUrl = safeUploadUrl(mediaUrl);
  if (!safeUrl) throw new Error("URL media Wikimedia tidak valid.");
  const maxBytes = Math.max(1, Number(options.maxBytes) || config.wikimedia.maxVideoBytes);
  const fetchImpl = options.fetchImpl || fetch;
  const tempPath = `${outputPath}.${randomUUID()}.part`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  try {
    const response = await fetchImpl(safeUrl, {
      headers: { "User-Agent": config.wikimedia.userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(config.wikimedia.downloadTimeoutMs)
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!safeUploadUrl(response.url || safeUrl)) {
      throw new Error("Redirect download Wikimedia menuju host yang tidak diizinkan.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      throw new Error(`file ${Math.ceil(contentLength / 1024 / 1024)} MB melebihi batas`);
    }

    let downloadedBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          callback(new Error("Download Wikimedia melebihi batas ukuran."));
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
    throw new Error(`Download Wikimedia gagal: ${error.message}`);
  }
}

/**
 * Cari dan download satu media Commons untuk satu visual segment.
 * Mengembalikan null agar pipeline dapat melanjutkan ke gambar OpenAI.
 */
export async function fetchWikimediaMediaForScene({
  itemId,
  scene,
  topicFallback = "",
  usedPageIds = [],
  searchMedia = searchWikimediaMedia,
  downloadMedia = downloadWikimediaMedia
}) {
  const queryPlan = buildPexelsQueryPlan(scene, topicFallback)
    .slice(0, config.wikimedia.maxQueryAttempts);
  if (!queryPlan.length) return null;

  let selected = null;
  let selectedQuery = "";
  for (const query of queryPlan) {
    let candidates;
    try {
      candidates = await searchMedia(query, {
        maxResults: config.wikimedia.maxResults
      });
    } catch (error) {
      console.warn(`[Wikimedia] Search gagal scene ${scene.index} query "${query}": ${error.message}`);
      continue;
    }
    const best = selectWikimediaCandidate(candidates, {
      query,
      mustMatchTerms: scene.mustMatchTerms,
      usedPageIds,
      minRelevance: config.wikimedia.minRelevance,
      allowShareAlike: config.wikimedia.allowShareAlike,
      maxVideoBytes: config.wikimedia.maxVideoBytes
    });
    if (best) {
      selected = best;
      selectedQuery = query;
      break;
    }
  }
  if (!selected) return null;

  const candidate = selected.candidate;
  const segmentIndex = Number(scene.segmentIndex || 0);
  const suffix = randomUUID().slice(0, 8);
  const filename = `${itemId}-scene-${String(scene.index).padStart(2, "0")}-seg-${segmentIndex}-wikimedia-${candidate.pageId}-${suffix}${selected.extension}`;
  const mediaDir = candidate.mediaType === "video" ? paths.clipsDir : paths.imageDir;
  const outputPath = path.join(mediaDir, filename);

  try {
    await downloadMedia(candidate.downloadUrl, outputPath, {
      maxBytes: candidate.mediaType === "video"
        ? config.wikimedia.maxVideoBytes
        : config.wikimedia.maxImageBytes
    });
  } catch (error) {
    console.warn(`[Wikimedia] Download gagal scene ${scene.index}: ${error.message}`);
    return null;
  }

  const generatedDir = candidate.mediaType === "video" ? "clips" : "images";
  console.log(
    `[Wikimedia] Media ${candidate.mediaType} scene ${scene.index} seg ${segmentIndex}: `
    + `"${candidate.title}" (${candidate.license}) score=${selected.score} query="${selectedQuery}"`
  );
  return {
    sceneIndex: scene.index,
    segmentIndex,
    provider: "wikimedia",
    selectorVersion: WIKIMEDIA_SELECTOR_VERSION,
    mediaType: candidate.mediaType,
    wikimediaPageId: candidate.pageId,
    wikimediaPageTitle: candidate.pageTitle,
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
    url: `/generated/${generatedDir}/${filename}`
  };
}
