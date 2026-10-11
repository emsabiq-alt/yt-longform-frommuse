import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";

/**
 * Generate an image using Pollinations.ai API with the configured API key.
 *
 * @param {Object} options
 * @param {string} options.prompt - Text prompt describing the image
 * @param {number} [options.width=1280] - Image width (default 1280 for 16:9)
 * @param {number} [options.height=720] - Image height (default 720 for 16:9)
 * @param {string} [options.model] - Model name (default "flux", or "gptimage-large", "kontext", "turbo")
 * @param {number} [options.seed] - Random seed for reproducible generation
 * @param {string} [options.outputPath] - Local path to save the generated image
 * @returns {Promise<{ path: string, buffer: Buffer, durationMs: number }>}
 */
export async function generatePollinationsImage({
  prompt,
  width = 1280,
  height = 720,
  model,
  seed,
  outputPath
}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("Prompt wajib diisi untuk membuat gambar dengan Pollinations.");
  }

  const apiKey = config.pollinations?.apiKey || process.env.POLLINATIONS_API_KEY || "";
  const selectedModel = model || config.pollinations?.model || "flux";
  const baseUrl = config.pollinations?.baseUrl || "https://image.pollinations.ai";

  const cleanSeed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(prompt.trim());

  const queryParams = new URLSearchParams({
    model: selectedModel,
    width: String(width),
    height: String(height),
    nologo: "true",
    seed: String(cleanSeed)
  });

  if (apiKey) {
    queryParams.set("key", apiKey);
  }

  const requestUrl = `${baseUrl}/prompt/${encodedPrompt}?${queryParams.toString()}`;

  const headers = {
    "User-Agent": "BanyakTauBot/1.0"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const start = Date.now();
  let response;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(requestUrl, { headers });
      if (response.ok) break;

      const errorText = await response.text();
      lastError = new Error(`Pollinations API HTTP ${response.status} (attempt ${attempt}): ${errorText.slice(0, 300)}`);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
  }

  if (!response || !response.ok) {
    throw lastError || new Error("Gagal mengunduh gambar dari Pollinations.ai");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const durationMs = Date.now() - start;

  let targetPath = outputPath;
  if (!targetPath) {
    const filename = `pollinations-${Date.now()}-${cleanSeed}.jpg`;
    targetPath = path.join(paths.generatedDir, "images", filename);
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);

  return {
    path: targetPath,
    buffer,
    durationMs,
    model: selectedModel
  };
}
