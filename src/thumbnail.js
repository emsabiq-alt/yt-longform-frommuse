import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths, config } from "./config.js";
import { safeFilename } from "./util.js";
import { generatePollinationsImage } from "./pollinations.js";

const TITLE_STOP_WORDS = new Set([
  "bagaimana", "kenapa", "mengapa", "yang", "dan", "dari", "untuk", "dengan",
  "pada", "dalam", "sebuah", "ini", "itu", "atau", "the", "a", "an", "of", "to"
]);

function titleTerms(item) {
  return [...new Set(
    `${item?.title || ""} ${item?.input?.topic || ""}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 3 && !TITLE_STOP_WORDS.has(term))
  )];
}

function sceneForImage(item, image) {
  return (item?.plan?.scenes || []).find((scene) => Number(scene?.index) === Number(image?.sceneIndex));
}

function imageContext(item, image) {
  const scene = sceneForImage(item, image) || {};
  const segment = scene.visualSegments?.[Number(image?.segmentIndex) || 0] || {};
  return [
    image?.prompt,
    scene.imagePrompt,
    scene.visualKeywords,
    scene.screenText,
    scene.chapter,
    scene.beatPurpose,
    scene.narration,
    segment.imagePrompt,
    segment.visualKeywords,
    segment.pexelsQuery,
    segment.narrativeContext
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreStoryboardImage(item, image, terms) {
  const context = imageContext(item, image);
  let score = 0;

  for (const term of terms) {
    if (context.includes(term)) score += 10;
  }

  // Adegan pembuka biasanya memperkenalkan inti judul dan merupakan fallback
  // yang paling aman bila kata kunci judul tidak muncul persis di prompt visual.
  const sceneIndex = Number(image?.sceneIndex);
  const segmentIndex = Number(image?.segmentIndex || 0);
  if (sceneIndex === 0) score += 12;
  else if (sceneIndex === 1) score += 6;
  if (segmentIndex === 0) score += 2;
  if (image?.provider === "openai") score += 1;

  return score;
}

/**
 * Urutkan gambar storyboard berdasarkan kedekatan dengan judul/topik.
 * Tidak memanggil model atau API gambar baru: hanya memakai aset yang sudah ada.
 */
export function rankStoryboardImages(item) {
  const terms = titleTerms(item);
  return (item?.assets?.images || [])
    .filter((image) => image?.path)
    .map((image) => ({ image, score: scoreStoryboardImage(item, image, terms) }))
    .sort((a, b) => (
      b.score - a.score
      || Number(a.image.sceneIndex || 0) - Number(b.image.sceneIndex || 0)
      || Number(a.image.segmentIndex || 0) - Number(b.image.segmentIndex || 0)
    ));
}

async function pickExistingStoryboardImage(item) {
  const candidates = rankStoryboardImages(item);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate.image.path);
      return candidate;
    } catch {
      // Aset lama dapat sudah dibersihkan; lanjut ke kandidat berikutnya.
    }
  }
  return null;
}

const FONT_MONTSERRAT = path.join(paths.fontDir, "Montserrat-Black.ttf");
const FONT_BEBAS = path.join(paths.fontDir, "BebasNeue-Regular.ttf");
const FONT_PATH = existsSync(FONT_MONTSERRAT) ? FONT_MONTSERRAT : FONT_BEBAS;

const FOIL_PATH = path.join(paths.rootDir, "assets", "textures", "gold-foil.jpg");
const EMBERS_PATH = path.join(paths.rootDir, "assets", "textures", "embers.png");

/**
 * Filtergraph ffmpeg memakai ":" sebagai pemisah opsi dan "\" sebagai escape,
 * sehingga path absolut Windows ("D:\...") akan terbaca sebagai opsi bila polos.
 */
export function escapeDrawtext(value) {
  return String(value).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

/**
 * Pemenggalan judul sinematik menjadi baris-baris padat dan bertenaga.
 * Mendukung 1 hingga 3 baris (atau maksimal 4 baris untuk judul sangat panjang).
 */
export function wrapTitle(title, maxChars = 18) {
  const clean = String(title || "").replace(/[,:;]+/g, "").trim();
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (`${cur} ${w}`.length <= maxChars) {
      cur += ` ${w}`;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

// Warna tipografi sinematik (berdasarkan referensi poster/thumbnail viral):
// - COLOR_HOOK: Deep Golden Amber (#FF9A00) untuk baris pembuka & penutup yang dramatis.
// - COLOR_BODY: Radiant Golden Yellow (#FFCC00) untuk baris isi yang sangat terang & terbaca.
const COLOR_HOOK = "0xFF9A00";
const COLOR_BODY = "0xFFCC00";

/**
 * Deteksi tag kategori dokumenter bergaya prestisius untuk sub-header di atas judul.
 */
export function detectHookTag(category = "", title = "") {
  const cat = String(category || "").toLowerCase();
  const t = String(title || "").toLowerCase();

  if (cat.includes("sains") || t.includes("sains") || t.includes("otak") || t.includes("alam") || t.includes("madu")) {
    return "[ ARSIP SAINS & PENGETAHUAN ]";
  }
  if (cat.includes("sejarah") || t.includes("sejarah") || t.includes("kuno") || t.includes("sina") || t.includes("perang")) {
    return "[ ARSIP SEJARAH DUNIA ]";
  }
  if (cat.includes("misteri") || t.includes("misteri") || t.includes("rahasia") || t.includes("hilang") || t.includes("jejak")) {
    return "[ ARSIP INVESTIGASI MISTERI ]";
  }
  if (cat.includes("teknologi") || t.includes("teknologi") || t.includes("ai") || t.includes("robot")) {
    return "[ ARSIP TEKNOLOGI & INOVASI ]";
  }
  return "[ ARSIP FAKTA MENARIK ]";
}

function measureUnits(text) {
  let units = 0.0;
  for (const ch of text.toUpperCase()) {
    if ("I!.:;,'|1".includes(ch)) units += 0.33;
    else if ("MW".includes(ch)) units += 1.02;
    else if (ch === " ") units += 0.36;
    else if ("JL".includes(ch)) units += 0.60;
    else if ("FT".includes(ch)) units += 0.68;
    else units += 0.76;
  }
  return Math.max(1, units);
}

function rebalanceLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return lines;
  const result = [...lines];
  const last = result[result.length - 1].trim().split(/\s+/);
  const prev = result[result.length - 2].trim().split(/\s+/);
  if (last.length === 1 && prev.length >= 3) {
    const moved = prev.pop();
    last.unshift(moved);
    result[result.length - 2] = prev.join(" ");
    result[result.length - 1] = last.join(" ");
  }
  return result;
}

function formatEndingPunctuation(text, fullTitle = "") {
  const trimmed = text.trim();
  if (/[.!?]$/.test(trimmed)) return trimmed;
  const lower = fullTitle.toLowerCase();
  if (/^(kenapa|mengapa|bagaimana|benarkah|apakah|siapakah)/.test(lower)) {
    return `${trimmed}?`;
  }
  return `${trimmed}.`;
}

/**
 * Susun tata letak huruf blok proporsional (Justified Block Typography) bergaya sinematik elegan:
 * Ukuran font proporsional dan terukur (50px - 76px) sehingga tidak memadati seluruh layar,
 * menyisakan 70% area atas untuk visual ilustrasi dramatis, sementara teks duduk kokoh di sepertiga bawah.
 */
export function layoutKineticLines(rawLines, targetWidth = 780, maxHeight = 230, fullTitle = "") {
  const balanced = rebalanceLines(rawLines);
  const total = balanced.length;
  if (!total) return [];

  let items = balanced.map((l, i) => {
    let text = l.toUpperCase().trim();
    if (i === total - 1) {
      text = formatEndingPunctuation(text, fullTitle || balanced.join(" "));
    }
    const units = measureUnits(text);
    let size = Math.round(targetWidth / units);
    const maxSize = total === 1 ? 76 : (total === 2 ? 78 : (total === 3 ? 76 : 68));
    size = Math.min(maxSize, Math.max(48, size));
    return {
      text,
      units,
      size,
      type: "foil_gold"
    };
  });

  // Leading rapat (1.02) memberikan ruang napas vertikal yang elegan
  const lineGaps = items.map((it) => Math.round(it.size * 1.02));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);

  if (totalH > maxHeight) {
    const scale = maxHeight / totalH;
    items = items.map((it) => ({
      ...it,
      size: Math.round(it.size * scale)
    }));
  }

  return items;
}

/**
 * Overlay tipografi sinematik kelas studio (fallback drawtext bila filter_complex terpisah).
 */
export function titleOverlay(title, channelName = "") {
  const rawLines = wrapTitle(title);
  if (!rawLines.length) return [];
  const font = escapeDrawtext(FONT_PATH);
  const layout = layoutKineticLines(rawLines, 1040, 430, title);

  const lineHeights = layout.map((l) => Math.round(l.size * 0.98));
  const totalH = lineHeights.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 35 - totalH);

  let curY = startY;
  const filters = [];

  layout.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    filters.push(
      `drawtext=fontfile='${font}':text='${esc}':fontsize=${l.size}:fontcolor=${COLOR_BODY}:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineHeights[i];
  });

  const watermarkText = (channelName || process.env.CHANNEL_NAME || "BANYAK TAU").toUpperCase();
  filters.push(
    `drawtext=fontfile='${font}':text='${escapeDrawtext(watermarkText)}':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`
  );

  return filters;
}

