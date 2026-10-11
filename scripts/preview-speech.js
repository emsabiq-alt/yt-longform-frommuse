import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config, paths } from "../src/config.js";
import { generateOpenAiSpeech } from "../src/openai.js";

// Compare the same script, voice, and instructions without generating/publishing a video.
const text = "Bayangkan dua planet lahir dari bahan yang hampir sama. Ukurannya mirip, tetapi nasibnya berbeda. Bumi memiliki lautan, sementara permukaan Venus sangat panas. Salah satu pembeda utamanya adalah atmosfer. Lapisan gas yang tebal menahan panas, seperti selimut yang sulit dilepas. Namun, penjelasannya tidak berhenti di sana. Untuk memahami perbedaannya, kita perlu melihat bagaimana udara, air, dan sinar Matahari saling memengaruhi selama perjalanan kedua planet ini.";
const outputDir = path.join(paths.audioDir, "pacing-preview");
await fs.mkdir(outputDir, { recursive: true });
paths.audioDir = outputDir;
const results = [];

for (const speed of [1.08, 1.10]) {
  config.openai.ttsSpeed = speed;
  const audio = await generateOpenAiSpeech({
    itemId: "documentary-preview",
    text,
    filenameSuffix: `speed-${speed.toFixed(2)}`
  });
  const durationSec = Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audio.path
  ], { encoding: "utf8" }).trim());
  const result = {
    speed, voice: audio.voice, model: audio.model, durationSec,
    wordsPerMinute: Math.round(text.split(/\s+/).length * 60 / durationSec),
    filename: path.basename(audio.path)
  };
  results.push(result);
  console.log(JSON.stringify(result));
}

await fs.writeFile(path.join(outputDir, "comparison.json"), JSON.stringify({
  text,
  instructions: config.openai.ttsInstructions,
  note: "Each sample is a separate synthesis; speaking rhythm can vary. Compare clarity and delivery by listening, not duration alone.",
  results
}, null, 2));
