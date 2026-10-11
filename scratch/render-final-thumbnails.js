import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateThumbnail } from "../src/thumbnail.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoSrc = path.join(rootDir, "generated", "images", "demo-src.jpg");

const cases = [
  {
    id: "demo-31",
    title: "Kenapa Madu Tidak Pernah Basi",
    input: { topic: "madu", channelName: "BANYAK TAU" },
    assets: { images: [{ sceneIndex: 0, path: demoSrc }] }
  },
  {
    id: "demo-32",
    title: "Rahasia Ibnu Sina",
    input: { topic: "ibnu sina", channelName: "BANYAK TAU" },
    assets: { images: [{ sceneIndex: 0, path: demoSrc }] }
  },
  {
    id: "demo-33",
    title: "Otak Kita Ternyata Gampang Ditipu, Ini Alasannya",
    input: { topic: "otak manusia", channelName: "BANYAK TAU" },
    assets: { images: [{ sceneIndex: 0, path: demoSrc }] }
  },
  {
    id: "demo-34",
    title: "Misteri Kota Kuno yang Hilang Tanpa Jejak",
    input: { topic: "kota kuno misteri", channelName: "BANYAK TAU" },
    assets: { images: [{ sceneIndex: 0, path: demoSrc }] }
  }
];

async function main() {
  for (const c of cases) {
    const res = await generateThumbnail(c);
    console.log(`[Thumbnail OK] ${c.id}: ${res.path}`);
  }
}

main().catch(console.error);
