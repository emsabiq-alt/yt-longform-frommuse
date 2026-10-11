import { config } from "../src/config.js";
import {
  getYoutubeAccessToken,
  getYoutubeVideo,
  updateYoutubeLocalizations
} from "../src/youtube-publisher.js";
import {
  normalizeLanguageList,
  translateYoutubeMetadata
} from "../src/youtube-localization.js";

function argValue(name, fallback = "") {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || fallback;
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function boolValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Gunakan: npm run localize:youtube:all -- [--languages en,es] [--limit 0] [--concurrency 3] [--force true]");
  process.exit(0);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error_description || data?.raw || response.statusText;
    throw new Error(`${detail} [HTTP ${response.status}]`);
  }
  return data;
}

async function listUploadVideoIds(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelUrl.searchParams.set("part", "contentDetails");
  channelUrl.searchParams.set("mine", "true");
  const channel = await fetchJson(channelUrl, { headers });
  const uploadsPlaylist = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) throw new Error("Playlist uploads channel YouTube tidak ditemukan.");

  const videos = [];
  let pageToken = "";
  do {
    const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    playlistUrl.searchParams.set("part", "contentDetails");
    playlistUrl.searchParams.set("playlistId", uploadsPlaylist);
    playlistUrl.searchParams.set("maxResults", "50");
    if (pageToken) playlistUrl.searchParams.set("pageToken", pageToken);
    const page = await fetchJson(playlistUrl, { headers });
    for (const item of page.items || []) {
      const id = String(item.contentDetails?.videoId || "").trim();
      if (id) videos.push(id);
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return [...new Set(videos)];
}

async function localizeOne({ videoId, accessToken, languages, force }) {
  const video = await getYoutubeVideo({ videoId, accessToken });
  const snippet = video.snippet || {};
  const existing = video.localizations || {};
  const missing = force
    ? languages
    : languages.filter((language) => !existing[language]?.title || !existing[language]?.description);

  if (!missing.length) {
    return { videoId, status: "skipped", languages: languages.length };
  }

  const translated = await translateYoutubeMetadata({
    title: snippet.title,
    description: snippet.description,
    languages: missing
  });
  if (!translated.ok || translated.skipped) {
    throw new Error(translated.reason || "Terjemahan tidak tersedia.");
  }

  const merged = { ...existing, ...translated.localizations };
  const updated = await updateYoutubeLocalizations({
    videoId,
    accessToken,
    localizations: merged,
    snippet
  });
  return { videoId, status: "updated", languages: updated.languages };
}

const accessToken = await getYoutubeAccessToken();
const requested = normalizeLanguageList(
  argValue("--languages", config.youtube.localizationLanguages.join(",")),
  config.youtube.defaultLanguage
);
const requestedLimit = Math.max(0, Number(argValue("--limit", "0")) || 0);
const concurrency = Math.min(5, Math.max(1, Number(argValue("--concurrency", "3")) || 3));
const force = boolValue(argValue("--force", "false"));
const allVideoIds = await listUploadVideoIds(accessToken);
const videoIds = requestedLimit ? allVideoIds.slice(0, requestedLimit) : allVideoIds;

console.log(JSON.stringify({
  channelVideos: allVideoIds.length,
  selectedVideos: videoIds.length,
  languages: requested,
  concurrency,
  force
}, null, 2));

let next = 0;
const results = [];
async function worker() {
  while (true) {
    const index = next;
    next += 1;
    if (index >= videoIds.length) return;
    const videoId = videoIds[index];
    try {
      const result = await localizeOne({ videoId, accessToken, languages: requested, force });
      results.push(result);
      console.log(`[${index + 1}/${videoIds.length}] ${videoId}: ${result.status}`);
    } catch (error) {
      results.push({ videoId, status: "failed", error: error.message });
      console.warn(`[${index + 1}/${videoIds.length}] ${videoId}: gagal — ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, videoIds.length || 1) }, worker));
const summary = {
  total: results.length,
  updated: results.filter((result) => result.status === "updated").length,
  skipped: results.filter((result) => result.status === "skipped").length,
  failed: results.filter((result) => result.status === "failed").length
};
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
