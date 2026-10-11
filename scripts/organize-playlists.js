/**
 * Script: Organize YouTube Playlists for BanyakTau (Strict Existing Playlists)
 *
 * Aturan:
 * 1. ROLLBACK: Hapus semua playlist baru ("BanyakTau: ...") yang sempat dibuat sebelumnya.
 * 2. HANYA gunakan playlist yang SUDAH ADA di channel (Sains, Sejarah, Teknologi, Misteri & Konspirasi, Bisnis, Umum).
 * 3. Pelajari setiap video HANYA DARI JUDULNYA lalu masukkan ke playlist yang sudah ada tersebut.
 * 4. Mencegah duplikasi video di playlist yang sama.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.production.local" });
dotenv.config();

import { config } from "../src/config.js";
import { getYoutubeAccessToken } from "../src/youtube-publisher.js";

const PLAYLISTS_URL = "https://www.googleapis.com/youtube/v3/playlists";
const PLAYLIST_ITEMS_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Aturan pemetaan kata kunci judul video ke playlist eksisting
const KEYWORD_MAPPING = [
  {
    target: "Misteri & Konspirasi",
    keywords: [
      "misteri", "konspirasi", "teka-teki", "hilang", "lenyap", "aneh", "belum terpecahkan",
      "rahasia", "tak terduga", "tersembunyi", "segitiga bermuda", "sinyal wow", "atlantis",
      "mitos", "ganjil", "tabu", "rahasia besar", "paradoks", "kutukan", "teori", "alien", "ufo"
    ]
  },
  {
    target: "Bisnis",
    keywords: [
      "bisnis", "ekonomi", "uang", "mata uang", "inflasi", "krisis moneter", "saham", "pasar modal",
      "bank", "perusahaan", "industri", "perdagangan", "kekayaan", "triliun", "miliarder",
      "utang", "pajak", "kebijakan", "kapitalisme", "omset", "kuota haji", "rupiah", "juta rupiah",
      "harga", "mahal", "dibanderol"
    ]
  },
  {
    target: "Teknologi",
    keywords: [
      "teknologi", "komputer", "internet", "microchip", "chip", "robot", "ai", "kecerdasan buatan",
      "mesin", "algoritma", "radar", "baterai", "listrik", "nuklir", "inovasi", "kamera", "ponsel",
      "gadget", "software", "hardware", "iphone", "apple", "steve jobs", "barcode", "microwave",
      "arsitektur", "infrastruktur", "bangunan", "jembatan", "gedung", "menara", "menara pisa",
      "terowongan", "bendungan", "st. francis", "pipa", "kanal", "konstruksi", "teknik sipil",
      "kapal", "perahu", "pesawat", "terbang", "helikopter", "mobil", "kereta", "lokomotif",
      "rel", "kapal selam", "mesin uap", "pelabuhan", "bandara", "boeing", "titanic", "diciptakan", "penemuan"
    ]
  },
  {
    target: "Sejarah",
    keywords: [
      "sejarah", "zaman", "purba", "kuno", "peradaban", "kekaisaran", "kerajaan", "raja",
      "ratu", "kaisar", "firaun", "mesir", "piramida", "romawi", "yunani", "sumeria",
      "dinasti", "perang", "kolonial", "revolusi", "abad", "arkeolog", "fosil", "prasasti",
      "candi", "artefak", "tiongkok", "nusantara", "majapahit", "voc", "masa lalu",
      "nikola tesla", "tesla", "tokoh", "sosok", "biografi", "habibie", "einstein", "da vinci",
      "fakta nikola tesla", "pesan rahasia", "dunia perang"
    ]
  },
  {
    target: "Sains",
    keywords: [
      "sains", "fisika", "kimia", "biologi", "sel", "atom", "molekul", "gaya", "magnet",
      "kuantum", "cahaya", "gelombang", "suhu", "panas", "dingin", "es", "air", "gas",
      "tekanan", "evolusi", "dna", "genetika", "bakteri", "virus", "mikroba", "madu",
      "zat", "ilmiah", "eksperimen", "mengapa", "kenapa", "alasan", "bukti", "hukum archimedes",
      "alam semesta", "tata surya", "luar angkasa", "planet", "bintang", "galaksi", "matahari",
      "bulan", "mars", "jupiter", "saturnus", "venus", "meteor", "komet", "asteroid", "lubang hitam",
      "supernova", "antariksa", "astronot", "roket", "nasa", "apollo", "satelit", "teleskop", "materi gelap",
      "gunung", "letusan", "erupsi", "toba", "krakatau", "merapi", "lahar", "gempa",
      "tsunami", "badai", "petir", "kilat", "banjir", "danau toba", "anak krakatau",
      "tubuh", "manusia", "otak", "memori", "tidur", "mimpi", "mata", "telinga", "jantung",
      "darah", "paru-paru", "otot", "tulang", "bau badan", "patah", "penyakit", "imun", "kekebalan",
      "hewan", "binatang", "satwa", "mamalia", "reptil", "burung", "ikan", "paus", "hiu",
      "serangga", "lebah", "semut", "dinosaurus", "habitat", "ekosistem", "hutan", "tumbuhan",
      "makanan", "kuliner", "dapur", "masak", "kopi", "teh", "cokelat", "gula", "garam", "fermentasi", "basi", "awet"
    ]
  }
];

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

/**
 * Ambil playlist uploads channel
 */
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

