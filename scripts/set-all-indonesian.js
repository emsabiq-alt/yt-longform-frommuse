import { config } from "../src/config.js";
import {
  getYoutubeAccessToken,
  getYoutubeVideo,
  updateYoutubeLocalizations
} from "../src/youtube-publisher.js";

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

async function run() {
  console.log("Memulai proses update semua video ke Bahasa Indonesia (id)...");
  const accessToken = await getYoutubeAccessToken();
  const videoIds = await listUploadVideoIds(accessToken);
  console.log(`Ditemukan total ${videoIds.length} video pada channel.`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < videoIds.length; i++) {
    const videoId = videoIds[i];
    try {
      const video = await getYoutubeVideo({ videoId, accessToken });
      const snippet = video.snippet || {};
      const currentAudio = snippet.defaultAudioLanguage;
      const currentLang = snippet.defaultLanguage;
      const title = snippet.title || videoId;

      if (currentAudio === "id" && currentLang === "id") {
        console.log(`[${i + 1}/${videoIds.length}] [SKIP] Video ${videoId} ("${title}") sudah Bahasa Indonesia (audio: id, metadata: id).`);
        skippedCount++;
        continue;
      }

      console.log(`[${i + 1}/${videoIds.length}] [UPDATING] Video ${videoId} ("${title}") [audio: ${currentAudio || "none"} -> id, metadata: ${currentLang || "none"} -> id]...`);
      await updateYoutubeLocalizations({
        videoId,
        accessToken,
        snippet,
        localizations: video.localizations || {}
      });
      updatedCount++;
    } catch (err) {
      console.error(`[${i + 1}/${videoIds.length}] [ERROR] Gagal mengupdate video ${videoId}: ${err.message}`);
      errorCount++;
    }
  }

  console.log("\n================================");
  console.log("Proses Selesai!");
  console.log(`Total video: ${videoIds.length}`);
  console.log(`Berhasil diupdate ke Indonesia: ${updatedCount}`);
  console.log(`Sudah Indonesia (dilewati): ${skippedCount}`);
  console.log(`Gagal: ${errorCount}`);
  console.log("================================");
}

run().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