/**
 * Buat thumbnail 16:9 dari gambar storyboard paling relevan, dengan grading sinematik & tipografi emas.
 */
export async function generateThumbnail(item) {
  await fs.mkdir(paths.thumbnailDir, { recursive: true });

  let sourceImagePath = null;
  let provider = "storyboard-image";
  let sceneIndex = null;
  let segmentIndex = 0;

  // 1. Prioritaskan pembuatan background visual 16:9 via Pollinations AI (memakai API key pengguna)
  const hasPollinationsKey = Boolean(config.pollinations?.apiKey || process.env.POLLINATIONS_API_KEY);
  if (hasPollinationsKey) {
    try {
      const topic = item?.input?.topic || item?.title || "misteri sains dan sejarah dunia";
      const prompt = `hyper-detailed cinematic 16:9 landscape, ${topic}, dramatic atmospheric volumetric lighting, award-winning photography, high contrast, 8k resolution, photorealistic`;
      console.log(`[Thumbnail] Menghasilkan latar belakang visual sinematik via Pollinations (${config.pollinations?.model || "flux"})...`);
      const pollinationsRes = await generatePollinationsImage({
        prompt,
        width: 1280,
        height: 720,
        model: config.pollinations?.model || "flux"
      });
      sourceImagePath = pollinationsRes.path;
      provider = "pollinations";
      console.log(`[Thumbnail] Latar belakang Pollinations selesai dalam ${(pollinationsRes.durationMs / 1000).toFixed(1)} detik.`);
    } catch (err) {
      console.warn(`[Thumbnail] Pollinations gagal (${err.message}), beralih ke gambar storyboard...`);
    }
  }

  // 2. Fallback: gunakan gambar storyboard yang sudah ada
  if (!sourceImagePath) {
    const selected = await pickExistingStoryboardImage(item);
    if (!selected) {
      throw new Error("Tidak ada gambar yang tersedia untuk dijadikan thumbnail.");
    }
    sourceImagePath = selected.image.path;
    sceneIndex = selected.image.sceneIndex;
    segmentIndex = selected.image.segmentIndex || 0;
  }

  const filename = `${item.id}-thumbnail-${safeFilename(item.title)}.jpg`;
  const outputPath = path.join(paths.thumbnailDir, filename);
  await optimizeImage(sourceImagePath, outputPath, item.title, item.input?.channelName || "", item.input?.category || "");

  console.log(
    `[Thumbnail] Thumbnail berhasil dirender dengan provider: ${provider}.`
  );

  return {
    path: outputPath,
    url: `/generated/thumbnails/${filename}`,
    provider,
    sourcePath: sourceImagePath,
    sceneIndex,
    segmentIndex
  };
}

