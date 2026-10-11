import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fireGoldImg = path.join(rootDir, "assets", "textures", "gold-foil.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);
const wmDrawtext = `drawtext=fontfile='${fFont}':text='BANYAK TAU':fontsize=28:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=3:shadowy=3:x=w-text_w-45:y=35`;

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
// OPSI 1: "Sleek Centered Cinema"
// Ukuran huruf pas (56px - 72px), blok proporsional di tengah bawah,
// membiarkan 70% gambar atas terlihat jelas dan dramatis.
// -----------------------------------------------------------------------------
async function renderOption1(outFile) {
  const lines = [
    { text: "MISTERI KOTA KUNO", size: 62 },
    { text: "YANG HILANG", size: 56 },
    { text: "TANPA JEJAK.", size: 72 }
  ];

  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH); // Y sekitar 480..675

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
    );
    maskTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(160, startY - 140);
  const scrimSolidStart = Math.max(280, startY - 10);
  const haloCenterY = Math.round(startY + totalH * 0.65);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    // Scrim ramping lebih halus di bawah
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),120*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.5))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Soft warm backlight halo
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='115*exp(-((X-640)*(X-640)/(2*260*260) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*65*65)))'[halo]`,
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
  console.log("[OK] Rendered Opsi 1:", outFile);
}

// -----------------------------------------------------------------------------
// OPSI 2: "Dual-Tone Contrast + Sleek Scale"
// Baris 1: Emas Api (60px), Baris 2: Putih Bersinar (64px), Baris 3: Emas Api (72px)
// -----------------------------------------------------------------------------
async function renderOption2(outFile) {
  const lines = [
    { text: "MISTERI KOTA KUNO", size: 60, type: "gold" },
    { text: "YANG HILANG", size: 66, type: "white" },
    { text: "TANPA JEJAK.", size: 72, type: "gold" }
  ];

  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
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

  const scrimFadeStart = Math.max(160, startY - 140);
  const scrimSolidStart = Math.max(280, startY - 10);
  const haloCenterY = Math.round(startY + totalH * 0.65);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),120*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.5))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='115*exp(-((X-640)*(X-640)/(2*260*260) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*65*65)))'[halo]`,
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
  console.log("[OK] Rendered Opsi 2:", outFile);
}

// -----------------------------------------------------------------------------
// OPSI 3: "Prestige Docuseries (Micro Badge + Refined Typography)"
// Badge elegan `[ ARSIP SEJARAH DUNIA ]` di atas, teks 3 baris proporsional
// -----------------------------------------------------------------------------
async function renderOption3(outFile) {
  const badgeText = "━━━  ARSIP SEJARAH DUNIA  ━━━";
  const badgeSize = 18;
  const lines = [
    { text: "MISTERI KOTA KUNO", size: 60 },
    { text: "YANG HILANG", size: 54 },
    { text: "TANPA JEJAK.", size: 70 }
  ];

  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const badgeH = Math.round(badgeSize * 2.4);
  const totalH = badgeH + lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  // Badge
  const escBadge = escapeDrawtext(badgeText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFB700:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${curY}`
  );
  curY += badgeH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
    );
    maskTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(160, startY - 140);
  const scrimSolidStart = Math.max(280, startY - 10);
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

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='115*exp(-((X-640)*(X-640)/(2*260*260) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*65*65)))'[halo]`,
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
  console.log("[OK] Rendered Opsi 3:", outFile);
}

// -----------------------------------------------------------------------------
// OPSI 4: "Left-Aligned Netflix Blockbuster"
// Teks diletakkan di sisi kiri bawah (X=80), menyisakan 60% layar kanan
// untuk memperlihatkan wajah/visual secara dramatis & cinematic.
// -----------------------------------------------------------------------------
async function renderOption4(outFile) {
  const badgeText = "DOKUMENTER INVESTIGASI";
  const badgeSize = 18;
  const lines = [
    { text: "MISTERI", size: 68, type: "white" },
    { text: "KOTA KUNO YANG HILANG", size: 50, type: "white" },
    { text: "TANPA JEJAK!", size: 76, type: "gold" }
  ];

  const lineGaps = lines.map((l) => Math.round(l.size * 1.06));
  const badgeH = Math.round(badgeSize * 2.3);
  const totalH = badgeH + lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH);
  const startX = 80;

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  // Badge with pill background
  const escBadge = escapeDrawtext(badgeText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFD200:box=1:boxcolor=black@0.75:boxborderw=6:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=${startX}:y=${curY}`
  );
  curY += badgeH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=${startX}:y=${curY}`
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

  // Scrim sudut kiri bawah (radial gradient / linear ramp dari kiri bawah)
  const scrimFadeStart = Math.max(160, startY - 140);
  const scrimSolidStart = Math.max(280, startY - 10);
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

    // Halo di sebelah kiri di belakang teks klimaks
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='125*exp(-((X-280)*(X-280)/(2*240*240) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*65*65)))'[halo]`,
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
  console.log("[OK] Rendered Opsi 4:", outFile);
}

async function main() {
  await renderOption1(path.join(rootDir, "scratch", "sleek-opsi1-centered-cinema.jpg"));
  await renderOption2(path.join(rootDir, "scratch", "sleek-opsi2-dualtone-contrast.jpg"));
  await renderOption3(path.join(rootDir, "scratch", "sleek-opsi3-prestige-docuseries.jpg"));
  await renderOption4(path.join(rootDir, "scratch", "sleek-opsi4-left-aligned-netflix.jpg"));
}

main().catch(console.error);
