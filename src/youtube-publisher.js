import fs from "node:fs";
import fsp from "node:fs/promises";
import { config } from "./config.js";

const tokenUrl = "https://oauth2.googleapis.com/token";
const videoUploadUrl = "https://www.googleapis.com/upload/youtube/v3/videos";
const videoApiUrl = "https://www.googleapis.com/youtube/v3/videos";
const thumbnailUploadUrl = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
const captionUploadUrl = "https://www.googleapis.com/upload/youtube/v3/captions";
const maxThumbnailBytes = 2 * 1024 * 1024;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function assertYoutubeConfig() {
  const missing = [];
  if (!config.youtube.enabled) missing.push("YOUTUBE_UPLOAD_ENABLED=true");
  if (!config.youtube.clientId) missing.push("YOUTUBE_CLIENT_ID");
  if (!config.youtube.clientSecret) missing.push("YOUTUBE_CLIENT_SECRET");
  if (!config.youtube.refreshToken) missing.push("YOUTUBE_REFRESH_TOKEN");
  if (missing.length) throw new Error(`Config YouTube belum lengkap: ${missing.join(", ")}`);
}

function normalizeTitle(value) {
  return clean(value).slice(0, 65) || "BanyakTau";
}

function normalizeDescription(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);
}

function normalizePrivacyStatus(value) {
  const privacy = clean(value).toLowerCase();
  return ["public", "unlisted", "private"].includes(privacy) ? privacy : "public";
}

function parseScheduledTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clean(value));
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new Error("YOUTUBE_SCHEDULED_PUBLISH_TIME harus berformat HH:MM, misalnya 20:30.");
  }
  return { hour, minute };
}

function zonedParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second")
    };
  } catch {
    throw new Error(`Timezone publikasi tidak valid: ${timeZone}`);
  }
}

function dateAtZone({ year, month, day, hour, minute }, timeZone) {
  const assumedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const localAtAssumedUtc = zonedParts(new Date(assumedUtc), timeZone);
  const offsetMs = Date.UTC(
    localAtAssumedUtc.year,
    localAtAssumedUtc.month - 1,
    localAtAssumedUtc.day,
    localAtAssumedUtc.hour,
    localAtAssumedUtc.minute,
    localAtAssumedUtc.second
  ) - assumedUtc;
  return new Date(assumedUtc - offsetMs);
}

/**
 * Tentukan prime time berikutnya di zona target. Upload selesai tetap private;
 * YouTube yang akan mempublikasikannya pada waktu ini tanpa worker menunggu.
 */
export function nextScheduledPublishAt({
  now = new Date(),
  time = config.youtube.scheduledPublishTime,
  timeZone = config.youtube.scheduledPublishTimeZone,
  leadMinutes = config.youtube.scheduledPublishLeadMinutes
} = {}) {
  const { hour, minute } = parseScheduledTime(time);
  const minimum = new Date(now.getTime() + Math.max(0, Number(leadMinutes) || 0) * 60_000);
  const base = zonedParts(minimum, timeZone);

  for (let offset = 0; offset <= 2; offset += 1) {
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const candidate = dateAtZone({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour,
      minute
    }, timeZone);
    if (candidate.getTime() > minimum.getTime()) return candidate.toISOString();
  }
  throw new Error("Gagal menentukan jadwal publikasi YouTube berikutnya.");
}

export function buildVideoStatus(now = new Date()) {
  if (config.youtube.scheduledPublishEnabled) {
    return {
      // YouTube hanya menerima publishAt saat status awal video private.
      privacyStatus: "private",
      publishAt: nextScheduledPublishAt({ now }),
      selfDeclaredMadeForKids: false
    };
  }
  return {
    privacyStatus: normalizePrivacyStatus(config.youtube.privacyStatus),
    selfDeclaredMadeForKids: false
  };
}

function normalizeTags(tags = []) {
  const rows = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return [...new Set(rows.map((tag) => clean(tag)).filter(Boolean))].slice(0, 20);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data.error_description || data.error?.message || data.error || data.raw || response.statusText;
    throw new Error(`${detail} [HTTP ${response.status}]`);
  }
  return { response, data };
}

export async function getYoutubeAccessToken() {
  assertYoutubeConfig();
  const body = new URLSearchParams({
    client_id: config.youtube.clientId,
    client_secret: config.youtube.clientSecret,
    refresh_token: config.youtube.refreshToken,
    grant_type: "refresh_token"
  });
  const { data } = await fetchJson(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!data.access_token) throw new Error("Google tidak mengembalikan access token YouTube.");
  return data.access_token;
}

