import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcImage = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fontPath = path.join(rootDir, "assets", "fonts", "BebasNeue-Regular.ttf").replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
const outputPath = path.join(rootDir, "scratch", "test-cinematic-v2.jpg");

const title = "Misteri Kota Kuno yang Hilang Tanpa Jejak";

function wrapTitleCinematic(str) {
  const words = String(str || "").toUpperCase().trim().split(/\s+/);
  // Break into 3-4 impactful lines like movie posters
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

// Hierarchy:
// Line 1 is the major hook (e.g. MISTERI KOTA KUNO) - larger font!
// Last line is punchline - bold accent!
const totalLines = lines.length;
const baseFontSize = totalLines >= 4 ? 86 : (totalLines === 3 ? 100 : 116);
const firstLineSize = Math.round(baseFontSize * 1.15);
const lastLineSize = Math.round(baseFontSize * 1.05);

const lineGaps = lines.map((_, i) => {
  const s = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
  return Math.round(s * 1.04);
});

const totalH = lineGaps.reduce((a, b) => a + b, 0);
const startY = Math.round(720 - 45 - totalH + 15);

// Color palette from the reference image:
// Hook lines: Deep Fiery Amber Gold (#FFA000 -> 0xFFA000)
// Supporting lines: Radiant Yellow Gold (#FFCA00 -> 0xFFCA00)
const COLOR_HOOK = "0xFFA000";
const COLOR_BODY = "0xFFCC00";

let curY = startY;
const textFilters = [];

lines.forEach((line, i) => {
  const size = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
  const color = (i === 0 || i === totalLines - 1) ? COLOR_HOOK : COLOR_BODY;
  const escaped = line.replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
  
  // Layer 1: Heavy black 3D shadow + outline
  // Layer 2: Core colored text
  textFilters.push(
    `drawtext=fontfile='${fontPath}':text='${escaped}':fontsize=${size}:fontcolor=${color}:borderw=9:bordercolor=black@0.98:shadowcolor=black@0.95:shadowx=6:shadowy=8:x=(w-text_w)/2:y=${curY}`
  );
  
  curY += lineGaps[i];
});

// Watermark in top right (like "TWH" in the reference)
const watermark = `drawtext=fontfile='${fontPath}':text='BANYAK TAU':fontsize=34:fontcolor=white:borderw=4:bordercolor=black@0.85:shadowcolor=black@0.9:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

// Filtergraph:
// 1. Scale & center crop
// 2. Gritty, moody, dark cinematic grading (crushed blacks, rich warm highlights)
// 3. Smooth bottom black fade (from Y=160 downward) + subtle top vignette
const filterGraph = [
  `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
  `eq=contrast=1.38:brightness=-0.12:saturation=1.12,` +
  `colorbalance=rs=0.06:gs=0.02:bs=-0.04:rm=0.07:gm=0.02:bm=-0.05:rh=0.10:gh=0.05:bh=-0.02,` +
  `vignette=angle=PI/3.0:mode=backward[graded]`,
  
  // Deep smooth scrim:
  // Top: subtle fade from Y=0 to Y=120
  // Bottom: starts fading at Y=160, reaches ~0.8 at Y=380, reaches 0.98 at Y=540+
  `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),140*pow((120-Y)/120,2),if(lt(Y,160),0,250*pow((Y-160)/(720-160),1.35)))'[scrim]`,
  
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

console.log("Running v2 render...");
const child = spawn("ffmpeg", args, { stdio: "inherit" });
child.on("close", (code) => {
  if (code === 0) console.log("Render v2 success ->", outputPath);
  else console.error("Failed with code", code);
});
