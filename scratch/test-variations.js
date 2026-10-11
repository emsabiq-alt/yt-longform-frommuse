import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const fontRegular = path.join(rootDir, "assets", "fonts", "NotoSans-Variable.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const foilImg = path.join(rootDir, "assets", "textures", "gold-foil.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);
const wmDrawtext = `drawtext=fontfile='${fFont}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

function baseGrading(scrimFadeStart, scrimSolidStart) {
  return [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,
    `[2:v]scale=1280:720[embers]`,
    `[bg_scrim][embers]overlay=0:0[bg_particles]`
  ];
}

function runFFmpeg(filterGraph, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", bgImg,
      "-i", foilImg,
      "-i", embersImg,
      "-filter_complex", filterGraph,
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      outFile
    ], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", c => { stderr += c; });
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600) || `FFmpeg failed with ${code}`));
    });
  });
}

// -------------------------------------------------------------
// VARIASI 1: Hero-Keyword Scale (Kontras Ekstrem Kata Kunci Raksasa)
// Kata kunci "MISTERI" Raksasa (125px), baris kedua sedang (65px), penutup besar (95px)
// -------------------------------------------------------------
async function renderVariation1() {
  const lines = [
    { text: "MISTERI", size: 126, color: "0xFF9A00", foil: "amber" },
    { text: "KOTA KUNO YANG HILANG", size: 66, color: "0xFFCC00", foil: "gold" },
    { text: "TANPA JEJAK.", size: 98, color: "0xFF9A00", foil: "amber" }
  ];
  const totalH = 126 * 1.05 + 66 * 1.1 + 98 * 1.05;
  const startY = Math.round(720 - 38 - totalH);

  const scrimParts = baseGrading(Math.max(120, startY - 180), Math.max(260, startY - 20));
  const baseTexts = [];
  const amberMasks = [];
  const goldMasks = [];

  let curY = startY;
  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
    );
    if (l.foil === "amber") {
      amberMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
    } else {
      goldMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
    }
    curY += Math.round(l.size * 1.07);
  });

  const graph = [
    ...scrimParts,
    `[bg_particles]${baseTexts.join(",")}[bg_base]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.5:brightness=0.14,colorbalance=rs=0.22:gs=0.05:bs=-0.20:rm=0.25:gm=0.07:bm=-0.25:rh=0.28:gh=0.10:bh=-0.20[foil_amber]`,
    `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.35:brightness=0.18,colorbalance=rs=0.10:gs=0.10:bs=-0.14:rm=0.14:gm=0.14:bm=-0.18:rh=0.18:gh=0.18:bh=-0.14[foil_gold]`,
    `color=c=black:s=1280x720,${amberMasks.join(",")}[mask_amber]`,
    `color=c=black:s=1280x720,${goldMasks.join(",")}[mask_gold]`,
    `[foil_amber][mask_amber]alphamerge[tex_amber]`,
    `[foil_gold][mask_gold]alphamerge[tex_gold]`,
    `[bg_base][tex_amber]overlay=0:0[layer1]`,
    `[layer1][tex_gold]overlay=0:0[layer2]`,
    `[layer2]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "variation-1-hero-scale.jpg"));
  console.log("[OK] Variasi 1: Hero-Keyword Scale");
}

