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

const fFont = escapeDrawtext(fontPath);

function detectHookTag(category = "", title = "") {
  const cat = (category || "").toLowerCase();
  const t = (title || "").toLowerCase();

  if (cat.includes("sains") || t.includes("sains") || t.includes("otak") || t.includes("alam")) {
    return "[ ARSIP SAINS & PENGETAHUAN ]";
  }
  if (cat.includes("sejarah") || t.includes("sejarah") || t.includes("kuno") || t.includes("sina")) {
    return "[ ARSIP SEJARAH DUNIA ]";
  }
  if (cat.includes("misteri") || t.includes("misteri") || t.includes("rahasia") || t.includes("hilang")) {
    return "[ ARSIP INVESTIGASI MISTERI ]";
  }
  return "[ ARSIP FAKTA MENARIK ]";
}

function wrapTitleKinetic(title, maxChars = 17) {
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

function layoutKineticLines(rawLines) {
  const total = rawLines.length;
  if (total === 1) {
    const chars = rawLines[0].length;
    const size = Math.min(104, Math.floor(1080 / (chars * 0.74)));
    return [{ text: rawLines[0].toUpperCase(), size, type: "foil_amber" }];
  }
  if (total === 2) {
    // Line 1: Hero (large), Line 2: Climax
    const s1 = Math.min(116, Math.floor(1080 / (rawLines[0].length * 0.74)));
    const s2 = Math.min(94, Math.floor(1080 / (rawLines[1].length * 0.74)));
    return [
      { text: rawLines[0].toUpperCase(), size: s1, type: "foil_amber" },
      { text: `${rawLines[1].toUpperCase()}.`, size: s2, type: "white" }
    ];
  }
  if (total === 3) {
    // Line 1: Hero Opener (Gold Foil)
    // Line 2: Context / Connector (White)
    // Line 3: Climax (Jumbo Gold Foil)
    const s1 = Math.min(94, Math.floor(1080 / (rawLines[0].length * 0.74)));
    const s2 = Math.min(74, Math.floor(1080 / (rawLines[1].length * 0.74)));
    const s3 = Math.min(124, Math.floor(1080 / (rawLines[2].length * 0.74)));
    const lastText = rawLines[2].toUpperCase();
    const formattedLast = (!lastText.endsWith(".") && !lastText.endsWith("!") && !lastText.endsWith("?"))
      ? `${lastText}!`
      : lastText;
    return [
      { text: rawLines[0].toUpperCase(), size: s1, type: "foil_amber" },
      { text: rawLines[1].toUpperCase(), size: s2, type: "white" },
      { text: formattedLast, size: s3, type: "foil_gold" }
    ];
  }
  // 4 lines: 1 (Foil), 2 (Gold), 3 (White), 4 (Foil Climax)
  return rawLines.map((l, i) => {
    const size = Math.min(78, Math.floor(1080 / (l.length * 0.74)));
    const type = (i === 0 || i === 3) ? "foil_amber" : (i === 2 ? "white" : "foil_gold");
    return { text: l.toUpperCase(), size, type };
  });
}

function renderKineticThumbnail(inputPath, outputPath, title, category = "", channelName = "BANYAK TAU") {
  const rawLines = wrapTitleKinetic(title);
  const tagText = detectHookTag(category, title);
  const layout = layoutKineticLines(rawLines);

  const tagSize = 22;
  const tagH = tagSize * 2.2;
  const lineHeights = layout.map(l => Math.round(l.size * (l.size > 100 ? 1.03 : 1.07)));
  const totalH = tagH + lineHeights.reduce((a, b) => a + b, 0);
  const startY = Math.round(720 - 32 - totalH);

  let curY = startY;
  const baseTexts = [];
  const amberMasks = [];
  const goldMasks = [];

  // Tag
  const escTag = escapeDrawtext(tagText);
  baseTexts.push(
    `drawtext=fontfile='${fFont}':text='${escTag}':fontsize=${tagSize}:fontcolor=0xFFB700:shadowcolor=black@1.0:shadowx=2:shadowy=3:x=(w-text_w)/2:y=${curY}`
  );
  curY += Math.round(tagH);

  let climaxY = curY;
  layout.forEach((l, i) => {
    const esc = escapeDrawtext(l.text);
    if (i === layout.length - 1) climaxY = curY;

    if (l.type === "white") {
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:borderw=3:bordercolor=black@0.9:shadowcolor=black@1.0:shadowx=6:shadowy=10:x=(w-text_w)/2:y=${curY}`
      );
    } else {
      const baseColor = l.type === "foil_amber" ? "0xFF9A00" : "0xFFCC00";
      baseTexts.push(
        `drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=${baseColor}:borderw=2:bordercolor=black@0.6:shadowcolor=black@1.0:shadowx=6:shadowy=9:x=(w-text_w)/2:y=${curY}`
      );
      if (l.type === "foil_amber") {
        amberMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      } else {
        goldMasks.push(`drawtext=fontfile='${fFont}':text='${esc}':fontsize=${l.size}:fontcolor=white:x=(w-text_w)/2:y=${curY}`);
      }
    }
    curY += lineHeights[i];
  });

  const wmText = (channelName || "BANYAK TAU").toUpperCase();
  const wmDrawtext = `drawtext=fontfile='${fFont}':text='${escapeDrawtext(wmText)}':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

  const scrimFadeStart = Math.max(120, startY - 170);
  const scrimSolidStart = Math.max(260, startY - 15);

  const filterGraphParts = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
    `eq=contrast=1.35:brightness=-0.08:saturation=1.12,` +
    `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
    `noise=alls=6:allf=t+u,` +
    `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,${scrimFadeStart}),0,if(gt(Y,${scrimSolidStart}),255,255*pow((Y-${scrimFadeStart})/(${scrimSolidStart}-${scrimFadeStart}),1.4))))'[scrim]`,

    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    // Dynamic warm fiery halo behind climax
    `color=c=black:s=1280x720,format=rgba,geq=r='255':g='115':b='15':a='125*exp(-((X-640)*(X-640)/(2*290*290) + (Y-${climaxY})*(Y-${climaxY})/(2*75*75)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[2:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseTexts.join(",")}[bg_base]`
  ];

  let currentLayer = "bg_base";
  let foilInputIndex = 1;

  if (amberMasks.length > 0) {
    filterGraphParts.push(
      `[1:v]scale=1280:720,eq=contrast=1.25:saturation=1.6:brightness=0.12,colorbalance=rs=0.25:gs=0.06:bs=-0.22:rm=0.28:gm=0.08:bm=-0.28:rh=0.32:gh=0.10:bh=-0.24[foil_amber]`,
      `color=c=black:s=1280x720,${amberMasks.join(",")}[mask_amber]`,
      `[foil_amber][mask_amber]alphamerge[tex_amber]`,
      `[${currentLayer}][tex_amber]overlay=0:0[layer_amber]`
    );
    currentLayer = "layer_amber";
  }

  if (goldMasks.length > 0) {
    filterGraphParts.push(
      `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.45:brightness=0.18,colorbalance=rs=0.12:gs=0.12:bs=-0.15:rm=0.16:gm=0.16:bm=-0.20:rh=0.20:gh=0.20:bh=-0.16[foil_gold]`,
      `color=c=black:s=1280x720,${goldMasks.join(",")}[mask_gold]`,
      `[foil_gold][mask_gold]alphamerge[tex_gold]`,
      `[${currentLayer}][tex_gold]overlay=0:0[layer_gold]`
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
    child.stderr.on("data", c => { stderr += c; });
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600) || `FFmpeg failed with ${code}`));
    });
  });
}

const cases = [
  { id: "demo-31", title: "Kenapa Madu Tidak Pernah Basi", category: "Sains" },
  { id: "demo-32", title: "Rahasia Ibnu Sina", category: "Sejarah" },
  { id: "demo-33", title: "Otak Kita Ternyata Gampang Ditipu Ini Alasannya", category: "Sains" },
  { id: "demo-34", title: "Misteri Kota Kuno yang Hilang Tanpa Jejak", category: "Misteri" }
];

for (const c of cases) {
  const outPath = path.join(rootDir, "scratch", `${c.id}-kinetic-peak.jpg`);
  await renderKineticThumbnail(bgImg, outPath, c.title, c.category);
  console.log(`[OK] ${c.id}: ${outPath}`);
}
