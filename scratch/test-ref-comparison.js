import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fontPath = path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf");
const bgImg = path.join(rootDir, "generated", "images", "demo-src.jpg");
const foilImg = path.join(rootDir, "assets", "textures", "gold-foil.jpg");
const embersImg = path.join(rootDir, "assets", "textures", "embers.png");
const outImg = path.join(rootDir, "scratch", "test_ref_text_comparison.jpg");

function escapeDrawtext(val) {
  return String(val).replace(/\\/g, "/").replace(/['%:]/g, "\\$&");
}

const fFont = escapeDrawtext(fontPath);

const lines = [
  "TEKNOLOGI",
  "KUNO YANG HILANG",
  "DAN BELUM BISA",
  "DIBUAT LAGI."
];

// Reference proportions:
// Line 1 ("TEKNOLOGI") is prominent
// Lines 2 & 3 ("KUNO YANG HILANG", "DAN BELUM BISA")
// Line 4 ("DIBUAT LAGI.")
const fontSizes = [88, 72, 72, 88];
const lineGaps = fontSizes.map(s => Math.round(s * 1.06));
const totalH = lineGaps.reduce((a, b) => a + b, 0);
const startY = Math.round(720 - 35 - totalH);

const baseTextDrawtexts = [];
const amberMaskDrawtexts = [];
const goldMaskDrawtexts = [];

let curY = startY;
lines.forEach((line, i) => {
  const esc = escapeDrawtext(line);
  const size = fontSizes[i];
  const isHook = (i === 0 || i === lines.length - 1);
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

const wmDrawtext = `drawtext=fontfile='${fFont}':text='BANYAK TAU':fontsize=32:fontcolor=white:borderw=3:bordercolor=black@0.8:shadowcolor=black@1.0:shadowx=4:shadowy=4:x=w-text_w-50:y=40`;

const filterGraph = [
  `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
  `curves=all='0/0 0.3/0.18 0.7/0.52 1/0.78',` +
  `eq=contrast=1.35:brightness=-0.08:saturation=1.1,` +
  `colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.08:gm=0.03:bm=-0.06:rh=0.12:gh=0.06:bh=-0.03,` +
  `noise=alls=6:allf=t+u,` +
  `vignette=angle=PI/2.7:mode=backward[graded_bg]`,

  `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y,120),130*pow((120-Y)/120,2),if(lt(Y,150),0,if(gt(Y,360),255,255*pow((Y-150)/(360-150),1.4))))'[scrim]`,

  `[graded_bg][scrim]overlay=0:0[bg_scrim]`,
  `[2:v]scale=1280:720[embers]`,
  `[bg_scrim][embers]overlay=0:0[bg_particles]`,

  `[bg_particles]${baseTextDrawtexts.join(",")}[bg_with_base]`,

  `[1:v]scale=1280:720,eq=contrast=1.2:saturation=1.5:brightness=0.14,colorbalance=rs=0.22:gs=0.05:bs=-0.20:rm=0.25:gm=0.07:bm=-0.25:rh=0.28:gh=0.10:bh=-0.20[foil_amber]`,
  `[1:v]scale=1280:720,eq=contrast=1.18:saturation=1.35:brightness=0.18,colorbalance=rs=0.10:gs=0.10:bs=-0.14:rm=0.14:gm=0.14:bm=-0.18:rh=0.18:gh=0.18:bh=-0.14[foil_gold]`,

  `color=c=black:s=1280x720,${amberMaskDrawtexts.join(",")}[mask_amber]`,
  `color=c=black:s=1280x720,${goldMaskDrawtexts.join(",")}[mask_gold]`,

  `[foil_amber][mask_amber]alphamerge[textured_amber]`,
  `[foil_gold][mask_gold]alphamerge[textured_gold]`,

  `[bg_with_base][textured_amber]overlay=0:0[layer1]`,
  `[layer1][textured_gold]overlay=0:0[layer2]`,

  `[layer2]${wmDrawtext}[out]`
].join(";");

const args = [
  "-y",
  "-i", bgImg,
  "-i", foilImg,
  "-i", embersImg,
  "-filter_complex", filterGraph,
  "-map", "[out]",
  "-frames:v", "1",
  "-q:v", "2",
  outImg
];

const child = spawn("ffmpeg", args, { windowsHide: true });
let stderr = "";
child.stderr.on("data", chunk => { stderr += chunk; });
child.on("close", code => {
  if (code !== 0) {
    console.error("FFmpeg failed with code", code);
    console.error(stderr.slice(-1000));
  } else {
    console.log("SUCCESS! Created", outImg);
  }
});
