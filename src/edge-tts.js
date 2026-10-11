/**
 * edge-tts.js — FROMMUSE
 * Provider TTS Bahasa Indonesia gratis, tanpa API key.
 *
 * CATATAN ARSITEKTUR (2026-10-11): Awalnya ditargetkan ke Microsoft Edge
 * Read-Aloud via websocket, tetapi endpoint speech.platform.bing.com
 * tidak bisa ditembus dari VM ini — egress proxy melakukan TLS interception
 * (self-signed cert) dan handshake websocket ditolak (401). Sebagai gantinya
 * modul ini memakai endpoint Google Translate TTS (HTTPS biasa, terbukti
 * jalan via proxy). Suaranya lebih robotik dibanding Edge Neural, tapi
 * fasih Bahasa Indonesia dan gratis. Bila suatu hari Edge bisa ditembus,
 * cukup ganti isi generateEdgeSpeech tanpa mengubah kontrak.
 *
 * Kontrak sama seperti provider TTS lain:
 *   generateEdgeSpeech({ itemId, text, voice, filenameSuffix })
 *     -> { path, provider: "edge", voice }
 */
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";

const TTS_URL = "https://translate.google.com/translate_tts";
const MAX_CHUNK = 180;

function audioDir() {
  const dir = path.join(process.cwd(), "generated", "audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Pecah teks jadi potongan <= MAX_CHUNK, diutamakan di batas kalimat.
function chunkText(text) {
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length <= MAX_CHUNK) {
      cur = (cur + " " + s).trim();
    } else {
      if (cur) chunks.push(cur);
      // Kalimat tunggal yang terlalu panjang: pecah per kata
      let w = "";
      for (const word of s.split(/\s+/)) {
        if ((w + " " + word).trim().length <= MAX_CHUNK) {
          w = (w + " " + word).trim();
        } else {
          if (w) chunks.push(w);
          w = word;
        }
      }
      cur = w;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.filter(Boolean);
}

async function fetchChunk(chunk) {
  const url =
    `${TTS_URL}?ie=UTF-8&q=${encodeURIComponent(chunk)}` +
    `&tl=id&client=tw-ob&ttsspeed=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("TTS mengembalikan audio kosong.");
  return buf;
}

export async function generateEdgeSpeech({
  itemId,
  text,
  voice,
  filenameSuffix = "edge",
}) {
  const v = voice || config.edge?.voice || "id-ID-ArdiNeural";
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Edge TTS: teks kosong.");

  const chunks = chunkText(clean);
  const parts = [];
  for (const c of chunks) {
    parts.push(await fetchChunk(c));
  }

  const outPath = path.join(audioDir(), `${itemId}-${filenameSuffix}.mp3`);
  fs.writeFileSync(outPath, Buffer.concat(parts));
  return { path: outPath, provider: "edge", voice: v };
}

export const EDGE_VOICES = {
  male: "id-ID-ArdiNeural",
  female: "id-ID-GadisNeural",
};
