import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fireGoldImg = path.join(rootDir, "scratch", "masterpiece_fire_gold.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);
const wmDrawtext = `drawtext=fontfile='${fFont}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

function measureUnits(text) {
  let units = 0.0;
  for (const ch of text.toUpperCase()) {
    if ("I!.:;,'|1".includes(ch)) units += 0.33;
    else if ("MW".includes(ch)) units += 1.02;
    else if (ch === " ") units += 0.36;
    else if ("JL".includes(ch)) units += 0.60;
    else if ("FT".includes(ch)) units += 0.68;
    else units += 0.76;
  }
  return units;
}

function layoutJustifiedBlock(lines, targetWidth = 1040, maxHeight = 430) {
  // First pass: compute ideal font size for each line to match targetWidth
  let items = lines.map((line) => {
    const text = line.toUpperCase().trim();
    const units = measureUnits(text);
    // Ideal font size to fill targetWidth
    let size = Math.round(targetWidth / units);
    // Clamp to reasonable limits
    size = Math.min(155, Math.max(68, size));
    return { text, units, size };
  });

  // Check total height with tight line packing (leading 0.98)
  const lineGaps = items.map((it) => Math.round(it.size * 0.98));
  let totalH = lineGaps.reduce((a, b) => a + b, 0);

  // If total height exceeds budget, scale down proportionally
  if (totalH > maxHeight) {
    const scale = maxHeight / totalH;
    items = items.map((it) => ({
      ...it,
      size: Math.round(it.size * scale)
    }));
    totalH = maxHeight;
  }

  return items;
}

function runFFmpeg(filterGraph, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", bgImg,
      "-i", fireGoldImg,
      "-i", embersImg,
      "-filter_complex", filterGraph,
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      outFile
    ], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600) || `FFmpeg failed with ${code}`));
    });
  });
}

async function renderTest(id, lines, outFilename) {
  const targetWidth = lines.length >= 4 ? 1040 : 1050;
  const layout = layoutJustifiedBlock(lines, targetWidth);
  const lineGaps = layout.map((it) => Math.round(it.size * 0.98));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 35 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  layout.forEach((it, i) => {
    const esc = escapeDrawtext(it.text);
    // Base layer: rich golden amber fallback with thick dark outline and deep 3D drop shadow
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=0xFF9E00:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
    );
    // Texture mask
    maskTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(100, startY - 160);
  const scrimSolidStart = Math.max(220, startY - 15);

  const graph = [
    // 1. Graded cinematic background
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    // 2. Pure black scrim floor (seamless, zero banding)
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // 3. Fiery radial ambient backlight halo behind lower text
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='115':b='15':a='120*exp(-((X-640)*(X-640)/(2*320*320) + (Y-${Math.round(startY + totalH*0.75)})*(Y-${Math.round(startY + totalH*0.75)})/(2*85*85)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    // 4. Atmospheric floating embers
    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    // 5. Shadowed & outlined base text
    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    // 6. Radiant Molten Fire Gold overlay masked strictly to text glyphs
    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.05[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[with_title]`,

    // 7. Watermark
    `[with_title]${wmDrawtext}[out]`
  ].join(";");

  const outPath = path.join(rootDir, "scratch", outFilename);
  await runFFmpeg(graph, outPath);
  console.log(`[OK] Rendered ${outFilename}`);
}

async function main() {
  // Reference comparison
  await renderTest(
    "ref",
    ["TEKNOLOGI", "KUNO YANG HILANG", "DAN BELUM BISA", "DIBUAT LAGI."],
    "studio-ref-exact.jpg"
  );

  // Demo 31: Madu
  await renderTest(
    "demo-31",
    ["KENAPA MADU", "TIDAK PERNAH", "BASI?!"],
    "studio-demo-31-madu.jpg"
  );

  // Demo 33: Otak Kita
  await renderTest(
    "demo-33",
    ["OTAK KITA TERNYATA", "GAMPANG DITIPU", "INI ALASANNYA!"],
    "studio-demo-33-otak.jpg"
  );

  // Demo 34: Kota Kuno
  await renderTest(
    "demo-34",
    ["MISTERI KOTA KUNO", "YANG HILANG", "TANPA JEJAK!"],
    "studio-demo-34-kota.jpg"
  );
}

main().catch(console.error);
