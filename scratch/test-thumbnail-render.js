/**
 * Render thumbnail baru dengan gambar storyboard yang sudah ada (demo-src.jpg)
 * untuk melihat hasil visual: overlay judul Bebas Neue dua nada, badge kategori,
 * grading sinematik, dan scrim gradasi bawah.
 * Jalankan: node scratch/test-thumbnail-render.js
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateThumbnail } from "../src/thumbnail.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcImage = path.join(rootDir, "generated", "images", "demo-src.jpg");

const cases = [
  // Kategori eksplisit -> badge SAINS, judul 2 baris (putih + gold).
  { id: "demo-31", title: "Kenapa Madu Tidak Pernah Basi", category: "Sains" },
  // Kategori kosong -> deteksi dari judul ("rahasia" -> INVESTIGASI), judul 1 baris.
  { id: "demo-32", title: "Rahasia Ibnu Sina", category: "" },
  // Kategori "random" + judul tanpa keyword -> fallback FAKTA MENARIK, judul panjang (baris ke-3 terpotong).
  { id: "demo-33", title: "Otak Kita Ternyata Gampang Ditipu, Ini Alasannya", category: "random" },
  // Kategori "umum" + keyword "kuno" di judul -> badge SEJARAH.
  { id: "demo-34", title: "Misteri Kota Kuno yang Hilang Tanpa Jejak", category: "umum" }
];

for (const c of cases) {
  const item = {
    id: c.id,
    title: c.title,
    input: { category: c.category },
    assets: {
      images: [
        { path: srcImage, sceneIndex: 0, segmentIndex: 0, provider: "openai", prompt: c.title }
      ]
    }
  };
  const result = await generateThumbnail(item);
  console.log(`[OK] ${c.id} (${c.category || "kosong"}): ${result.path}`);
}
