import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcImage = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fontPath = path.join(rootDir, "assets", "fonts", "BebasNeue-Regular.ttf").replace(/\\/g, "/").replace(/['%:]/g, "\\$&");

const cases = [
  { id: "demo-31", title: "Kenapa Madu Tidak Pernah Basi" },
  { id: "demo-32", title: "Rahasia Ibnu Sina" },
  { id: "demo-33", title: "Otak Kita Ternyata Gampang Ditipu, Ini Alasannya" },
  { id: "demo-34", title: "Misteri Kota Kuno yang Hilang Tanpa Jejak" }
];

export function wrapTitleCinematic(str, maxChars = 17) {
  const clean = String(str || "").toUpperCase().replace(/[,:;]+/g, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3); // Max 3 punchy lines
}

function renderCase(c) {
  return new Promise((resolve, reject) => {
    const lines = wrapTitleCinematic(c.title);
    const totalLines = lines.length;
    
    // Dynamic sizing based on number of lines
    let baseFontSize = 114;
    if (totalLines === 1) baseFontSize = 138;
    else if (totalLines === 2) baseFontSize = 120;
    else if (totalLines === 3) baseFontSize = 104;

    const firstLineSize = Math.round(baseFontSize * 1.12);
    const lastLineSize = Math.round(baseFontSize * 1.04);
    
    const lineGaps = lines.map((_, i) => {
      const s = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
      return Math.round(s * 1.03);
    });

    const totalH = lineGaps.reduce((a, b) => a + b, 0);
    const startY = Math.round(720 - 36 - totalH);

    const COLOR_HOOK = "0xFF9A00"; // Deep Golden Amber
    const COLOR_BODY = "0xFFCC00"; // Radiant Golden Yellow

    let curY = startY;
    const textFilters = [];

    lines.forEach((line, i) => {
      const size = i === 0 ? firstLineSize : (i === totalLines - 1 ? lastLineSize : baseFontSize);
      const color = (i === 0 || i === totalLines - 1) ? COLOR_HOOK : COLOR_BODY;
      
      // If last line, optionally add period if 2+ lines for dramatic impact
      const displayLine = (i === totalLines - 1 && totalLines > 1 && !line.endsWith(".")) ? `${line}.` : line;
      const escaped = displayLine.replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
      
      textFilters.push(
        `drawtext=fontfile='${fontPath}':text='${escaped}':fontsize=${size}:fontcolor=${color}:borderw=10:bordercolor=black:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
      
      curY += lineGaps[i];
    });

    const watermark = `drawtext=fontfile='${fontPath}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

    // Filtergraph:
    // Gritty contrast, pulled-down whites, subtle golden-amber warmth, corner vignette, and smooth deep black floor
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

    const out = path.join(rootDir, "scratch", `${c.id}-cinematic.jpg`);
    const args = [
      "-y",
      "-i", srcImage,
      "-filter_complex", filterGraph,
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      out
    ];

    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`[OK] ${c.id}: ${out}`);
        resolve(out);
      } else {
        reject(new Error(`Failed with code ${code}`));
      }
    });
  });
}

for (const c of cases) {
  await renderCase(c);
}
console.log("All cases rendered successfully!");