export async function getYoutubeVideo({ videoId, accessToken }) {
  const url = new URL(videoApiUrl);
  url.searchParams.set("part", "snippet,localizations");
  url.searchParams.set("id", videoId);
  const { data } = await fetchJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const item = data.items?.[0];
  if (!item) throw new Error(`Video YouTube tidak ditemukan: ${videoId}`);
  return item;
}

function normalizeLocalizations(localizations = {}) {
  const result = {};
  for (const [language, value] of Object.entries(localizations || {})) {
    const title = normalizeTitle(value?.title);
    const description = normalizeDescription(value?.description);
    if (!language || !title || !description) continue;
    result[language] = { title, description };
  }
  return result;
}

export async function updateYoutubeLocalizations({
  videoId,
  localizations = {},
  accessToken,
  snippet = {}
}) {
  if (!videoId) {
    return { ok: true, skipped: true, languages: [] };
  }

  const normalized = normalizeLocalizations(localizations);
  const current = snippet.title && snippet.categoryId
    ? snippet
    : (await getYoutubeVideo({ videoId, accessToken })).snippet || {};
  const hasLocalizations = Object.keys(normalized).length > 0;
  const body = {
    id: videoId,
    snippet: {
      title: normalizeTitle(current.title),
      description: normalizeDescription(current.description),
      categoryId: clean(current.categoryId || config.youtube.categoryId),
      // The primary title/description belong to the Indonesian channel. Keep
      // foreign-language variants only in `localizations`.
      defaultLanguage: config.youtube.defaultLanguage,
      defaultAudioLanguage: config.youtube.defaultAudioLanguage,
      tags: normalizeTags(current.tags || [])
    },
    ...(hasLocalizations ? { localizations: normalized } : {})
  };
  const url = new URL(videoApiUrl);
  url.searchParams.set("part", hasLocalizations ? "snippet,localizations" : "snippet");
  const { data } = await fetchJson(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    body: JSON.stringify(body)
  });
  const confirmedSnippet = data?.snippet || {};
  console.log(`[YouTube] Bahasa video terverifikasi: defaultAudioLanguage=${confirmedSnippet.defaultAudioLanguage || config.youtube.defaultAudioLanguage}, defaultLanguage=${confirmedSnippet.defaultLanguage || config.youtube.defaultLanguage}`);
  return {
    ok: true,
    skipped: false,
    defaultLanguage: confirmedSnippet.defaultLanguage || config.youtube.defaultLanguage,
    defaultAudioLanguage: confirmedSnippet.defaultAudioLanguage || config.youtube.defaultAudioLanguage,
    languages: Object.keys(data?.localizations || normalized),
    localizations: data?.localizations || normalized
  };
}

async function setYoutubeThumbnail({ videoId, thumbnailPath, accessToken }) {
  if (!videoId || !thumbnailPath) return { ok: false, skipped: true, error: "" };
  let stat;
  try {
    stat = await fsp.stat(thumbnailPath);
  } catch (error) {
    return { ok: false, error: `Thumbnail tidak ditemukan: ${error.message}` };
  }
  if (!stat.size) return { ok: false, error: "Thumbnail kosong." };
  if (stat.size > maxThumbnailBytes) return { ok: false, error: `Thumbnail melebihi 2MB (${stat.size} bytes).` };

  let lastError = null;
  for (let attempt = 1; attempt <= config.youtube.thumbnailUploadAttempts; attempt += 1) {
    try {
      const url = new URL(thumbnailUploadUrl);
      url.searchParams.set("videoId", videoId);
      url.searchParams.set("uploadType", "media");
      await fetchJson(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "image/jpeg",
          "Content-Length": String(stat.size)
        },
        body: fs.createReadStream(thumbnailPath),
        duplex: "half"
      });
      return { ok: true, error: "" };
    } catch (error) {
      lastError = error;
      if (attempt < config.youtube.thumbnailUploadAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      }
    }
  }
  return { ok: false, error: lastError?.message || "Upload thumbnail YouTube gagal." };
}

/**
 * Unggah satu track subtitle bahasa sumber (.srt). YouTube bisa menerjemahkan
 * track ini otomatis ke bahasa lain, sehingga penonton internasional dapat
 * teks tanpa perlu membuat track per bahasa. Kegagalan di sini tidak boleh
 * membatalkan publikasi video, jadi hasilnya dikembalikan sebagai status.
 */
