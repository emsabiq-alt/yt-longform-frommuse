/**
 * Script satu kali: buat playlist YouTube per kategori BanyakTau.
 * Jalankan: node scripts/create-playlists.js
 *
 * Setelah selesai, salin output YOUTUBE_PLAYLISTS ke .env
 */

import dotenv from "dotenv";
dotenv.config();

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAYLISTS_URL = "https://www.googleapis.com/youtube/v3/playlists";

const CATEGORIES = [
  "Sains",
  "Penemuan",
  "Sejarah",
  "Tubuh Manusia",
  "Alam Semesta",
  "Teknologi",
  "Benda Sehari-hari",
  "Tokoh Dunia",
  "Bahasa dan Budaya",
  "Makanan dan Dapur",
  "Material dan Warna",
  "Peta dan Navigasi",
  "Suara dan Musik",
  "Infrastruktur Tersembunyi",
  "Ekologi Mikro",
  "Ekonomi dan Bisnis",
  "Psikologi",
  "Hewan dan Tumbuhan",
  "Luar Angkasa",
  "Arsitektur",
  "Transportasi",
  "Energi",
  "Matematika Sehari-hari",
  "Misteri Sejarah",
];

// Playlist "Umum" sebagai default
const DEFAULT_PLAYLIST_NAME = "Umum";

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Gagal dapat access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function createPlaylist(accessToken, title, description) {
  const res = await fetch(`${PLAYLISTS_URL}?part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      snippet: {
        title: `BanyakTau: ${title}`,
        description: description || `Kumpulan video edukasi kategori ${title} dari BanyakTau.`,
      },
      status: {
        privacyStatus: "public",
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`Gagal buat playlist "${title}": ${msg} [HTTP ${res.status}]`);
  }
  return { id: data.id, title: data.snippet.title };
}

async function main() {
  console.log("=== Membuat Playlist YouTube untuk BanyakTau ===\n");

  const accessToken = await getAccessToken();
  console.log("✅ Access token berhasil.\n");

  const results = [];
  const allNames = [...CATEGORIES, DEFAULT_PLAYLIST_NAME];

  for (const name of allNames) {
    try {
      const result = await createPlaylist(accessToken, name);
      console.log(`✅ ${result.title} → ${result.id}`);
      results.push({ name, id: result.id });
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
    }
    // Rate limit safety
    await new Promise((r) => setTimeout(r, 500));
  }

  // Generate .env format
  const mapping = results
    .filter((r) => r.name !== DEFAULT_PLAYLIST_NAME)
    .map((r) => `${r.name.toLowerCase()}:${r.id}`)
    .join(",");

  const defaultPlaylist = results.find((r) => r.name === DEFAULT_PLAYLIST_NAME);

  console.log("\n\n========== SALIN KE .env ==========\n");
  console.log(`YOUTUBE_PLAYLISTS=${mapping}`);
  if (defaultPlaylist) {
    console.log(`YOUTUBE_DEFAULT_PLAYLIST_ID=${defaultPlaylist.id}`);
  }
  console.log("\n===================================\n");
  console.log(`Total playlist dibuat: ${results.length}/${allNames.length}`);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