// -------------------------------------------------------------
// VARIASI 2: Dual-Tone Gold Foil + Diamond White (Emas Foil + Putih Berlian)
// Kontras dramatis antara Emas bertekstur dan Putih Bersinar
// -------------------------------------------------------------
async function renderVariation2() {
  const lines = [
    { text: "MISTERI KOTA KUNO", size: 84, type: "foil", color: "0xFF9A00" },
    { text: "YANG HILANG", size: 106, type: "white", color: "white" },
    { text: "TANPA JEJAK.", size: 84, type: "foil", color: "0xFFCC00" }
  ];
  const totalH = 84 * 1.08 + 106 * 1.08 + 84 * 1.08;
  const startY = Math.round(720 - 38 - totalH);

  const scrimParts = baseGrading(Math.max(120, startY - 180), Math.max(260, startY - 20));
  const baseTexts = [];
  const foilMasks = [];

  let curY = startY;
  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      // Putih berlian dengan 3D drop shadow pekat dan sedikit glow
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
      );
      foilMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
    }
    curY += Math.round(l.size * 1.08);
  });

  const graph = [
    ...scrimParts,
    `[bg_particles]${baseTexts.join(",")}[bg_base]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.5:brightness=0.15,colorbalance=rs=0.20:gs=0.08:bs=-0.18:rm=0.22:gm=0.10:bm=-0.22[foil]`,
    `color=c=black:s=1280x720,${foilMasks.join(",")}[mask_foil]`,
    `[foil][mask_foil]alphamerge[tex_foil]`,
    `[bg_base][tex_foil]overlay=0:0[layer1]`,
    `[layer1]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "variation-2-gold-white.jpg"));
  console.log("[OK] Variasi 2: Gold Foil + Diamond White");
}

// -------------------------------------------------------------
// VARIASI 3: Topic Hook Tag + Massive Title (Pill/Tag Atas + Teks Raksasa 2 Baris)
// Gaya Vox / Netflix Docuseries: ada tag kecil elegan di atas teks utama
// -------------------------------------------------------------
async function renderVariation3() {
  const tagText = "— INVESTIGASI SEJARAH DUNIA —";
  const lines = [
    { text: "KOTA KUNO", size: 108, color: "0xFF9A00" },
    { text: "HILANG TANPA JEJAK.", size: 84, color: "0xFFCC00" }
  ];
  const tagSize = 24;
  const totalH = tagSize * 1.8 + lines[0].size * 1.08 + lines[1].size * 1.08;
  const startY = Math.round(720 - 45 - totalH);

  const scrimParts = baseGrading(Math.max(120, startY - 180), Math.max(260, startY - 20));
  const baseTexts = [];
  const foilMasks = [];

  let curY = startY;
  // Draw top elegant tag
  const escTag = escapeDrawtext(tagText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escTag}':fontsize=${tagSize}:fontcolor=0xFFB300:shadowcolor=black@1.0:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${curY}`
  );
  curY += Math.round(tagSize * 1.8);

  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
    );
    foilMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
    curY += Math.round(l.size * 1.08);
  });

  const graph = [
    ...scrimParts,
    `[bg_particles]${baseTexts.join(",")}[bg_base]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.5:brightness=0.15,colorbalance=rs=0.20:gs=0.08:bs=-0.18:rm=0.22:gm=0.10:bm=-0.22[foil]`,
    `color=c=black:s=1280x720,${foilMasks.join(",")}[mask_foil]`,
    `[foil][mask_foil]alphamerge[tex_foil]`,
    `[bg_base][tex_foil]overlay=0:0[layer1]`,
    `[layer1]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "variation-3-accent-tag.jpg"));
  console.log("[OK] Variasi 3: Topic Hook Tag + Massive Title");
}

// -------------------------------------------------------------
// VARIASI 4: Kinetic Mini-Connectors ("YANG" & "DAN" Mengecil Kompak)
// Kata sambung mengecil 55% di tengah baris, kata aksi/kunci membesar maksimal
// -------------------------------------------------------------
async function renderVariation4() {
  // Line 1: KENAPA MADU (Besar 98px)
  // Line 2: TIDAK PERNAH (Sedang 76px)
  // Line 3: BASI? (Raksasa 128px)
  const lines = [
    { text: "KENAPA MADU", size: 94, color: "0xFFCC00", foil: "gold" },
    { text: "TIDAK PERNAH", size: 72, color: "white", foil: "none" },
    { text: "BASI?!", size: 130, color: "0xFF9A00", foil: "amber" }
  ];
  const totalH = 94 * 1.06 + 72 * 1.08 + 130 * 1.04;
  const startY = Math.round(720 - 35 - totalH);

  const scrimParts = baseGrading(Math.max(120, startY - 180), Math.max(260, startY - 20));
  const baseTexts = [];
  const amberMasks = [];
  const goldMasks = [];

  let curY = startY;
  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    if (l.foil === "none") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
      );
      if (l.foil === "amber") {
        amberMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      } else {
        goldMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      }
    }
    curY += Math.round(l.size * 1.06);
  });

  const graph = [
    ...scrimParts,
    `[bg_particles]${baseTexts.join(",")}[bg_base]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.5:brightness=0.14,colorbalance=rs=0.22:gs=0.05:bs=-0.20:rm=0.25:gm=0.07:bm=-0.25:rh=0.28:gh=0.10:bh=-0.20[foil_amber]`,
    `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.35:brightness=0.18,colorbalance=rs=0.10:gs=0.10:bs=-0.14:rm=0.14:gm=0.14:bm=-0.18:rh=0.18:gh=0.18:bh=-0.14[foil_gold]`,
    `color=c=black:s=1280x720,${amberMasks.join(",")}[mask_amber]`,
    `color=c=black:s=1280x720,${goldMasks.join(",")}[mask_gold]`,
    `[foil_amber][mask_amber]alphamerge[tex_amber]`,
    `[foil_gold][mask_gold]alphamerge[tex_gold]`,
    `[bg_base][tex_amber]overlay=0:0[layer1]`,
    `[layer1][tex_gold]overlay=0:0[layer2]`,
    `[layer2]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "variation-4-kinetic-power.jpg"));
  console.log("[OK] Variasi 4: Kinetic Power Climax");
}

await renderVariation1();
await renderVariation2();
await renderVariation3();
await renderVariation4();
