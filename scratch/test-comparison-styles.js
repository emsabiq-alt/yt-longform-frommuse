import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const fireGoldImg = path.join(rootDir, "scratch", "divine_fire_gold.jpg");
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

function layoutJustified(lines, targetWidth = 1040, maxHeight = 430) {
  let items = lines.map((l) => {
    const text = l.toUpperCase().trim();
    const units = measureUnits(text);
    let size = Math.round(targetWidth / units);
    size = Math.min(160, Math.max(72, size));
    return { text, units, size };
  });

  const lineGaps = items.map((it) => Math.round(it.size * 0.98));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  if (totalH > maxHeight) {
    const scale = maxHeight / totalH;
    items = items.map((it) => ({
      ...it,
      size: Math.round(it.size * scale)
    }));
  }
  return items;
}

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

// Render with Pure Unified Molten Fire Gold
async function renderUnifiedGold(lines, outFilename) {
  const items = layoutJustified(lines);
  const lineGaps = items.map((it) => Math.round(it.size * 0.98));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 35 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  items.forEach((it, i) => {
    const esc = escapeDrawtext(it.text);
    baseTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=0xFF9800:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
    );
    maskTexts.push(
      `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
    );
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(100, startY - 160);
  const scrimSolidStart = Math.max(220, startY - 15);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='115':b='15':a='120*exp(-((X-640)*(X-640)/(2*320*320) + (Y-${Math.round(startY + totalH*0.75)})*(Y-${Math.round(startY + totalH*0.75)})/(2*85*85)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.04[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[with_title]`,

    `[with_title]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", outFilename));
  console.log("[OK] Rendered Unified:", outFilename);
}

// Render with Dual-Tone (Molten Gold + Diamond White Middle Line)
async function renderDualTone(lines, outFilename) {
  const items = layoutJustified(lines);
  const lineGaps = items.map((it) => Math.round(it.size * 0.98));
  const totalH = lineGaps.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 35 - totalH);

  let curY = startY;
  const baseTexts = [];
  const maskTexts = [];

  items.forEach((it, i) => {
    const esc = escapeDrawtext(it.text);
    const isWhite = (items.length >= 3 && i === 1);

    if (isWhite) {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=white:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=0xFF9800:borderw=4:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
      maskTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${it.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`
      );
    }
    curY += lineGaps[i];
  });

  const scrimFadeStart = Math.max(100, startY - 160);
  const scrimSolidStart = Math.max(220, startY - 15);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='115':b='15':a='120*exp(-((X-640)*(X-640)/(2*320*320) + (Y-${Math.round(startY + totalH*0.75)})*(Y-${Math.round(startY + totalH*0.75)})/(2*85*85)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`,

    `[1:v]scale=1280:720,eq=contrast=1.15:saturation=1.2:brightness=0.04[fire_gold]`,
    `color=c=black:s=1280x720,${maskTexts.join(",")}[mask_text]`,
    `[fire_gold][mask_text]alphamerge[textured_text]`,
    `[bg_base][textured_text]overlay=0:0[with_title]`,

    `[with_title]${wmDrawtext}[out]`
  ].join(";");

  await runFFmpeg(graph, path.join(rootDir, "scratch", outFilename));
  console.log("[OK] Rendered Dual-Tone:", outFilename);
}

async function runAll() {
  // Case 33: Otak Kita
  await renderUnifiedGold(
    ["OTAK KITA TERNYATA", "GAMPANG DITIPU", "INI ALASANNYA!"],
    "comp-33-unified.jpg"
  );
  await renderDualTone(
    ["OTAK KITA TERNYATA", "GAMPANG DITIPU", "INI ALASANNYA!"],
    "comp-33-dualtone.jpg"
  );

  // Case 34: Kota Kuno
  await renderUnifiedGold(
    ["MISTERI KOTA KUNO", "YANG HILANG", "TANPA JEJAK!"],
    "comp-34-unified.jpg"
  );
  await renderDualTone(
    ["MISTERI KOTA KUNO", "YANG HILANG", "TANPA JEJAK!"],
    "comp-34-dualtone.jpg"
  );
}

runAll().catch(console.error);
