/**
 * YouTube Playlist — otomatis masukkan video ke playlist berdasarkan kategori.
 *
 * Cara pakai di .env:
 *   YOUTUBE_PLAYLISTS=sains:PLxxxxxxx,sejarah:PLyyyyyyy,teknologi:PLzzzzzzz
 *   YOUTUBE_DEFAULT_PLAYLIST_ID=PLaaaaaa   (opsional, fallback jika kategori tidak cocok)
 *
 * Endpoint: https://www.googleapis.com/youtube/v3/playlistItems
 */

import { config } from "./config.js";

const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";

const KNOWN_PLAYLISTS = {
  sains: "PLaENRSm8Kp0c",
  sejarah: "PLUctMDPTart8",
  teknologi: "PLFTzpGW5ZHsI",
  misteri: "PLdHxAx1IybvA",
  bisnis: "PLeqBq0xWwCOY"
};

/**
 * Cari playlist ID yang cocok untuk kategori video.
 * @param {string} category - Kategori video (misal: "sains", "sejarah")
 * @returns {string|null} - Playlist ID atau null jika tidak ditemukan
 */
export function resolvePlaylistId(category) {
  let key = String(category || "").trim().toLowerCase();

  // Group subcategories strictly to the 5 main existing playlists
  if (key.includes("misteri") || key.includes("konspirasi") || key.includes("teori")) {
    key = "misteri";
  } else if (key.includes("bisnis") || key.includes("ekonomi") || key.includes("uang")) {
    key = "bisnis";
  } else if (key.includes("sejarah") || key.includes("tokoh") || key.includes("biografi") || key.includes("budaya")) {
    key = "sejarah";
  } else if (key.includes("teknologi") || key.includes("penemuan") || key.includes("arsitektur") || key.includes("infrastruktur") || key.includes("transportasi") || key.includes("material") || key.includes("benda") || key.includes("peta")) {
    key = "teknologi";
  } else if (key.includes("sain") || key.includes("alam") || key.includes("luar angkasa") || key.includes("gunung") || key.includes("tubuh") || key.includes("hewan") || key.includes("makanan") || key.includes("ekologi")) {
    key = "sains";
  }

  const playlists = config.youtube.playlists;

  // Exact match dulu di config
  if (playlists && playlists.has(key)) return playlists.get(key);

  // Partial match: cari key yang mengandung kata dari kategori
  if (playlists && playlists.size) {
    for (const [mapKey, playlistId] of playlists) {
      if (key.includes(mapKey) || mapKey.includes(key)) return playlistId;
    }
  }

  // Fallback ke mapped known playlists
  if (KNOWN_PLAYLISTS[key]) return KNOWN_PLAYLISTS[key];

  // Fallback ke default playlist
  return config.youtube.defaultPlaylistId || null;
}

/**
 * Tambahkan video ke playlist YouTube via API.
 * @param {object} options
 * @param {string} options.videoId - YouTube video ID
 * @param {string} options.playlistId - Playlist ID tujuan
 * @param {string} options.accessToken - OAuth2 access token
 * @returns {Promise<object>} - Hasil insert
 */
async function insertToPlaylist({ videoId, playlistId, accessToken }) {
  const url = new URL(PLAYLIST_ITEMS_URL);
  url.searchParams.set("part", "snippet");

  const body = {
    snippet: {
      playlistId,
      resourceId: {
        kind: "youtube#video",
        videoId
      }
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail = data.error?.message || data.raw || response.statusText;
    throw new Error(`Playlist insert gagal: ${detail} [HTTP ${response.status}]`);
  }

  return data;
}

/**
 * Otomatis masukkan video ke playlist berdasarkan kategori.
 * Dipanggil setelah video berhasil diupload ke YouTube.
 *
 * @param {object} options
 * @param {string} options.videoId - YouTube video ID
 * @param {string} options.category - Kategori video
 * @param {string} options.accessToken - OAuth2 access token
 * @returns {Promise<object>} - { ok, playlistId, error }
 */
export async function addToPlaylistByCategory({ videoId, category, accessToken }) {
  const playlistId = resolvePlaylistId(category);
  if (!playlistId) {
    return {
      ok: false,
      skipped: true,
      playlistId: null,
      error: "Tidak ada playlist yang dikonfigurasi untuk kategori ini."
    };
  }

  try {
    await insertToPlaylist({ videoId, playlistId, accessToken });
    console.log(`[Playlist] Video ${videoId} berhasil masuk playlist ${playlistId} (kategori: ${category})`);
    return { ok: true, playlistId, error: "" };
  } catch (error) {
    console.warn(`[Playlist] Gagal menambahkan ke playlist: ${error.message}`);
    return { ok: false, playlistId, error: error.message };
  }
}
