import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcImage = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fontPath = path.join(rootDir, "assets", "fonts", "BebasNeue-Regular.ttf").replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
const outputPath = path.join(rootDir, "scratch", "test-cinematic-v3.jpg");

// Title to test
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
const baseFontSize = totalLines >= 4 ? 88 : (totalLines === 3 ? 104 : 118);
const firstLineSize = Math.round(baseFontSize * 1.15);
const lastLineSize = Math.round(baseFontSize * 1.05);

const lineGaps = lines.map((_, i) => {
  const s = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
  return Math.round(s * 1.02);
});

const totalH = lineGaps.reduce((a, b) => a + b, 0);
// Position text firmly in the bottom third
const startY = Math.round(720 - 40 - totalH + 10);

// Color palette from reference:
// Fiery Golden Amber (0xFF9E00) for hook lines
// Vivid Golden Yellow (0xFFCA00) for body lines
const COLOR_HOOK = "0xFF9E00";
const COLOR_BODY = "0xFFCC00";

let curY = startY;
const textFilters = [];

lines.forEach((line, i) => {
  const size = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
  const color = (i === 0 || i === totalLines - 1) ? COLOR_HOOK : COLOR_BODY;
  const escaped = line.replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
  
  // Extra bold stroke (borderw=10) and deep black shadow (shadowx=6:shadowy=9) for maximum contrast
  textFilters.push(
    `drawtext=fontfile='${fontPath}':text='${escaped}':fontsize=${size}:fontcolor=${color}:borderw=10:bordercolor=black:shadowcolor=black@0.98:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
  );
  
  curY += lineGaps[i];
});

// Watermark top right
const watermark = `drawtext=fontfile='${fontPath}':text='BANYAK TAU':fontsize=34:fontcolor=white:borderw=4:bordercolor=black@0.85:shadowcolor=black@0.95:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

// Filtergraph:
// 1. Scale & center crop
// 2. Gritty, moody cinematic grading:
//    - contrast=1.42, brightness=-0.16 (crushes blown-out whites into rich stone tone)
//    - saturation=0.95 (cinematic desaturated stone/metal)
//    - colorbalance: warm golden highlights + cool charcoal shadows
//    - vignette: heavy corner darkening
// 3. Smooth mathematical gradient scrim:
//    - Top vignette (Y=0..120)
//    - Deep black floor: starts at Y=140, reaches 0.88 at Y=380, reaches 0.99 at Y=500+
const filterGraph = [
  `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
  `eq=contrast=1.42:brightness=-0.16:saturation=0.95,` +
  `colorbalance=rs=0.06:gs=0.02:bs=-0.04:rm=0.07:gm=0.02:bm=-0.05:rh=0.10:gh=0.05:bh=-0.02,` +
  `vignette=angle=PI/2.8:mode=backward[graded]`,
  
  // Smooth deep scrim
  `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),150*pow((120-Y)/120,2),if(lt(Y,140),0,252*pow((Y-140)/(720-140),1.2)))'[scrim]`,
  
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

console.log("Running v3 render...");
const child = spawn("ffmpeg", args, { stdio: "inherit" });
child.on("close", (code) => {
  if (code === 0) console.log("Render v3 success ->", outputPath);
  else console.error("Failed with code", code);
});
