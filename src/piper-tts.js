/**
 * piper-tts.js — FROMMUSE
 * Provider TTS Bahasa Indonesia gratis, tanpa API key, jalan lokal di CPU.
 * Engine: Piper (VITS neural) voice id_ID-news_tts-medium — gaya news anchor,
 * cocok untuk dokumenter. Jauh lebih natural dibanding gTTS.
 * Fallback internal ke Google Translate TTS bila Piper gagal.
 *
 * Kontrak sama seperti provider TTS lain:
 *   generatePiperSpeech({ itemId, text, voice, filenameSuffix })
 *     -> { path, provider: "piper", voice }
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { config } from "./config.js";
const PIPER_BIN = `${process.env.HOME}/workspace/cinematic-venv/bin/python`;
const VOICE_DIR = `${process.env.HOME}/workspace/piper-voices`;
const GTTS_URL = "https://translate.google.com/translate_tts";
const MAX_CHUNK = 180;

function audioDir() {
  const dir = path.join(process.cwd(), "generated", "audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function voiceModel() {
  const v = config.piper?.voice || "id_ID-news_tts-medium";
  return path.join(VOICE_DIR, `${v}.onnx`);
}

async function synthPiper(text, outWav) {
  const model = voiceModel();
  if (!fs.existsSync(model)) {
    throw new Error(`Model Piper tidak ada: ${model}`);
  }
  // CATATAN: opsi `input` di execFile tidak menulis ke stdin di Node 24
  // pada environment ini (terbukti hang bahkan untuk /bin/cat),
  // jadi tulis stdin manual.
  await new Promise((resolve, reject) => {
    const cp = execFile(
      PIPER_BIN,
      ["-m", "piper", "--model", model, "--output_file", outWav],
      { timeout: 120000 },
      (err) => (err ? reject(err) : resolve())
    );
    cp.stdin.on("error", reject);
    cp.stdin.write(text);
    cp.stdin.end();
  });
  const st = fs.statSync(outWav);
  if (!st.size) throw new Error("Piper menghasilkan file kosong.");
}

function chunkText(text) {
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + " " + s).trim().length <= MAX_CHUNK) {
      cur = (cur + " " + s).trim();
    } else {
      if (cur) chunks.push(cur);
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

async function synthGtts(text, outMp3) {
  const parts = [];
  for (const c of chunkText(text)) {
    const url =
      `${GTTS_URL}?ie=UTF-8&q=${encodeURIComponent(c)}&tl=id&client=tw-ob`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`gTTS HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error("gTTS mengembalikan audio kosong.");
    parts.push(buf);
  }
  fs.writeFileSync(outMp3, Buffer.concat(parts));
}

export async function generatePiperSpeech({
  itemId,
  text,
  voice,
  filenameSuffix = "piper",
}) {
  const v = voice || config.piper?.voice || "id_ID-news_tts-medium";
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Piper TTS: teks kosong.");

  const outWav = path.join(audioDir(), `${itemId}-${filenameSuffix}.wav`);
  try {
    await synthPiper(clean, outWav);
    return { path: outWav, provider: "piper", voice: v };
  } catch (e) {
    console.warn(`[Piper] gagal (${e.message}), fallback ke gTTS.`);
    const outMp3 = path.join(audioDir(), `${itemId}-${filenameSuffix}.mp3`);
    await synthGtts(clean, outMp3);
    return { path: outMp3, provider: "piper-gtts", voice: v };
  }
}

export const PIPER_VOICES = {
  news: "id_ID-news_tts-medium",
};