/**
 * Grading sinematik blockbuster studio:
 * 1. Kurva filmis & kontras tebal bernuansa moody dengan saturasi seimbang.
 * 2. Film grain mikro 35mm untuk sentuhan tekstur organik tanpa plastik digital.
 * 3. Partikel api / embers melayang hangat di udara memberi kedalaman 3D atmosferik.
 * 4. Halo backlight api hangat tepat di belakang kata klimaks.
 * 5. Scrim gradasi matematis transparan (tidak menutupi pemandangan utama).
 * 6. Tipografi kinetik kiri bawah proporsional (putih + aksen emas cair menyala).
 * 7. Tanpa watermark di pojok kanan atas agar visual tetap bersih.
 */
function optimizeImage(inputPath, outputPath, title = "", channelName = "", category = "") {
  const font = escapeDrawtext(FONT_PATH);
  const rawLines = wrapTitle(title);
  const layout = layoutKineticLines(rawLines, 780, 240, title);

  const hasFoil = existsSync(FOIL_PATH);
  const hasEmbers = existsSync(EMBERS_PATH);

  const lineHeights = layout.map((l) => Math.round(l.size * 1.05));
  const hookTag = detectHookTag(category, title);
  const badgeSize = 16;
  const badgeH = hookTag ? 42 : 0;
  const totalH = badgeH + lineHeights.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 50 - totalH);
  const startX = 65;

  const baseTextDrawtexts = [];
  const maskDrawtexts = [];

  let curY = startY;

  if (hookTag) {
    const escBadge = escapeDrawtext(hookTag);
    baseTextDrawtexts.push(
      `drawtext=fontfile='${font}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFCC00:box=1:boxcolor=black@0.65:boxborderw=8:shadowcolor=black@0.9:shadowx=2:shadowy=2:x=${startX}:y=${curY}`
    );
    curY += badgeH;
  }

  layout.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    const isGold = i > 0 || layout.length === 1;
    const fontColor = isGold ? "0xFFB300" : "white";

    baseTextDrawtexts.push(
      `drawtext=fontfile='${font}':text='${esc}':fontsize=${l.size}:fontcolor=${fontColor}:borderw=4:bordercolor=black@0.9:shadowcolor=black@0.95:shadowx=5:shadowy=7:x=${startX}:y=${curY}`
    );

    if (isGold) {
      maskDrawtexts.push(
        `drawtext=fontfile='${font}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=${startX}:y=${curY}`
      );
    }
    curY += lineHeights[i];
  });

  const scrimFadeStart = Math.max(260, startY - 70);
  const scrimMaxAlpha = 150;
  const haloCenterY = Math.round(startY + totalH * 0.70);

  const filterGraphParts = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.28/0.16 0.72/0.58 1/0.88',` +
    `eq=contrast=1.30:saturation=1.18:brightness=-0.04,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.8:mode=backward[graded_bg]`,

    // Scrim gradasi transparan (tidak pekat, pemandangan tetap tembus pandang)
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,${scrimFadeStart}),0,${scrimMaxAlpha}*pow((Y-${scrimFadeStart})/(720-${scrimFadeStart}),1.4))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Halo cahaya hangat lembut di belakang teks emas
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='130':b='20':a='95*exp(-((X-320)*(X-320)/(2*240*240) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*75*75)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`
  ];

  const ffmpegInputs = ["-y", "-i", inputPath];
  let currentLayer = "bg_halo";
  let nextInputIndex = 1;

  if (hasEmbers) {
    const embersInputIndex = nextInputIndex++;
    ffmpegInputs.push("-i", EMBERS_PATH);
    filterGraphParts.push(
      `[${embersInputIndex}:v]scale=1280:720[embers]`,
      `[${currentLayer}][embers]overlay=0:0[bg_particles]`
    );
    currentLayer = "bg_particles";
  }

  if (baseTextDrawtexts.length > 0) {
    filterGraphParts.push(
      `[${currentLayer}]${baseTextDrawtexts.join(",")}[bg_with_base]`
    );
    currentLayer = "bg_with_base";
  }

  if (hasFoil && layout.length > 0 && maskDrawtexts.length > 0) {
    const foilInputIndex = nextInputIndex++;
    ffmpegInputs.push("-i", FOIL_PATH);
    filterGraphParts.push(
      `[${foilInputIndex}:v]scale=1280:720,eq=contrast=1.18:saturation=1.22:brightness=0.05[fire_gold]`,
      `color=c=black:s=1280x720,${maskDrawtexts.join(",")}[mask_text]`,
      `[fire_gold][mask_text]alphamerge[textured_text]`,
      `[${currentLayer}][textured_text]overlay=0:0[layer_gold]`
    );
    currentLayer = "layer_gold";
  }

  // Tanpa watermark di pojok kanan atas agar visual tetap bersih
  filterGraphParts.push(`[${currentLayer}]copy[out]`);

  ffmpegInputs.push(
    "-filter_complex", filterGraphParts.join(";"),
    "-map", "[out]",
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  );

  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ffmpegInputs, { windowsHide: true, cwd: paths.rootDir });
    const MAX_BUFFER = 64 * 1024;
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_BUFFER);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Optimasi gambar thumbnail gagal (${code})`));
    });
  });
}
