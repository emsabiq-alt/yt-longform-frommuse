import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcImage = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fontPath = path.join(rootDir, "assets", "fonts", "BebasNeue-Regular.ttf").replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
const outputPath = path.join(rootDir, "scratch", "test-cinematic-v4.jpg");

const title = "Misteri Kota Kuno yang Hilang Tanpa Jejak";

function wrapTitleCinematic(str) {
  const words = String(str || "").toUpperCase().trim().split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= 16) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const lines = wrapTitleCinematic(title);
console.log("Lines:", lines);

const totalLines = lines.length;
const baseFontSize = totalLines >= 4 ? 92 : (totalLines === 3 ? 108 : 122);
const firstLineSize = Math.round(baseFontSize * 1.15);
const lastLineSize = Math.round(baseFontSize * 1.05);

const lineGaps = lines.map((_, i) => {
  const s = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
  return Math.round(s * 1.02);
});

const totalH = lineGaps.reduce((a, b) => a + b, 0);
const startY = Math.round(720 - 35 - totalH);

// Color palette from reference:
// Fiery Golden Amber (0xFF9A00) for hook lines
// Radiant Golden Yellow (0xFFC800) for body lines
const COLOR_HOOK = "0xFF9A00";
const COLOR_BODY = "0xFFCC00";

let curY = startY;
const textFilters = [];

lines.forEach((line, i) => {
  const size = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
  const color = (i === 0 || i === totalLines - 1) ? COLOR_HOOK : COLOR_BODY;
  const escaped = line.replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
  
  // Double-pass outline & shadow for extreme crispness:
  textFilters.push(
    `drawtext=fontfile='${fontPath}':text='${escaped}':fontsize=${size}:fontcolor=${color}:borderw=10:bordercolor=black:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
  );
  
  curY += lineGaps[i];
});

// Watermark in top right
const watermark = `drawtext=fontfile='${fontPath}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

// Filtergraph:
// 1. Scale & center crop
// 2. Gritty, moody grading:
//    - Pull down blown-out whites (curves: highlight rolloff)
//    - High contrast, dark moody tone
//    - Subtle warm golden tint on highlights, cool dark shadows
//    - Heavy vignette
// 3. Smooth mathematical scrim:
//    - Subtle top vignette (Y=0..120)
//    - Deep black floor: smooth ramp from Y=140 to 460, pure solid black from Y=460 to 720!
const filterGraph = [
  `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
  `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
  `eq=contrast=1.35:brightness=-0.08:saturation=1.05,` +
  `colorbalance=rs=0.06:gs=0.02:bs=-0.04:rm=0.07:gm=0.02:bm=-0.05:rh=0.10:gh=0.05:bh=-0.02,` +
  `vignette=angle=PI/2.7:mode=backward[graded]`,
  
  `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),140*pow((120-Y)/120,2),if(lt(Y,140),0,if(gt(Y,460),255,255*pow((Y-140)/(460-140),1.4))))'[scrim]`,
  
  `[graded][scrim]overlay=0:0[with_scrim]`,
  
  `[with_scrim]${watermark},${textFilters.join(",")}[out]`
].join(";");

const args = [
  "-y",
  "-i", srcImage,
  "-filter_complex", filterGraph,
  "-map", "[out]",
  "-frames:v", "1",
  "-q:v", "2",
  outputPath
];

console.log("Running v4 render...");
const child = spawn("ffmpeg", args, { stdio: "inherit" });
child.on("close", (code) => {
  if (code === 0) console.log("Render v4 success ->", outputPath);
  else console.error("Failed with code", code);
});
