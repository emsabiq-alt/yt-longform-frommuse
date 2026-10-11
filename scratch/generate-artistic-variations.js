import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fireGoldImg = path.join(rootDir, "assets", "textures", "gold-foil.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);
const wmDrawtext = `drawtext=fontfile='${fFont}':text='BANYAK TAU':fontsize=26:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=3:shadowy=3:x=w-text_w-45:y=35`;

function runFFmpeg(graph, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", bgImg,
      "-i", fireGoldImg,
      "-i", embersImg,
      "-filter_complex", graph,
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      outFile
    ], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600) || `FFmpeg code ${code}`));
    });
  });
}

// -----------------------------------------------------------------------------
// VARIASI 1: "Sleek Cinema Gold" (Emas Api Proporsional Elegan)
// - Ukuran huruf sedang & proporsional (50px - 64px)
// - Sits in bottom 25% (Y=520..675)
// - Latar atas 75% lega dan dramatis
// - Eyebrow tag emas halus di atas judul
// -----------------------------------------------------------------------------
async function renderVar1(title, lines, outFile) {
  const tagText = "━━━  ARSIP INVESTIGASI SEJARAH  ━━━";
  const tagSize = 16;
  const tagH = Math.round(tagSize * 2.2);

  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const totalH = tagH + lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 40 - totalH); // Sits comfortably at bottom

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  // Tag
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escapeDrawtext(tagText)}':fontsize=${tagSize}:fontcolor=0xFFB800:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${curY}`
  );
  curY += tagH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=4:shadowy=7:x=(w-text_w)/2:y=${curY}`
    );
    maskTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineGaps[i];
  });

  const scrimFadeStart = 370;
  const scrimSolidStart = 490;
  const haloCenterY = Math.round(startY + totalH * 0.65);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    // Scrim hanya di bagian bawah 25%
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),120*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.5))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Halo hangat lembut di belakang teks
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='115*exp(-((X-640)*(X-640)/(2*250*250) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*55*55)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.04[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[layer_gold]`,

    `[layer_gold]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
}

// -----------------------------------------------------------------------------
// VARIASI 2: "Dual-Tone Diamond & Gold" (Putih Bersih + Emas Api Pijar)
// - Baris 1: Diamond White (54px)
// - Baris 2: Diamond White (52px)
// - Baris 3 (Punchline): Molten Fire Gold bersinar (68px)
// - Sangat kontras dan estetik di feed YouTube
// -----------------------------------------------------------------------------
async function renderVar2(title, lines, outFile) {
  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 42 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=4:shadowy=7:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
      );
      maskTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const scrimFadeStart = 370;
  const scrimSolidStart = 490;
  const haloCenterY = Math.round(startY + totalH * 0.75);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),120*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.5))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Halo hangat tepat di belakang punchline emas
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='120*exp(-((X-640)*(X-640)/(2*250*250) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*50*50)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.04[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[layer_gold]`,

    `[layer_gold]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
}

// -----------------------------------------------------------------------------
// VARIASI 3: "Left-Aligned Netflix Docuseries" (Rata Kiri + Pill Badge)
// - Posisi kiri bawah (X=75)
// - Pill Badge kapsul gelap beraksen emas di atas judul
// - Sisi kanan 60% bebas visual
// -----------------------------------------------------------------------------
async function renderVar3(title, badgeText, lines, outFile) {
  const badgeSize = 16;
  const badgeH = Math.round(badgeSize * 2.3);
  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const totalH = badgeH + lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH);
  const startX = 75;

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  // Pill Badge
  const escBadge = escapeDrawtext(badgeText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFD200:box=1:boxcolor=black@0.75:boxborderw=6:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=${startX}:y=${curY}`
  );
  curY += badgeH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=4:shadowy=7:x=${startX}:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=${startX}:y=${curY}`
      );
      maskTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=${startX}:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const scrimFadeStart = 370;
  const scrimSolidStart = 490;
  const haloCenterY = Math.round(startY + totalH * 0.70);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),120*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.5))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Halo di sebelah kiri di belakang teks
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='120*exp(-((X-260)*(X-260)/(2*220*220) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*55*55)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.04[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[layer_gold]`,

    `[layer_gold]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
}

// -----------------------------------------------------------------------------
// VARIASI 4: "The Golden Climax Accent" (Hierarki Kata Kunci Berjenjang)
// - Baris 1 (Keyword Kecil Emas): MISTERI (44px)
// - Baris 2 (Subjek Putih Bersih): KOTA KUNO (64px)
// - Baris 3 (Punchline Emas Pijar): HILANG TANPA JEJAK! (68px)
// -----------------------------------------------------------------------------
async function renderVar4(title, lines, outFile) {
  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 42 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=4:shadowy=7:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
      );
      maskTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const scrimFadeStart = 370;
  const scrimSolidStart = 490;
  const haloCenterY = Math.round(startY + totalH * 0.70);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),120*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.5))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='120*exp(-((X-640)*(X-640)/(2*250*250) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*50*50)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.04[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[layer_gold]`,

    `[layer_gold]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
}

async function main() {
  const scratchDir = path.join(rootDir, "scratch");
  const desktopDir = "C:\\Users\\Lenovo\\Desktop\\Hasil-Thumbnail-Baru";
  await fs.mkdir(desktopDir, { recursive: true });

  // 1. Variasi 1: Sleek Cinema Gold
  const v1Scratch = path.join(scratchDir, "v1-sleek-cinema-gold.jpg");
  await renderVar1(
    "Misteri Kota Kuno yang Hilang Tanpa Jejak",
    [
      { text: "MISTERI KOTA KUNO", size: 58 },
      { text: "YANG HILANG", size: 52 },
      { text: "TANPA JEJAK.", size: 68 }
    ],
    v1Scratch
  );
  await fs.copyFile(v1Scratch, path.join(desktopDir, "Variasi-1-Sleek-Cinema-Gold.jpg"));
  console.log("[OK] Variasi 1 selesai");

  // 2. Variasi 2: Dual-Tone Diamond & Gold
  const v2Scratch = path.join(scratchDir, "v2-dualtone-diamond-gold.jpg");
  await renderVar2(
    "Misteri Kota Kuno yang Hilang Tanpa Jejak",
    [
      { text: "MISTERI KOTA KUNO", size: 56, type: "white" },
      { text: "YANG HILANG", size: 52, type: "white" },
      { text: "TANPA JEJAK!", size: 68, type: "gold" }
    ],
    v2Scratch
  );
  await fs.copyFile(v2Scratch, path.join(desktopDir, "Variasi-2-DualTone-Diamond-Gold.jpg"));
  console.log("[OK] Variasi 2 selesai");

  // 3. Variasi 3: Left-Aligned Netflix Docuseries
  const v3Scratch = path.join(scratchDir, "v3-netflix-docuseries.jpg");
  await renderVar3(
    "Misteri Kota Kuno yang Hilang Tanpa Jejak",
    "◆ DOKUMENTER INVESTIGASI ◆",
    [
      { text: "MISTERI", size: 62, type: "white" },
      { text: "KOTA KUNO YANG HILANG", size: 48, type: "white" },
      { text: "TANPA JEJAK!", size: 68, type: "gold" }
    ],
    v3Scratch
  );
  await fs.copyFile(v3Scratch, path.join(desktopDir, "Variasi-3-Netflix-Docuseries.jpg"));
  console.log("[OK] Variasi 3 selesai");

  // 4. Variasi 4: Hierarki Berjenjang (Kecil -> Sedang -> Emas Pijar)
  const v4Scratch = path.join(scratchDir, "v4-golden-climax-accent.jpg");
  await renderVar4(
    "Misteri Kota Kuno yang Hilang Tanpa Jejak",
    [
      { text: "INVESTIGASI MISTERI", size: 42, type: "gold" },
      { text: "KOTA KUNO YANG HILANG", size: 54, type: "white" },
      { text: "TANPA JEJAK!", size: 70, type: "gold" }
    ],
    v4Scratch
  );
  await fs.copyFile(v4Scratch, path.join(desktopDir, "Variasi-4-Golden-Climax-Accent.jpg"));
  console.log("[OK] Variasi 4 selesai");
}

main().catch(console.error);
