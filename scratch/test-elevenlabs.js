import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = "4163SRsAG711aPjxNcPF";
const TEXT = "Halo semuanya, selamat datang di channel BanyakTau. Hari ini kita akan membahas sesuatu yang sangat menarik. Jangan lupa subscribe ya.";

const outDir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(outDir, "test-voice.mp3");

async function main() {
  console.log("Generating TTS with ElevenLabs...");
  console.log(`Voice ID: ${VOICE_ID}`);
  console.log(`Text: ${TEXT}`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: TEXT,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true
      }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Error ${res.status}: ${err}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outFile, buffer);
  console.log(`✅ Saved: ${outFile} (${Math.round(buffer.length / 1024)} KB)`);
}

main();
