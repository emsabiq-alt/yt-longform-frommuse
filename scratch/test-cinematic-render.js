import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcImage = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fontPath = path.join(rootDir, "assets", "fonts", "BebasNeue-Regular.ttf").replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
const outputPath = path.join(rootDir, "scratch", "test-cinematic-output.jpg");

// Title to test
const title = "Misteri Kota Kuno yang Hilang Tanpa Jejak";

function wrapTitleSmart(str, maxChars = 17) {
  const words = String(str || "").toUpperCase().trim().split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (`${current} ${w}`.length <= maxChars) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const lines = wrapTitleSmart(title);
console.log("Wrapped lines:", lines);

const numLines = lines.length;
const fontSize = numLines >= 3 ? 96 : (numLines === 2 ? 108 : 124);
const lineGap = Math.round(fontSize * 1.06);
const totalTextHeight = numLines * lineGap;
const bottomPadding = 48;
const startY = Math.round(720 - bottomPadding - totalTextHeight + (fontSize * 0.15));

const GOLD_ACCENT = "0xFFA800";
const GOLD_MAIN = "0xFFC400";

const textFilters = lines.map((line, idx) => {
  const y = startY + idx * lineGap;
  const escapedLine = line.replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
  const color = (idx === 0 || idx === lines.length - 1) ? GOLD_ACCENT : GOLD_MAIN;
  return `drawtext=fontfile='${fontPath}':text='${escapedLine}':fontsize=${fontSize}:fontcolor=${color}:borderw=8:bordercolor=black@0.95:shadowcolor=black@0.9:shadowx=5:shadowy=7:x=(w-text_w)/2:y=${y}`;
});

const watermark = `drawtext=fontfile='${fontPath}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@0.8:shadowx=3:shadowy=3:x=w-text_w-50:y=45`;

const filterGraph = [
  `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
  `eq=contrast=1.34:brightness=-0.06:saturation=1.18,` +
  `colorbalance=rs=0.05:gs=0.02:bs=-0.03:rm=0.06:gm=0.02:bm=-0.04:rh=0.09:gh=0.04:bh=-0.02,` +
  `vignette=angle=PI/3.3:mode=backward[graded]`,
  
  `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,130),150*pow((130-Y)/130,2),if(lt(Y,250),0,250*pow((Y-250)/(720-250),1.6)))'[scrim]`,
  
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

console.log("Running ffmpeg render...");
const child = spawn("ffmpeg", args, { stdio: "inherit" });
child.on("close", (code) => {
  if (code === 0) console.log("Render success ->", outputPath);
  else console.error("Render failed with code", code);
});