export async function uploadYoutubeCaption({ videoId, srtPath, accessToken, language }) {
  if (!videoId || !srtPath) return { ok: false, skipped: true, error: "" };
  let body;
  try {
    body = await fsp.readFile(srtPath, "utf8");
  } catch (error) {
    return { ok: false, error: `Subtitle tidak ditemukan: ${error.message}` };
  }
  if (!body.trim()) return { ok: false, skipped: true, error: "" };

  const metadata = {
    snippet: {
      videoId,
      language: clean(language) || config.youtube.defaultLanguage,
      name: "",
      isDraft: false
    }
  };
  const boundary = `caption-${Date.now()}`;
  const multipart = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/octet-stream",
    "",
    body,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const url = new URL(captionUploadUrl);
  url.searchParams.set("part", "snippet");
  let lastError = null;
  // Video kadang masih diproses YouTube beberapa detik setelah upload selesai,
  // sehingga percobaan pertama bisa ditolak. Pola retry sama dengan thumbnail.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await fetchJson(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: multipart
      });
      return { ok: true, error: "" };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
  return { ok: false, error: lastError?.message || "Upload subtitle YouTube gagal." };
}

export async function publishToYoutube({
  videoPath,
  title,
  description,
  tags = [],
  thumbnailPath,
  srtPath = "",
  localizations = {}
}) {
  const accessToken = await getYoutubeAccessToken();
  const stat = await fsp.stat(videoPath);
  const metadata = {
    snippet: {
      title: normalizeTitle(title),
      description: normalizeDescription(description),
      categoryId: config.youtube.categoryId,
      tags: normalizeTags([...config.youtube.tags, ...tags]),
      defaultLanguage: config.youtube.defaultLanguage,
      defaultAudioLanguage: config.youtube.defaultAudioLanguage
    },
    status: buildVideoStatus()
  };

  const startUrl = new URL(videoUploadUrl);
  startUrl.searchParams.set("uploadType", "resumable");
  startUrl.searchParams.set("part", "snippet,status");
  const start = await fetch(startUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(stat.size),
      "X-Upload-Content-Type": "video/mp4"
    },
    body: JSON.stringify(metadata)
  });
  const sessionUrl = start.headers.get("location");
  if (!start.ok || !sessionUrl) {
    const detail = await start.text();
    throw new Error(`YouTube upload session gagal: ${detail || start.statusText}`);
  }

  const uploaded = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size)
    },
    body: fs.createReadStream(videoPath),
    duplex: "half"
  });
  const uploadText = await uploaded.text();
  let uploadData = {};
  try {
    uploadData = uploadText ? JSON.parse(uploadText) : {};
  } catch {
    uploadData = { raw: uploadText };
  }
  if (!uploaded.ok) {
    throw new Error(`YouTube video upload gagal: ${uploadData.error?.message || uploadData.raw || uploaded.statusText}`);
  }
  const videoId = clean(uploadData.id);
  if (!videoId) throw new Error("YouTube upload selesai tetapi video id kosong.");

  const thumbnail = config.youtube.customThumbnailEnabled
    ? await setYoutubeThumbnail({ videoId, thumbnailPath, accessToken })
    : { ok: false, skipped: true, error: "" };

  const caption = config.youtube.captionUploadEnabled
    ? await uploadYoutubeCaption({
        videoId,
        srtPath,
        accessToken,
        language: metadata.snippet.defaultLanguage
      })
    : { ok: false, skipped: true, error: "" };

  let localization = { ok: true, skipped: false, languages: [], error: "" };
  try {
    localization = await updateYoutubeLocalizations({
      videoId,
      accessToken,
      localizations,
      snippet: metadata.snippet
    });
  } catch (error) {
    localization = { ok: false, skipped: false, languages: [], error: error.message };
  }

  return {
    ok: true,
    type: "youtube_video",
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    privacyStatus: metadata.status.privacyStatus,
    scheduledPublishAt: metadata.status.publishAt || "",
    title: metadata.snippet.title,
    defaultLanguage: metadata.snippet.defaultLanguage,
    localizations: localization.languages,
    localizationError: localization.ok ? "" : localization.error,
    customThumbnail: Boolean(thumbnail.ok),
    thumbnailError: thumbnail.ok || thumbnail.skipped ? "" : thumbnail.error,
    caption: Boolean(caption.ok),
    captionError: caption.ok || caption.skipped ? "" : caption.error
  };
}
