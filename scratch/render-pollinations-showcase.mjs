import path from "node:path";
import { spawn } from "node:child_process";
import { paths } from "../src/config.js";
import { escapeDrawtext } from "../src/thumbnail.js";

const fontPath = path.join(paths.fontDir, "Montserrat-Black.ttf");
const escFont = escapeDrawtext(fontPath);
const embersPath = path.join(paths.rootDir, "assets", "textures", "embers.png");
const foilPath = path.join(paths.rootDir, "assets", "textures", "molten-gold-radiant.jpg");

const bgPyramid = "C:/Users/Lenovo/Desktop/Hasil-Thumbnail-Baru/Pollinations-Pyramid-Flux.jpg";
const outputPyramid = "C:/Users/Lenovo/Desktop/Hasil-Thumbnail-Baru/Thumbnail-Pollinations-Kota-Kuno.jpg";

const bgToba = "C:/Users/Lenovo/Desktop/Hasil-Thumbnail-Baru/Pollinations-Realism-Toba.jpg";
const outputToba = "C:/Users/Lenovo/Desktop/Hasil-Thumbnail-Baru/Thumbnail-Pollinations-Danau-Toba.jpg";

async function renderThumbnail({ inputBg, outputPath, titleLines, tag, align = "left" }) {
  const startX = align === "left" ? 60 : "(w-text_w)/2";
  const startY = 380;
  
  const baseDrawtexts = [];
  const maskDrawtexts = [];
  
  let curY = startY;
  if (tag) {
    baseDrawtexts.push(
      `drawtext=fontfile='${escFont}':text='${escapeDrawtext(tag)}':fontsize=16:fontcolor=0xFFCC00:box=1:boxcolor=black@0.65:boxborderw=8:shadowcolor=black@0.9:shadowx=2:shadowy=2:x=${startX}:y=${curY}`
    );
    curY += 42;
  }

  for (const line of titleLines) {
    const escText = escapeDrawtext(line.text.toUpperCase());
    const colorHex = line.color === "gold" ? "0xFFB300" : "0xFFFFFF";
    
    baseDrawtexts.push(
      `drawtext=fontfile='${escFont}':text='${escText}':fontsize=${line.size}:fontcolor=${colorHex}:borderw=4:bordercolor=black@0.9:shadowcolor=black@0.95:shadowx=5:shadowy=7:x=${startX}:y=${curY}`
    );
    
    if (line.color === "gold") {
      maskDrawtexts.push(
        `drawtext=fontfile='${escFont}':text='${escText}':fontsize=${line.size}:fontcolor=white:x=${startX}:y=${curY}`
      );
    }
    curY += Math.round(line.size * 1.05);
  }

  const filterParts = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.28/0.16 0.72/0.58 1/0.88',` +
    `eq=contrast=1.30:saturation=1.18:brightness=-0.04,` +
    `vignette=angle=PI/2.8:mode=backward[graded_bg]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(Y\\,320)\\,0\\,155*pow((Y-320)/400\\,1.5))'[scrim]`,
    `[graded_bg][scrim]overlay=0:0[bg_scrim]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=255:g=130:b=20:a='100*exp(-((X-320)*(X-320)/(2*240*240) + (Y-520)*(Y-520)/(2*80*80)))'[halo]`,
    `[bg_scrim][halo]overlay=0:0[bg_halo]`,

    `[1:v]scale=1280:720[embers]`,
    `[bg_halo][embers]overlay=0:0[bg_particles]`,

    `[bg_particles]${baseDrawtexts.join(",")}[bg_text]`
  ];

  let lastLayer = "bg_text";

  if (maskDrawtexts.length > 0) {
    filterParts.push(
      `[2:v]scale=1280:720,eq=contrast=1.2:saturation=1.3:brightness=0.08[gold_tex]`,
      `color=c=black:s=1280x720,${maskDrawtexts.join(",")}[gold_mask]`,
      `[gold_tex][gold_mask]alphamerge[gold_text_layer]`,
      `[${lastLayer}][gold_text_layer]overlay=0:0[out_comp]`
    );
    lastLayer = "out_comp";
  } else {
    filterParts.push(`[${lastLayer}]copy[out_comp]`);
    lastLayer = "out_comp";
  }

  const inputs = ["-y", "-i", inputBg, "-i", embersPath];
  if (maskDrawtexts.length > 0) inputs.push("-i", foilPath);
  
  inputs.push(
    "-filter_complex", filterParts.join(";"),
    "-map", `[${lastLayer}]`,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  );

  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", inputs, { windowsHide: true });
    let err = "";
    child.stderr.on("data", c => { err += c; });
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `code ${code}`));
    });
  });
}

async function run() {
  console.log("Rendering 1: Kota Kuno with Pollinations...");
  await renderThumbnail({
    inputBg: bgPyramid,
    outputPath: outputPyramid,
    tag: "[ ARSIP INVESTIGASI MISTERI ]",
    titleLines: [
      { text: "MISTERI KOTA KUNO", size: 66, color: "white" },
      { text: "YANG HILANG TANPA JEJAK!", size: 54, color: "gold" }
    ],
    align: "left"
  });
  console.log("Saved:", outputPyramid);

  console.log("Rendering 2: Danau Toba with Pollinations...");
  await renderThumbnail({
    inputBg: bgToba,
    outputPath: outputToba,
    tag: "[ INVESTIGASI GEOLOGI EKSTREM ]",
    titleLines: [
      { text: "DANAU TOBA MASIH AKTIF?", size: 62, color: "white" },
      { text: "BUKTI LAMA DIABAIKAN!", size: 58, color: "gold" }
    ],
    align: "left"
  });
  console.log("Saved:", outputToba);
}

run().catch(console.error);
