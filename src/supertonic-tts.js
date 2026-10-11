/**
 * supertonic-tts.js — FROMMUSE
 * Provider TTS Bahasa Indonesia via Supertonic (model yang sama dipakai
 * pipeline cinematic untuk film Supervolcano Eropa — suara konsisten).
 * Gratis, tanpa API key, jalan lokal di CPU.
 * Fallback internal ke Piper, lalu gTTS.
 *
 * Kontrak sama seperti provider TTS lain:
 *   generateSupertonicSpeech({ itemId, text, voice, filenameSuffix })
 *     -> { path, provider: "supertonic", voice }
 */
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { config } from "./config.js";
import { generatePiperSpeech } from "./piper-tts.js";

const SUPERTONIC_BIN = config.supertonic?.python || "python3";
const SYNTH_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "supertonic_synth.py"
);

function audioDir() {
  const dir = path.join(process.cwd(), "generated", "audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function generateSupertonicSpeech({
  itemId,
  text,
  voice,
  filenameSuffix = "supertonic",
}) {
  // Pipeline meneruskan options.voice generik (mis. "nova" bawaan OpenAI) yang
  // bukan kode voice Supertonic. Hanya pakai voice yang diteruskan bila cocok
  // pola kode Supertonic (M1..M5/F1..F5); selain itu pakai default config
  // (SUPERTONIC_VOICE, mis. F2) agar tidak pernah melempar "Voice style not found".
  const v = /^[MF][1-5]$/i.test(String(voice || "").trim())
    ? String(voice).trim().toUpperCase()
    : (config.supertonic?.voice || "M2");
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Supertonic TTS: teks kosong.");

  const outWav = path.join(audioDir(), `${itemId}-${filenameSuffix}.wav`);
  try {
    if (!fs.existsSync(SYNTH_SCRIPT)) {
      throw new Error("scripts/supertonic_synth.py tidak ada.");
    }
    await new Promise((resolve, reject) => {
      const env = { ...process.env };
      // Unduh model supertonic butuh NO_PROXY bersih (bug parser httpx)
      delete env.HTTP_PROXY;
      delete env.HTTPS_PROXY;
      delete env.http_proxy;
      delete env.https_proxy;
      const cp = execFile(
        SUPERTONIC_BIN,
        [SYNTH_SCRIPT, "--text", clean, "--out", outWav, "--voice", v],
        { timeout: 300000, env },
        (err) => (err ? reject(err) : resolve())
      );
      cp.on("error", reject);
    });
    const st = fs.statSync(outWav);
    if (!st.size) throw new Error("Supertonic menghasilkan file kosong.");
    return { path: outWav, provider: "supertonic", voice: v };
  } catch (e) {
    console.warn(`[Supertonic] gagal (${e.message}), fallback ke Piper.`);
    const r = await generatePiperSpeech({
      itemId,
      text: clean,
      voice,
      filenameSuffix: `${filenameSuffix}-piper`,
    });
    return { ...r, provider: "supertonic-piper" };
  }
}

export const SUPERTONIC_VOICES = {
  M2: "M2", // pria Indonesia (default film cinematic)
  F2: "F2", // wanita Indonesia
};