/**
 * Ambil seluruh playlist yang dimiliki channel
 */
async function getAllPlaylists(accessToken) {
  const playlists = [];
  let pageToken = "";
  do {
    const url = new URL(PLAYLISTS_URL);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("mine", "true");
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    for (const pl of data.items || []) {
      playlists.push({
        id: pl.id,
        title: pl.snippet?.title || "",
        description: pl.snippet?.description || "",
        itemCount: pl.contentDetails?.itemCount || 0
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return playlists;
}

/**
 * Hapus playlist dari YouTube
 */
async function deletePlaylist(accessToken, playlistId) {
  const url = new URL(PLAYLISTS_URL);
  url.searchParams.set("id", playlistId);
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Delete failed: ${text} [HTTP ${res.status}]`);
  }
}

/**
 * Ambil seluruh video yang diunggah ke channel
 */
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

/**
 * Ambil video-video yang sudah ada di masing-masing playlist (menghindari duplikasi)
 */
async function getPlaylistItemsMap(accessToken, playlists) {
  const map = new Map(); // playlistId -> Set<videoId>

  for (const pl of playlists) {
    const videoSet = new Set();
    let pageToken = "";
    do {
      const url = new URL(PLAYLIST_ITEMS_URL);
      url.searchParams.set("part", "contentDetails");
      url.searchParams.set("playlistId", pl.id);
      url.searchParams.set("maxResults", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      try {
        const data = await fetchJson(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        for (const item of data.items || []) {
          const vId = item.contentDetails?.videoId;
          if (vId) videoSet.add(vId);
        }
        pageToken = data.nextPageToken || "";
      } catch (err) {
        console.warn(`[Warn] Gagal fetch item playlist ${pl.id} ("${pl.title}"): ${err.message}`);
        break;
      }
    } while (pageToken);

    map.set(pl.id, videoSet);
    await sleep(200);
  }

  return map;
}

/**
 * Klasifikasi judul video menggunakan AI (HANYA ke playlist yang tersedia)
 */
async function classifyVideosWithAi(videos, allowedPlaylists) {
  if (!config.openai.apiKey) return null;

  try {
    const playlistOptions = allowedPlaylists.map((p) => `- ID: "${p.id}", Nama Playlist: "${p.title}"`).join("\n");
    const videoEntries = videos.map((v) => `- ID: "${v.id}", Judul: "${v.title}"`).join("\n");

    const prompt = `Berikut adalah playlist YouTube yang SUDAH ADA di channel BanyakTau:
${playlistOptions}

Berikut adalah daftar video yang diunggah (ID dan Judul):
${videoEntries}

Tugas:
Analisis HANYA BERDASARKAN JUDUL setiap video, dan tentukan SATU playlist PALING COCOK dari daftar playlist yang SUDAH ADA di atas.
DILARANG MEMBUAT PLAYLIST BARU. Wajib memilih ID dari daftar yang diberikan di atas.

Kembalikan HANYA format JSON valid tanpa markdown:
{
  "classifications": [
    { "videoId": "ID_VIDEO", "playlistId": "ID_PLAYLIST", "reason": "alasan singkat 3-5 kata" }
  ]
}`;

    const res = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.storyModel || "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Kamu adalah kurator YouTube. Tugasmu memetakan video ke playlist yang SUDAH ADA hanya dari membaca judulnya. Jangan membuat playlist baru." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });

    if (!res.ok) {
      console.warn(`[AI] OpenAI request gagal (${res.status}), fallback ke aturan semantik.`);
      return null;
    }

    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    if (Array.isArray(parsed.classifications) && parsed.classifications.length > 0) {
      const mapping = new Map();
      const validPlaylistIds = new Set(allowedPlaylists.map((p) => p.id));
      for (const item of parsed.classifications) {
        if (item.videoId && item.playlistId && validPlaylistIds.has(item.playlistId)) {
          mapping.set(item.videoId, item.playlistId);
        }
      }
      return mapping;
    }
  } catch (err) {
    console.warn(`[AI] Error selama klasifikasi AI: ${err.message}, fallback ke aturan semantik.`);
  }
  return null;
}

/**
 * Klasifikasi judul video berbasis kata kunci semantik (ke playlist yang sudah ada)
 */
function classifyVideoByKeywords(title, allowedPlaylists) {
  const cleanTitle = title.toLowerCase();

  // 1. Cek kecocokan kategori dengan skor tertinggi
  let bestTarget = "";
  let highestScore = 0;

  for (const mapping of KEYWORD_MAPPING) {
    let score = 0;
    for (const kw of mapping.keywords) {
      if (cleanTitle.includes(kw)) {
        score += kw.length > 6 ? 3 : 2;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestTarget = mapping.target;
    }
  }

  // 2. Cari playlist yang judulnya cocok dengan target kategori
  if (bestTarget && highestScore > 0) {
    const matched = allowedPlaylists.find((p) => {
      const pTitle = p.title.toLowerCase();
      const targetLower = bestTarget.toLowerCase();
      return pTitle.includes(targetLower) || targetLower.includes(pTitle);
    });
    if (matched) return matched;
  }

  // 3. Fallback: Cari playlist yang judulnya sama dengan kata di judul video
  for (const p of allowedPlaylists) {
    if (p.title.toLowerCase() === "umum") continue;
    const words = p.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => cleanTitle.includes(w))) {
      return p;
    }
  }

  // 4. Default ke "Umum" jika ada, atau playlist pertama
  return allowedPlaylists.find((p) => p.title.toLowerCase() === "umum") || allowedPlaylists[0];
}

/**
 * Tambahkan video ke playlist
 */
async function insertVideoToPlaylist(accessToken, playlistId, videoId) {
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

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || res.statusText;
    throw new Error(`Insert gagal: ${msg} [HTTP ${res.status}]`);
  }
}

/**
 * MAIN EXECUTION
 */
async function main() {
  console.log("==========================================================");
  console.log("🔄 MEMULAI ROLLBACK & PENATAAN KE PLAYLIST YANG SUDAH ADA");
  console.log("==========================================================");

  const accessToken = await getYoutubeAccessToken();
  console.log("🔑 Access token YouTube berhasil diverifikasi.");

  // 1. Ambil seluruh playlist saat ini
  let playlists = await getAllPlaylists(accessToken);
  console.log(`\n📂 Ditemukan ${playlists.length} playlist saat ini:`);
  playlists.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.id}] "${p.title}" (${p.itemCount} video)`);
  });

  // 2. ROLLBACK: Hapus 9 playlist "BanyakTau: ..." yang baru dibuat tadi
  const newlyCreatedPlaylists = playlists.filter((p) => p.title.startsWith("BanyakTau:"));
  if (newlyCreatedPlaylists.length > 0) {
    console.log(`\n🗑️  Melakukan ROLLBACK: Menghapus ${newlyCreatedPlaylists.length} playlist baru yang sempat dibuat...`);
    for (const pl of newlyCreatedPlaylists) {
      try {
        await deletePlaylist(accessToken, pl.id);
        console.log(`  🗑️ [DIHAPUS] "${pl.title}" [${pl.id}]`);
        await sleep(500);
      } catch (err) {
        console.warn(`  ⚠️ Gagal menghapus "${pl.title}": ${err.message}`);
      }
    }
    // Perbarui daftar playlist hanya ke playlist asli
    playlists = playlists.filter((p) => !p.title.startsWith("BanyakTau:"));
  }

  console.log(`\n✅ Playlist ASLI yang dipertahankan (${playlists.length} playlist):`);
  playlists.forEach((p, idx) => {
    console.log(`  ${idx + 1}. [${p.id}] "${p.title}"`);
  });

  // 3. Ambil seluruh video yang diunggah
  const uploadsPlaylistId = await getUploadsPlaylistId(accessToken);
  const videos = await getAllUploadedVideos(accessToken, uploadsPlaylistId);
  console.log(`\n🎬 Ditemukan total ${videos.length} video yang diunggah di channel.`);

  // 4. Petakan item yang sudah ada di masing-masing playlist asli
  console.log(`\n🔍 Memetakan item video yang sudah ada di playlist asli...`);
  const playlistItemsMap = await getPlaylistItemsMap(accessToken, playlists);
  console.log("✅ Pemetaan selesai.");

  // 5. Klasifikasikan video HANYA ke playlist asli yang tersedia
  console.log(`\n🧠 Mengklasifikasi judul video ke playlist yang sudah ada...`);
  const aiMappings = await classifyVideosWithAi(videos, playlists);
  if (aiMappings) {
    console.log(`🤖 Klasifikasi AI berhasil memetakan ${aiMappings.size} video ke playlist asli.`);
  } else {
    console.log(`💡 Menggunakan klasifikasi taksonomi semantik kata kunci judul.`);
  }

  // 6. Masukkan video ke playlist asli yang sesuai
  console.log(`\n📥 Memulai penempatan video ke playlist yang sudah ada:`);
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    let targetPlaylistId = aiMappings ? aiMappings.get(video.id) : null;
    let targetPlaylist = playlists.find((p) => p.id === targetPlaylistId);

    if (!targetPlaylist) {
      targetPlaylist = classifyVideoByKeywords(video.title, playlists);
    }

    if (!targetPlaylist) {
      console.warn(`  [${i + 1}/${videos.length}] ❌ Tidak ada playlist cocok untuk "${video.title}"`);
      totalFailed++;
      continue;
    }

    // Cek apakah sudah ada di playlist target
    const currentItems = playlistItemsMap.get(targetPlaylist.id) || new Set();
    if (currentItems.has(video.id)) {
      console.log(`  [${i + 1}/${videos.length}] ⏭️  [SUDAH ADA] "${video.title}" → "${targetPlaylist.title}"`);
      totalSkipped++;
      continue;
    }

    // Tambahkan ke playlist
    try {
      await insertVideoToPlaylist(accessToken, targetPlaylist.id, video.id);
      currentItems.add(video.id);
      playlistItemsMap.set(targetPlaylist.id, currentItems);
      console.log(`  [${i + 1}/${videos.length}] ✅ [DITAMBAHKAN] "${video.title}" → "${targetPlaylist.title}"`);
      totalAdded++;
      await sleep(600); // safety rate-limit YouTube API
    } catch (err) {
      console.error(`  [${i + 1}/${videos.length}] ⚠️  [GAGAL] "${video.title}" → "${targetPlaylist.title}": ${err.message}`);
      totalFailed++;
    }
  }

  // 7. Cetak Rekapitulasi Akhir
  console.log("\n==========================================================");
  console.log("📊 REKAPITULASI PENATAAN PLAYLIST (HANYA PLAYLIST ASLI)");
  console.log("==========================================================");
  console.log(`Total video diperiksa    : ${videos.length}`);
  console.log(`Video baru dimasukkan    : ${totalAdded}`);
  console.log(`Video sudah ada (skip)   : ${totalSkipped}`);
  console.log(`Gagal dimasukkan         : ${totalFailed}`);
  console.log("----------------------------------------------------------");
  console.log("📋 Struktur Playlist Akhir:");
  for (const pl of playlists) {
    const count = (playlistItemsMap.get(pl.id) || new Set()).size;
    console.log(`  - "${pl.title}": ${count} video`);
  }
  console.log("==========================================================");
  console.log("🎉 Rollback dan penataan playlist selesai!");
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err);
  process.exit(1);
});
