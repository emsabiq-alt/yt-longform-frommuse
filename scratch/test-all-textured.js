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

function wrapTitle(title, maxChars = 18) {
  const clean = String(title || "").replace(/[,:;]+/g, "").trim();
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (`${cur} ${w}`.length <= maxChars) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function renderComplexThumbnail(inputPath, outputPath, title, channelName = "BANYAK TAU") {
  const fFont = escapeDrawtext(fontPath);
  const lines = wrapTitle(title);
  const totalLines = lines.length;

  let baseFontSize = 100;
  if (totalLines === 1) baseFontSize = 118;
  else if (totalLines === 2) baseFontSize = 102;
  else if (totalLines === 3) baseFontSize = 84;
  else baseFontSize = 74;

  const firstLineSize = Math.round(baseFontSize * 1.08);
  const lastLineSize = Math.round(baseFontSize * 1.03);

  const lineGaps = lines.map((_, i) => {
    const s = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
    return Math.round(s * 1.08);
  });

  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 40 - totalH);

  const baseTextDrawtexts = [];
  const amberMaskDrawtexts = [];
  const goldMaskDrawtexts = [];

  let curY = startY;
  lines.forEach((line, i) => {
    const size = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
    const uppercaseText = line.toUpperCase();
    const displayText = (i === totalLines - 1 && totalLines > 1 && !uppercaseText.endsWith("."))
      ? `${uppercaseText}.`
      : uppercaseText;
    const esc = escapeDrawtext(displayText);

    const isHook = (i === 0 || i === totalLines - 1);
    const baseColor = isHook ? "0xFF9A00" : "0xFFCC00";

    baseTextDrawtexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${size}:fontcolor=${baseColor}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=5:shadowy=8:x=(w-text_w)/2:y=${curY}`
    );

    if (isHook) {
      amberMaskDrawtexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      goldMaskDrawtexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const wmText = (channelName || "BANYAK TAU").toUpperCase();
  const wmDrawtext = `drawtext=fontfile='${fFont}':text='${escapeDrawtext(wmText)}':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

  // Dynamic scrim start based on startY
  const scrimFadeStart = Math.max(120, startY - 180);
  const scrimSolidStart = Math.max(260, startY - 20);

  const filterGraphParts = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,
    `[2:v]scale=1280:720[embers]`,
    `[bg_scrim][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTextDrawtexts.join(",")}[bg_with_base]`
  ];

  let currentLayer = "bg_with_base";

  if (amberMaskDrawtexts.length > 0) {
    filterGraphParts.push(
      `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.5:brightness=0.14,colorbalance=rs=0.22:gs=0.05:bs=-0.20:rm=0.25:gm=0.07:bm=-0.25:rh=0.28:gh=0.10:bh=-0.20[foil_amber]`,
      `color=c=black:s=1280x720,${amberMaskDrawtexts.join(",")}[mask_amber]`,
      `[foil_amber][mask_amber]alphamerge[textured_amber]`,
      `[${currentLayer}][textured_amber]overlay=0:0[layer_amber]`
    );
    currentLayer = "layer_amber";
  }

  if (goldMaskDrawtexts.length > 0) {
    filterGraphParts.push(
      `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.35:brightness=0.18,colorbalance=rs=0.10:gs=0.10:bs=-0.14:rm=0.14:gm=0.14:bm=-0.18:rh=0.18:gh=0.18:bh=-0.14[foil_gold]`,
      `color=c=black:s=1280x720,${goldMaskDrawtexts.join(",")}[mask_gold]`,
      `[foil_gold][mask_gold]alphamerge[textured_gold]`,
      `[${currentLayer}][textured_gold]overlay=0:0[layer_gold]`
    );
    currentLayer = "layer_gold";
  }

  filterGraphParts.push(`[${currentLayer}]${wmDrawtext}[out]`);

  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-i", foilImg,
      "-i", embersImg,
      "-filter_complex", filterGraphParts.join(";"),
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      outputPath
    ], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-800) || `FFmpeg failed with code ${code}`));
    });
  });
}

const testCases = [
  { id: "demo-31", title: "Kenapa Madu Tidak Pernah Basi" },
  { id: "demo-32", title: "Rahasia Ibnu Sina" },
  { id: "demo-33", title: "Otak Kita Ternyata Gampang Ditipu, Ini Alasannya" },
  { id: "demo-34", title: "Misteri Kota Kuno yang Hilang Tanpa Jejak" }
];

for (const c of testCases) {
  const outPath = path.join(rootDir, "scratch", `${c.id}-textured.jpg`);
  await renderComplexThumbnail(bgImg, outPath, c.title);
  console.log(`[OK] ${c.id}: ${outPath}`);
}
