/**
 * Script: Create and Populate "Misteri Supervolcano & Geologi Purba Nusantara" Playlist
 *
 * 1. Membuat atau mencari playlist "Misteri Supervolcano & Geologi Purba Nusantara"
 * 2. Mengambil seluruh video channel @BanyakTauID
 * 3. Memfilter semua video bertema vulkanologi, supervolcano, geologi, gempa, tsunami, dan lempeng
 * 4. Memasukkan semua video tersebut ke dalam playlist tanpa duplikasi
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.production.local" });
dotenv.config();

import { getYoutubeAccessToken } from "../src/youtube-publisher.js";

const PLAYLISTS_URL = "https://www.googleapis.com/youtube/v3/playlists";
const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const TARGET_PLAYLIST_TITLE = "Misteri Supervolcano & Geologi Purba Nusantara";
const TARGET_PLAYLIST_DESC = "Dokumenter sains investigasi terlengkap mengupas misteri supervolcano, dinamika kaldera purba, ancaman gempa megathrust, letusan terdahsyat sejarah, dan rahasia perut bumi Nusantara.";

const VOLCANO_KEYWORDS = [
  "toba", "krakatau", "krakatoa", "tambora", "samalas", "merapi", "semeru", "sinabung",
  "gunung", "supervolcano", "vulkanik", "vulkanologi", "erupsi", "letusan", "magma", "lahar",
  "kawah", "kaldera", "selat sunda", "megathrust", "gempa", "tsunami", "lempeng", "sesar",
  "patahan", "subduksi", "tektonik", "palung", "lapindo", "bumi", "geologi", "seismik"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const detail = data?.error?.message || data?.error_description || data?.raw || response.statusText;
    throw new Error(`${detail} [HTTP ${response.status}]`);
  }
  return data;
}

async function getUploadsPlaylistId(accessToken) {
  const url = new URL(CHANNELS_URL);
  url.searchParams.set("part", "contentDetails,snippet");
  url.searchParams.set("mine", "true");
  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const channel = data.items?.[0];
  if (!channel) throw new Error("Channel YouTube tidak ditemukan.");
  console.log(`\n📺 Channel: "${channel.snippet?.title}" (ID: ${channel.id})`);
  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error("Uploads playlist tidak ditemukan.");
  return uploadsId;
}

async function getOrCreateTargetPlaylist(accessToken) {
  let pageToken = "";
  do {
    const url = new URL(PLAYLISTS_URL);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    for (const pl of data.items || []) {
      if (pl.snippet?.title?.trim().toLowerCase() === TARGET_PLAYLIST_TITLE.toLowerCase()) {
        console.log(`✅ Playlist "${TARGET_PLAYLIST_TITLE}" sudah ada (ID: ${pl.id}).`);
        return pl.id;
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  console.log(`✨ Membuat playlist baru: "${TARGET_PLAYLIST_TITLE}"...`);
  const createUrl = new URL(PLAYLISTS_URL);
  createUrl.searchParams.set("part", "snippet,status");
  const res = await fetchJson(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      snippet: {
        title: TARGET_PLAYLIST_TITLE,
        description: TARGET_PLAYLIST_DESC
      },
      status: {
        privacyStatus: "public"
      }
    })
  });
  console.log(`🎉 Playlist berhasil dibuat dengan ID: ${res.id}`);
  return res.id;
}

async function getAllUploadedVideos(accessToken, uploadsPlaylistId) {
  const videos = [];
  let pageToken = "";
  do {
    const url = new URL(PLAYLIST_ITEMS_URL);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", uploadsPlaylistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    for (const item of data.items || []) {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (videoId) {
        videos.push({
          id: videoId,
          title: item.snippet?.title || "",
          publishedAt: item.snippet?.publishedAt || ""
        });
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return videos;
}

async function getExistingPlaylistVideoIds(accessToken, playlistId) {
  const ids = new Set();
  let pageToken = "";
  do {
    const url = new URL(PLAYLIST_ITEMS_URL);
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    try {
      const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      for (const item of data.items || []) {
        const vId = item.contentDetails?.videoId;
        if (vId) ids.add(vId);
      }
      pageToken = data.nextPageToken || "";
    } catch (err) {
      console.warn(`[Warn] Gagal membaca item playlist: ${err.message}`);
      break;
    }
  } while (pageToken);

  return ids;
}

async function insertVideoToPlaylist(accessToken, playlistId, videoId) {
  const url = new URL(PLAYLIST_ITEMS_URL);
  url.searchParams.set("part", "snippet");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId
        }
      }
    })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || res.statusText;
    throw new Error(`Insert gagal: ${msg} [HTTP ${res.status}]`);
  }
}

function isVolcanoGeologyVideo(title) {
  const clean = title.toLowerCase();
  return VOLCANO_KEYWORDS.some((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    return regex.test(clean) || clean.includes(kw);
  });
}

async function main() {
  console.log("==========================================================");
  console.log(`🌋 MEMBUAT & MENGISI PLAYLIST: "${TARGET_PLAYLIST_TITLE}"`);
  console.log("==========================================================");

  const accessToken = await getYoutubeAccessToken();
  console.log("🔑 Access token YouTube berhasil diverifikasi.");

  const playlistId = await getOrCreateTargetPlaylist(accessToken);
  const existingIds = await getExistingPlaylistVideoIds(accessToken, playlistId);
  console.log(`📌 Video yang sudah ada di playlist ini: ${existingIds.size} video.`);

  const uploadsPlaylistId = await getUploadsPlaylistId(accessToken);
  const allVideos = await getAllUploadedVideos(accessToken, uploadsPlaylistId);
  console.log(`🎬 Ditemukan total ${allVideos.length} video yang diunggah di channel.`);

  const matchedVideos = allVideos.filter((v) => isVolcanoGeologyVideo(v.title));
  console.log(`🎯 Ditemukan ${matchedVideos.length} video bertema vulkanologi & geologi:`);
  matchedVideos.forEach((v, i) => {
    console.log(`  ${i + 1}. [${v.id}] ${v.title}`);
  });

  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < matchedVideos.length; i++) {
    const v = matchedVideos[i];
    if (existingIds.has(v.id)) {
      console.log(`  [${i + 1}/${matchedVideos.length}] ⏭️  [SUDAH ADA] "${v.title}"`);
      skippedCount++;
      continue;
    }

    try {
      await insertVideoToPlaylist(accessToken, playlistId, v.id);
      existingIds.add(v.id);
      console.log(`  [${i + 1}/${matchedVideos.length}] ✅ [DITAMBAHKAN] "${v.title}"`);
      addedCount++;
      await sleep(600);
    } catch (err) {
      console.error(`  [${i + 1}/${matchedVideos.length}] ⚠️  [GAGAL] "${v.title}": ${err.message}`);
      failedCount++;
    }
  }

  console.log("\n==========================================================");
  console.log("📊 REKAPITULASI PLAYLIST SUPERVOLCANO & GEOLOGI");
  console.log("==========================================================");
  console.log(`Total video relevan     : ${matchedVideos.length}`);
  console.log(`Video baru dimasukkan   : ${addedCount}`);
  console.log(`Video sudah ada (skip)  : ${skippedCount}`);
  console.log(`Gagal dimasukkan        : ${failedCount}`);
  console.log(`Total isi playlist kini : ${existingIds.size} video`);
  console.log(`Tautan Playlist         : https://www.youtube.com/playlist?list=${playlistId}`);
  console.log("==========================================================");
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err);
  process.exit(1);
});
