import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const foilImg = path.join(rootDir, "assets", "textures", "gold-foil.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);
const wmDrawtext = `drawtext=fontfile='${fFont}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

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
// MASTERPIECE 1: "The Blockbuster Climax + Fiery Ambient Halo"
// Tag Elegan + Baris 1 Emas + Baris 2 Putih Bersih + Baris 3 Raksasa Emas Molten dengan Halo Api
// -------------------------------------------------------------
async function renderMasterpiece1() {
  const tagText = "━━━  INVESTIGASI SAINS & MISTERI  ━━━";
  const lines = [
    { text: "KENAPA MADU", size: 88, color: "0xFFCC00", foil: "gold" },
    { text: "TIDAK PERNAH", size: 70, color: "white", foil: "none" },
    { text: "BASI?!", size: 140, color: "0xFF9A00", foil: "amber" }
  ];

  const tagSize = 22;
  const totalH = tagSize * 2.2 + 88 * 1.05 + 70 * 1.06 + 140 * 1.02;
  const startY = Math.round(720 - 32 - totalH);

  let curY = startY;
  const baseTexts = [];
  const amberMasks = [];
  const goldMasks = [];

  // Top tag
  const escTag = escapeDrawtext(tagText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escTag}':fontsize=${tagSize}:fontcolor=0xFFB700:shadowcolor=black@1.0:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${curY}`
  );
  curY += Math.round(tagSize * 2.2);

  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    if (l.foil === "none") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
      if (l.foil === "amber") {
        amberMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      } else {
        goldMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      }
    }
    curY += Math.round(l.size * (l.size > 100 ? 1.02 : 1.06));
  });

  const scrimFadeStart = Math.max(120, startY - 170);
  const scrimSolidStart = Math.max(260, startY - 15);

  const graph = [
    // Graded background
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.12,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    // Pure black scrim
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Warm fiery ambient halo behind climax text
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='110':b='10':a='120*exp(-((X-640)*(X-640)/(2*280*280) + (Y-610)*(Y-610)/(2*70*70)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    // Floating embers
    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    // Base text
    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    // Highly saturated textured foils
    `[1:v]scale=1280:720,eq=contrast=1.25:saturation=1.6:brightness=0.12,colorbalance=rs=0.25:gs=0.06:bs=-0.22:rm=0.28:gm=0.08:bm=-0.28:rh=0.32:gh=0.10:bh=-0.24[foil_amber]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.45:brightness=0.18,colorbalance=rs=0.12:gs=0.12:bs=-0.15:rm=0.16:gm=0.16:bm=-0.20:rh=0.20:gh=0.20:bh=-0.16[foil_gold]`,

    `color=c=black:s=1280x720,${amberMasks.join(",")}[mask_amber]`,
    `color=c=black:s=1280x720,${goldMasks.join(",")}[mask_gold]`,

    `[foil_amber][mask_amber]alphamerge[tex_amber]`,
    `[foil_gold][mask_gold]alphamerge[tex_gold]`,

    `[bg_base][tex_amber]overlay=0:0[layer1]`,
    `[layer1][tex_gold]overlay=0:0[layer2]`,
    `[layer2]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "masterpiece-1-blockbuster-climax.jpg"));
  console.log("[OK] Masterpiece 1: Blockbuster Climax");
}

// -------------------------------------------------------------
// MASTERPIECE 2: "The Prestige A24 Docuseries"
// Sleek Micro-Pill Tag + Giant 2-Line Sandwich ("KOTA KUNO" Emas Raksasa + "HILANG TANPA JEJAK." Putih-Emas)
// -------------------------------------------------------------
async function renderMasterpiece2() {
  const lines = [
    { text: "KOTA KUNO", size: 122, color: "0xFF9A00", foil: "amber" },
    { text: "YANG HILANG", size: 78, color: "white", foil: "none" },
    { text: "TANPA JEJAK.", size: 94, color: "0xFFCC00", foil: "gold" }
  ];

  const tagText = "◆ ARSIP SEJARAH TERSEMBUNYI ◆";
  const tagSize = 22;
  const totalH = tagSize * 2.2 + 122 * 1.04 + 78 * 1.08 + 94 * 1.04;
  const startY = Math.round(720 - 32 - totalH);

  let curY = startY;
  const baseTexts = [];
  const amberMasks = [];
  const goldMasks = [];

  const escTag = escapeDrawtext(tagText);
  // Tag with sleek background pill box
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escTag}':fontsize=${tagSize}:fontcolor=0xFFD200:box=1:boxcolor=black@0.75:boxborderw=8:shadowcolor=black@1.0:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${curY}`
  );
  curY += Math.round(tagSize * 2.2);

  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    if (l.foil === "none") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
      if (l.foil === "amber") {
        amberMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      } else {
        goldMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      }
    }
    curY += Math.round(l.size * 1.05);
  });

  const scrimFadeStart = Math.max(120, startY - 170);
  const scrimSolidStart = Math.max(260, startY - 15);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.12,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Subtle blue-amber dual halo
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='130':b='20':a='110*exp(-((X-640)*(X-640)/(2*320*320) + (Y-540)*(Y-540)/(2*80*80)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.25:saturation=1.6:brightness=0.12,colorbalance=rs=0.25:gs=0.06:bs=-0.22:rm=0.28:gm=0.08:bm=-0.28:rh=0.32:gh=0.10:bh=-0.24[foil_amber]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.45:brightness=0.18,colorbalance=rs=0.12:gs=0.12:bs=-0.15:rm=0.16:gm=0.16:bm=-0.20:rh=0.20:gh=0.20:bh=-0.16[foil_gold]`,

    `color=c=black:s=1280x720,${amberMasks.join(",")}[mask_amber]`,
    `color=c=black:s=1280x720,${goldMasks.join(",")}[mask_gold]`,

    `[foil_amber][mask_amber]alphamerge[tex_amber]`,
    `[foil_gold][mask_gold]alphamerge[tex_gold]`,

    `[bg_base][tex_amber]overlay=0:0[layer1]`,
    `[layer1][tex_gold]overlay=0:0[layer2]`,
    `[layer2]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "masterpiece-2-prestige-docuseries.jpg"));
  console.log("[OK] Masterpiece 2: Prestige Docuseries");
}

// -------------------------------------------------------------
// MASTERPIECE 3: "The Viral Shock Hybrid"
// Tag Elegan + Teks Raksasa 2 Baris Super Padat + Gold Foil + Pure White
// Kasus: "OTAK KITA" (Emas Raksasa 116px) + "GAMPANG DITIPU!" (Putih Bersinar 100px)
// -------------------------------------------------------------
async function renderMasterpiece3() {
  const tagText = "━━━  PSIKOLOGI & SAINS  ━━━";
  const lines = [
    { text: "OTAK KITA", size: 118, color: "0xFF9A00", foil: "amber" },
    { text: "TERNYATA", size: 68, color: "0xFFCC00", foil: "gold" },
    { text: "GAMPANG DITIPU!", size: 104, color: "white", foil: "none" }
  ];

  const tagSize = 22;
  const totalH = tagSize * 2.2 + 118 * 1.04 + 68 * 1.08 + 104 * 1.04;
  const startY = Math.round(720 - 32 - totalH);

  let curY = startY;
  const baseTexts = [];
  const amberMasks = [];
  const goldMasks = [];

  const escTag = escapeDrawtext(tagText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escTag}':fontsize=${tagSize}:fontcolor=0xFFB700:shadowcolor=black@1.0:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${curY}`
  );
  curY += Math.round(tagSize * 2.2);

  lines.forEach((l) => {
    const esc = escapeDrawtext(l.text);
    if (l.foil === "none") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${l.color}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
      if (l.foil === "amber") {
        amberMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      } else {
        goldMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      }
    }
    curY += Math.round(l.size * 1.05);
  });

  const scrimFadeStart = Math.max(120, startY - 170);
  const scrimSolidStart = Math.max(260, startY - 15);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.12,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Glowing warm halo
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='125*exp(-((X-640)*(X-640)/(2*300*300) + (Y-570)*(Y-570)/(2*80*80)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.25:saturation=1.6:brightness=0.12,colorbalance=rs=0.25:gs=0.06:bs=-0.22:rm=0.28:gm=0.08:bm=-0.28:rh=0.32:gh=0.10:bh=-0.24[foil_amber]`,
    `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.45:brightness=0.18,colorbalance=rs=0.12:gs=0.12:bs=-0.15:rm=0.16:gm=0.16:bm=-0.20:rh=0.20:gh=0.20:bh=-0.16[foil_gold]`,

    `color=c=black:s=1280x720,${amberMasks.join(",")}[mask_amber]`,
    `color=c=black:s=1280x720,${goldMasks.join(",")}[mask_gold]`,

    `[foil_amber][mask_amber]alphamerge[tex_amber]`,
    `[foil_gold][mask_gold]alphamerge[tex_gold]`,

    `[bg_base][tex_amber]overlay=0:0[layer1]`,
    `[layer1][tex_gold]overlay=0:0[layer2]`,
    `[layer2]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", "masterpiece-3-viral-shock.jpg"));
  console.log("[OK] Masterpiece 3: Viral Shock Hybrid");
}

await renderMasterpiece1();
await renderMasterpiece2();
await renderMasterpiece3();
