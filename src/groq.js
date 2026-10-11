/**
 * groq.js — TTS via Groq (endpoint OpenAI-compatible).
 *
 * Model aktif: canopylabs/orpheus-v1-english (pengganti playai-tts yang
 * dipensiunkan 2025-12-31). Lihat https://console.groq.com/docs/text-to-speech
 *
 * Signature disengaja mirip generateElevenLabsSpeech() / generateOpenAiSpeech():
 *   generateGroqSpeech({ itemId, text, voice, filenameSuffix })
 *     → { provider: "groq", model, voice, speed, path, url }
 *
 * Dipilih lewat YT_TTS_PROVIDER=groq (lihat pipeline.js). Bila gagal, pipeline
 * otomatis mencoba provider lain yang key-nya tersedia (ttsFallbackChain).
 *
 * Catatan Orpheus: output WAV (bukan MP3), tanpa parameter speed/instructions.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

const TTS_TIMEOUT_MS = 120_000;

export async function generateGroqSpeech({ itemId, text, voice, filenameSuffix = "groq" }) {
  assertGroq();
  await fs.mkdir(paths.audioDir, { recursive: true });

  const selectedVoice = String(voice || config.groq.ttsVoice).trim();
  const filename = `${itemId}-${safeFilename(filenameSuffix)}-narration.wav`;
  const outputPath = path.join(paths.audioDir, filename);

  const response = await fetch(`${config.groq.baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.groq.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.groq.ttsModel,
      voice: selectedVoice,
      input: text,
      response_format: "wav"
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Groq TTS gagal HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return {
    provider: "groq",
    model: config.groq.ttsModel,
    voice: selectedVoice,
    speed: 1.0,
    path: outputPath,
    url: `/generated/audio/${filename}`
  };
}

function assertGroq() {
  if (!config.groq.apiKey) throw new Error("GROQ_API_KEY belum diisi.");
}
