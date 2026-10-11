/**
 * Fetch foto tokoh (public figure) untuk overlay Spotlight.
 *
 * Strategi (berurutan, berhenti saat berhasil):
 *   1. Google Custom Search Images — jika GOOGLE_CSE_KEY + GOOGLE_CSE_CX tersedia.
 *   2. Wikipedia REST API thumbnail (id lalu en) — gratis, tanpa API key.
 *   3. null → pemanggil cukup skip overlay, tidak crash.
 */

import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { paths } from "./config.js";
import { fetchGoogleImageUrl } from "./google-image.js";
import { isValidImageBuffer, isValidImageFileSync } from "./util.js";

const TIMEOUT_MS = 10_000;
const DL_TIMEOUT_MS = 30_000;

/**
 * Kembalikan URL gambar tokoh atau null jika tidak ditemukan.
 * @param {string} name - Nama tokoh (bebas format)
 * @returns {Promise<string|null>}
 */
export async function fetchPersonImageUrl(name) {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // 1. Google Images Search API (CSE / Serper / SerpApi)
  try {
    const googleResult = await fetchGoogleImageUrl(`${trimmed} portrait photo`);
    if (googleResult?.imageUrl) {
      console.log(`[PersonImage] Google Images: "${trimmed}" → ${googleResult.imageUrl.slice(0, 80)}`);
      return googleResult.imageUrl;
    }
  } catch (err) {
    console.warn(`[PersonImage] Google Images gagal untuk "${trimmed}": ${err.message}`);
  }

  // 2. Wikipedia REST API thumbnail (id → en)
  for (const lang of ["id", "en"]) {
    try {
      const slug = trimmed.replace(/\s+/g, "_");
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const data = await res.json();
        const thumb = data.thumbnail?.source;
        if (thumb) {
          console.log(`[PersonImage] Wikipedia (${lang}): "${trimmed}" → found`);
          return thumb;
        }
      }
    } catch {
      // coba bahasa berikutnya
    }
  }

  console.log(`[PersonImage] Tidak ditemukan foto untuk "${trimmed}"`);
  return null;
}

/**
 * Download URL gambar tokoh ke disk (JPG/PNG).
 * @param {string} imageUrl - URL gambar
 * @param {string} outputPath - Path output lokal
 * @returns {Promise<string>} outputPath
 */
export async function downloadPersonImage(imageUrl, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}-${randomUUID()}.part`;
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(DL_TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("image") && !contentType.includes("octet-stream")) {
      throw new Error(`Invalid content-type: ${contentType}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!isValidImageBuffer(buffer)) {
      throw new Error("Invalid image buffer (magic bytes check failed or size < 1000)");
    }
    await fs.writeFile(tempPath, buffer);
    if (!isValidImageFileSync(tempPath)) {
      throw new Error("Invalid image file on disk");
    }
    await fs.rename(tempPath, outputPath);
    return outputPath;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Fetch + download foto tokoh untuk semua scene yang punya spotlight type "figure".
 * Menyimpan hasilnya di item.assets.figureImages[sceneIndex] = { name, imagePath }.
 * @param {object} item
 */
export async function ensureFigureImages(item) {
  const scenes = item.plan?.scenes || [];
  const figureScenesIndexes = scenes
    .filter((s) => s.spotlight?.type === "figure" && s.spotlight?.label)
    .map((s) => ({ sceneIndex: Number(s.index), name: String(s.spotlight.label) }));

  if (!figureScenesIndexes.length) return;

  if (!item.assets) item.assets = {};
  if (!item.assets.figureImages) item.assets.figureImages = {};

  const figureDir = path.join(paths.generatedDir, "figures");
  await fs.mkdir(figureDir, { recursive: true });

  for (const { sceneIndex, name } of figureScenesIndexes) {
    if (item.assets.figureImages[sceneIndex]) {
      const existing = item.assets.figureImages[sceneIndex]?.imagePath;
      if (existing && isValidImageFileSync(existing)) continue;
      delete item.assets.figureImages[sceneIndex];
    }
    try {
      const imageUrl = await fetchPersonImageUrl(name);
      if (!imageUrl) continue;
      const ext = imageUrl.match(/\.(jpe?g|png|webp)/i)?.[1]?.replace("jpeg", "jpg") || "jpg";
      const imagePath = path.join(figureDir, `figure-scene-${sceneIndex}.${ext}`);
      await downloadPersonImage(imageUrl, imagePath);
      if (isValidImageFileSync(imagePath)) {
        item.assets.figureImages[sceneIndex] = { name, imagePath };
        console.log(`[PersonImage] Scene ${sceneIndex} ("${name}") → ${path.basename(imagePath)}`);
      } else {
        await fs.rm(imagePath, { force: true }).catch(() => {});
        console.warn(`[PersonImage] Scene ${sceneIndex} "${name}" gambar tidak valid, dilewati.`);
      }
    } catch (err) {
      console.warn(`[PersonImage] Scene ${sceneIndex} "${name}" gagal: ${err.message}`);
    }
  }
}
