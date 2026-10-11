import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fireGoldImg = path.join(rootDir, "assets", "textures", "gold-foil.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);

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
// VARIAN 1: "Sleek Cinema Gold - Translucent Atmosphere"
// - Background scrim semi-transparan (max alpha ~170), latar belakang terlihat samar di bawah teks.
// - Tanpa watermark "BANYAK TAU" di pojok kanan atas.
// - Simetris tengah, badge pill `[ ARSIP INVESTIGASI SEJARAH ]`.
// - Huruf emas api bercahaya dengan bayangan hitam tegas.
// -----------------------------------------------------------------------------
async function renderVarian1(outFile, maxAlpha = 175) {
  const badgeText = "[ ARSIP INVESTIGASI SEJARAH ]";
  const badgeSize = 16;
  const lines = [
    { text: "MISTERI KOTA KUNO", size: 60 },
    { text: "YANG HILANG", size: 54 },
    { text: "TANPA JEJAK.", size: 72 }
  ];

  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const badgeH = Math.round(badgeSize * 2.2);
  const totalH = badgeH + lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  const escBadge = escapeDrawtext(badgeText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFC000:box=1:boxcolor=black@0.65:boxborderw=6:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${curY}`
  );
  curY += badgeH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3.5:bordercolor=black@0.95:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
    );
    maskTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(200, startY - 90);
  const haloCenterY = Math.round(startY + totalH * 0.70);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    // Scrim semi-transparan halus (tidak 100% hitam pekat, artwork di belakang tetap tembus pandang)
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,${scrimFadeStart}),0,${maxAlpha}*pow((Y-${scrimFadeStart})/(720-${scrimFadeStart}),1.4))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Halo hangat lembut
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='125':b='15':a='115*exp(-((X-640)*(X-640)/(2*260*260) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*65*65)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.22:brightness=0.05[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
  console.log("[OK] Rendered Varian 1 (Translucent):", outFile);
}

// -----------------------------------------------------------------------------
// VARIAN 2: "Docuseries Dual-Tone - Translucent Atmosphere"
// - Background semi-transparan, visual belakang tetap tampak hidup.
// - Tanpa watermark di pojok kanan atas.
// - Baris 1 & 2 Diamond White, Baris 3 Radiant Molten Gold.
// -----------------------------------------------------------------------------
async function renderVarian2(outFile, maxAlpha = 175) {
  const badgeText = "[ DOKUMENTER INVESTIGASI ]";
  const badgeSize = 16;
  const lines = [
    { text: "MISTERI KOTA KUNO", size: 60, type: "white" },
    { text: "YANG HILANG", size: 54, type: "white" },
    { text: "TANPA JEJAK.", size: 74, type: "gold" }
  ];

  const lineGaps = lines.map((l) => Math.round(l.size * 1.05));
  const badgeH = Math.round(badgeSize * 2.2);
  const totalH = badgeH + lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 45 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  const escBadge = escapeDrawtext(badgeText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFC800:box=1:boxcolor=black@0.65:boxborderw=6:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=(w-text_w)/2:y=${curY}`
  );
  curY += badgeH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3.5:bordercolor=black@0.95:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3.5:bordercolor=black@0.95:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
      maskTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(200, startY - 90);
  const haloCenterY = Math.round(startY + totalH * 0.75);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,${scrimFadeStart}),0,${maxAlpha}*pow((Y-${scrimFadeStart})/(720-${scrimFadeStart}),1.4))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='130':b='20':a='125*exp(-((X-640)*(X-640)/(2*270*270) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*60*60)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.22:brightness=0.05[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
  console.log("[OK] Rendered Varian 2 (Translucent):", outFile);
}

// -----------------------------------------------------------------------------
// VARIAN 3: "Netflix Asymmetrical - Translucent Atmosphere"
// - Teks di kiri bawah, background semi-transparan, visual samping & bawah tembus pandang.
// - Tanpa watermark di pojok kanan atas.
// -----------------------------------------------------------------------------
async function renderVarian3(outFile, maxAlpha = 175) {
  const badgeText = "[ DOKUMENTER INVESTIGASI ]";
  const badgeSize = 16;
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

  const escBadge = escapeDrawtext(badgeText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escBadge}':fontsize=${badgeSize}:fontcolor=0xFFD200:box=1:boxcolor=black@0.65:boxborderw=6:shadowcolor=black@1.0:shadowx=2:shadowy=2:x=${startX}:y=${curY}`
  );
  curY += badgeH;

  lines.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3.5:bordercolor=black@0.95:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=${startX}:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=0xFF9800:borderw=3.5:bordercolor=black@0.95:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=${startX}:y=${curY}`
      );
      maskTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=${startX}:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(200, startY - 90);
  const haloCenterY = Math.round(startY + totalH * 0.70);

  // Gradient fokus di kiri bawah dengan maxAlpha lembut
  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=5:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,${scrimFadeStart}),0,${maxAlpha}*pow((Y-${scrimFadeStart})/(720-${scrimFadeStart}),1.4))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='120':b='15':a='125*exp(-((X-280)*(X-280)/(2*240*240) + (Y-${haloCenterY})*(Y-${haloCenterY})/(2*65*65)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.22:brightness=0.05[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[out]`
  ].join(";");

  await runFFmpeg(graph, outFile);
  console.log("[OK] Rendered Varian 3 (Translucent):", outFile);
}

// -----------------------------------------------------------------------------
// VARIAN 1B: "Ultra-Translucent Light Film" (Max Alpha 145 ~ 57% Opacity)
// - Khusus bagi yang menginginkan latar belakang paling tembus pandang dan menyatu dengan gambar asli.
// -----------------------------------------------------------------------------
async function renderVarian1B(outFile) {
  return renderVarian1(outFile, 145);
}

async function main() {
  const desktopDir = "C:\\Users\\Lenovo\\Desktop\\Hasil-Thumbnail-Baru";
  await fs.mkdir(desktopDir, { recursive: true });

  console.log("Rendering refined variations with translucent background & NO watermark...");
  await renderVarian1(path.join(desktopDir, "Variasi-1-Sleek-Cinema-Gold.jpg"), 175);
  await renderVarian2(path.join(desktopDir, "Variasi-2-DualTone-Diamond-Gold.jpg"), 175);
  await renderVarian3(path.join(desktopDir, "Variasi-3-Netflix-Docuseries.jpg"), 175);
  await renderVarian1B(path.join(desktopDir, "Variasi-4-Ultra-Transparan.jpg"));
  console.log("All variations updated on Desktop!");
}

main().catch(console.error);
