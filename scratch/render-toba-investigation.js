import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import PImage from "pureimage";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Register fonts
const fontBebas = PImage.registerFont(path.join(rootDir, "assets", "fonts", "BebasNeue-Regular.ttf"), "BebasNeue");
fontBebas.loadSync();

const fontMont = PImage.registerFont(path.join(rootDir, "assets", "fonts", "Montserrat-Black.ttf"), "Montserrat");
fontMont.loadSync();

// -----------------------------------------------------------------------------
// HELPER DRAWING FUNCTIONS ON CANVAS
// -----------------------------------------------------------------------------

function drawWarningTriangle(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);

  // Red glow
  ctx.fillStyle = "rgba(255, 30, 30, 0.4)";
  ctx.beginPath();
  ctx.moveTo(0, -size - 6);
  ctx.lineTo(size * 0.92 + 6, size * 0.65 + 6);
  ctx.lineTo(-size * 0.92 - 6, size * 0.65 + 6);
  ctx.closePath();
  ctx.fill();

  // Red border
  ctx.fillStyle = "#E00000";
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.92, size * 0.65);
  ctx.lineTo(-size * 0.92, size * 0.65);
  ctx.closePath();
  ctx.fill();

  // Inner black body
  ctx.fillStyle = "#141414";
  const inner = size * 0.72;
  ctx.beginPath();
  ctx.moveTo(0, -inner + 4);
  ctx.lineTo(inner * 0.9, inner * 0.65);
  ctx.lineTo(-inner * 0.9, inner * 0.65);
  ctx.closePath();
  ctx.fill();

  // Exclamation mark '!'
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(-size * 0.08, -size * 0.35, size * 0.16, size * 0.42);
  ctx.fillRect(-size * 0.08, size * 0.22, size * 0.16, size * 0.16);

  ctx.restore();
}

function drawPinnedNote(ctx, x, y, w, h) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((4.2 * Math.PI) / 180);

  // Drop shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(8, 10, w, h);

  // Paper background (vintage manila note)
  ctx.fillStyle = "#E7D7B5";
  ctx.fillRect(0, 0, w, h);

  // Distressed paper border
  ctx.strokeStyle = "#BFA97D";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Subtle red notebook lines
  ctx.strokeStyle = "rgba(200, 60, 60, 0.25)";
  ctx.lineWidth = 1;
  for (let ly = 32; ly < h - 10; ly += 24) {
    ctx.beginPath();
    ctx.moveTo(8, ly);
    ctx.lineTo(w - 8, ly);
    ctx.stroke();
  }

  // Text inside note
  ctx.fillStyle = "#1A150E";
  ctx.font = "14.5pt Montserrat";
  ctx.fillText("FAKTA YANG", 16, 38);
  ctx.fillText("TERLUPAKAN", 16, 64);
  ctx.fillStyle = "#A80000";
  ctx.fillText("SELAMA", 16, 90);
  ctx.fillText("PULUHAN TAHUN!", 12, 116);

  // Metallic Paperclip
  ctx.strokeStyle = "#666666";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 12, -14);
  ctx.lineTo(w / 2 - 12, 28);
  ctx.lineTo(w / 2 + 6, 28);
  ctx.lineTo(w / 2 + 6, -8);
  ctx.stroke();

  ctx.strokeStyle = "#CCCCCC";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 12, -14);
  ctx.lineTo(w / 2 - 12, 28);
  ctx.stroke();

  ctx.restore();
}

function drawPolaroidPhoto(ctx, x, y, w, h, eruptionImg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-5.5 * Math.PI) / 180);

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(10, 12, w, h);

  // White polaroid frame
  ctx.fillStyle = "#F8F6F0";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#D0CCC0";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h);

  // Inner photo area
  const pad = 12;
  const pw = w - pad * 2;
  const ph = h - 52;

  if (eruptionImg) {
    ctx.drawImage(eruptionImg, 0, 0, eruptionImg.width, eruptionImg.height, pad, pad, pw, ph);
  } else {
    ctx.fillStyle = "#2D2218";
    ctx.fillRect(pad, pad, pw, ph);
  }

  // Red Stamp: "BUKTI LAMA"
  ctx.save();
  ctx.translate(w * 0.5, h - 26);
  ctx.rotate((-7 * Math.PI) / 180);

  ctx.strokeStyle = "rgba(215, 0, 0, 0.9)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-58, -15, 116, 30);

  ctx.fillStyle = "#D60000";
  ctx.font = "14pt Montserrat";
  ctx.fillText("BUKTI LAMA", -50, 7);
  ctx.restore();

  ctx.restore();
}

function drawGeologyNote(ctx, x, y, w, h) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((7 * Math.PI) / 180);

  // Shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(6, 8, w, h);

  // Aged document paper
  ctx.fillStyle = "#E4D1B0";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#B89F75";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h);

  // Header stamp
  ctx.fillStyle = "#3D2B1F";
  ctx.font = "13pt Montserrat";
  ctx.fillText("CATATAN", 18, 32);
  ctx.fillText("GEOLOGI", 18, 52);
  ctx.fillStyle = "#A80000";
  ctx.font = "16pt Montserrat";
  ctx.fillText("1920", 30, 80);

  ctx.restore();
}

function drawMagnifyingGlass(ctx, cx, cy, radius) {
  ctx.save();
  ctx.translate(cx, cy);

  // Handle
  ctx.save();
  ctx.rotate((38 * Math.PI) / 180);
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(-14, radius + 4, 28, 110);

  ctx.fillStyle = "#5A381E"; // Dark wood
  ctx.fillRect(-10, radius, 20, 105);

  ctx.fillStyle = "#D4AF37"; // Brass ring ferrule
  ctx.fillRect(-13, radius, 26, 16);
  ctx.restore();

  // Lens drop shadow
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.beginPath();
  ctx.arc(8, 10, radius, 0, Math.PI * 2);
  ctx.fill();

  // Lens paper background (pale seismograph paper)
  ctx.fillStyle = "#F6F4EB";
  ctx.beginPath();
  ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
  ctx.fill();

  // Grid lines on seismograph paper
  ctx.strokeStyle = "rgba(180, 160, 140, 0.4)";
  ctx.lineWidth = 1;
  for (let gx = -radius + 15; gx < radius - 15; gx += 16) {
    ctx.beginPath();
    ctx.moveTo(gx, -radius + 15);
    ctx.lineTo(gx, radius - 15);
    ctx.stroke();
  }
  for (let gy = -radius + 15; gy < radius - 15; gy += 16) {
    ctx.beginPath();
    ctx.moveTo(-radius + 15, gy);
    ctx.lineTo(radius - 15, gy);
    ctx.stroke();
  }

  // Intense seismograph spikes (earthquake/volcano tremor)
  ctx.strokeStyle = "#B30000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  const pts = [
    [-radius + 14, 2],
    [-radius * 0.55, 2],
    [-radius * 0.4, -28],
    [-radius * 0.28, 38],
    [-radius * 0.12, -62],
    [radius * 0.05, 52],
    [radius * 0.18, -32],
    [radius * 0.32, 22],
    [radius * 0.48, -12],
    [radius * 0.6, 2],
    [radius - 14, 2]
  ];
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();

  // Pointer & text inside lens
  ctx.fillStyle = "#A80000";
  ctx.font = "8.5pt Montserrat";
  ctx.fillText("74.000 TAHUN", -radius * 0.38, radius * 0.46);
  ctx.fillText("LALU", -radius * 0.12, radius * 0.62);

  // Brass metallic rim (double ring)
  ctx.strokeStyle = "#E8C860";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#826316";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 4.5, 0, Math.PI * 2);
  ctx.stroke();

  // Specular glass glare reflection
  ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
  ctx.beginPath();
  ctx.arc(0, 0, radius - 8, -Math.PI * 0.72, -Math.PI * 0.12);
  ctx.lineTo(radius * 0.35, -radius * 0.35);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCalloutTarget(ctx, cx, cy, r) {
  // Red target circle
  ctx.strokeStyle = "rgba(255, 20, 20, 0.45)";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#FF0000";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Curved red arrow pointing to circle
  ctx.strokeStyle = "#FF1E1E";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy + 90);
  ctx.quadraticCurveTo(cx - 65, cy + 45, cx - 25, cy + 18);
  ctx.stroke();

  // Arrow head
  ctx.fillStyle = "#FF1E1E";
  ctx.beginPath();
  ctx.moveTo(cx - 25, cy + 18);
  ctx.lineTo(cx - 40, cy + 28);
  ctx.lineTo(cx - 20, cy + 34);
  ctx.closePath();
  ctx.fill();

  // Yellow Hazard Pill Badge
  const bx = cx - 120;
  const by = cy + 95;
  const bw = 245;
  const bh = 36;

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(bx + 4, by + 4, bw, bh);

  ctx.fillStyle = "#FFC800";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = "#000000";
  ctx.font = "11pt Montserrat";
  ctx.fillText("AKTIVITAS VULKANIK", bx + 16, by + 18);
  ctx.fillStyle = "#CC0000";
  ctx.fillText("MASIH TERJADI!", bx + 16, by + 32);
}

function drawHudStrip(ctx, x, y, w, h) {
  // Semi-transparent dark pill strip
  ctx.fillStyle = "rgba(5, 8, 14, 0.90)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255, 200, 0, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  const colW = w / 4;

  const items = [
    { title: "LETUSAN SUPER", val: "74.000 TAHUN LALU", icon: "volcano" },
    { title: "GAS VULKANIK", val: "MASIH TERDETEKSI", icon: "fumes" },
    { title: "AKTIVITAS SEISMIK", val: "MASIH TERJADI", icon: "pulse" },
    { title: "BUKTI GEOLOGI", val: "TERLUPAKAN?", icon: "lens" }
  ];

  items.forEach((it, idx) => {
    const colX = x + idx * colW;

    // Divider line
    if (idx > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, y + 8);
      ctx.lineTo(colX, y + h - 8);
      ctx.stroke();
    }

    // Circular Icon Badge
    const icx = colX + 32;
    const icy = y + h / 2;
    const ir = 20;

    ctx.strokeStyle = "#FFC400";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(icx, icy, ir, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 200, 0, 0.15)";
    ctx.beginPath();
    ctx.arc(icx, icy, ir - 2, 0, Math.PI * 2);
    ctx.fill();

    // Icon symbols
    ctx.strokeStyle = "#FFFFFF";
    ctx.fillStyle = "#FFC400";
    ctx.lineWidth = 1.8;

    if (it.icon === "volcano") {
      ctx.beginPath();
      ctx.moveTo(icx - 8, icy + 8);
      ctx.lineTo(icx - 3, icy - 2);
      ctx.lineTo(icx + 3, icy - 2);
      ctx.lineTo(icx + 8, icy + 8);
      ctx.stroke();
      ctx.fillRect(icx - 2, icy - 8, 4, 3);
    } else if (it.icon === "fumes") {
      for (let s = -5; s <= 5; s += 5) {
        ctx.beginPath();
        ctx.moveTo(icx + s, icy + 8);
        ctx.quadraticCurveTo(icx + s - 3, icy, icx + s + 1, icy - 8);
        ctx.stroke();
      }
    } else if (it.icon === "pulse") {
      ctx.beginPath();
      ctx.moveTo(icx - 10, icy);
      ctx.lineTo(icx - 4, icy);
      ctx.lineTo(icx - 2, icy - 8);
      ctx.lineTo(icx + 2, icy + 8);
      ctx.lineTo(icx + 5, icy);
      ctx.lineTo(icx + 10, icy);
      ctx.stroke();
    } else if (it.icon === "lens") {
      ctx.beginPath();
      ctx.arc(icx - 2, icy - 2, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(icx + 2, icy + 2);
      ctx.lineTo(icx + 8, icy + 8);
      ctx.stroke();
    }

    // Text label 2 lines
    const tx = colX + 58;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "8pt Montserrat";
    ctx.fillText(it.title, tx, icy - 4);

    ctx.fillStyle = "#FFC400";
    ctx.font = "7.5pt Montserrat";
    ctx.fillText(it.val, tx, icy + 12);
  });
}

function drawSlantedHeadline(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-3.2 * Math.PI) / 180);

  // Line 1: TOBA
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "96pt BebasNeue";
  ctx.fillText("TOBA", 6, 96);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "96pt BebasNeue";
  ctx.fillText("TOBA", 0, 90);

  // Warning triangle next to TOBA
  drawWarningTriangle(ctx, 255, 48, 42);

  // Line 2: MASIH AKTIF?
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "80pt BebasNeue";
  ctx.fillText("MASIH AKTIF?", 6, 186);

  ctx.fillStyle = "#FFC800";
  ctx.font = "80pt BebasNeue";
  ctx.fillText("MASIH AKTIF?", 0, 180);

  // Red Laser Underline Slash Bar
  ctx.fillStyle = "rgba(255, 20, 20, 0.4)";
  ctx.fillRect(-10, 200, 440, 16);
  ctx.fillStyle = "#E60000";
  ctx.fillRect(-6, 202, 430, 9);

  // Line 3: BUKTI INI
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "64pt BebasNeue";
  ctx.fillText("BUKTI INI", 6, 276);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "64pt BebasNeue";
  ctx.fillText("BUKTI INI", 0, 270);

  // Line 4: LAMA DIABAIKAN
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "66pt BebasNeue";
  ctx.fillText("LAMA DIABAIKAN", 6, 354);

  ctx.fillStyle = "#FFC800";
  ctx.font = "66pt BebasNeue";
  ctx.fillText("LAMA DIABAIKAN", 0, 348);

  ctx.restore();
}

// -----------------------------------------------------------------------------
// MAIN GENERATOR
// -----------------------------------------------------------------------------
async function main() {
  console.log("Loading archive lithograph for Polaroid...");
  const eruptionStream = fs.createReadStream(path.join(rootDir, "scratch", "archive-eruption.jpg"));
  const eruptionImg = await PImage.decodeJPEGFromStream(eruptionStream);

  console.log("Drawing Investigation Overlay Canvas (1280x720 PNG)...");
  const img = PImage.make(1280, 720);
  const ctx = img.getContext("2d");
  ctx.clearRect(0, 0, 1280, 720);

  // 1. Pinned Note in Top Right
  drawPinnedNote(ctx, 1020, 25, 205, 132);

  // 2. Handwritten "DANAU TOBA" floating over the water
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = "24pt BebasNeue";
  ctx.fillText("DANAU TOBA", 760, 240);

  // 3. Callout Target & Warning Pill
  drawCalloutTarget(ctx, 1140, 310, 46);

  // 4. Geology Note / Map
  drawGeologyNote(ctx, 1120, 480, 120, 110);

  // 5. Polaroid Photo Stack in Bottom Right
  drawPolaroidPhoto(ctx, 770, 520, 180, 195, eruptionImg);

  // 6. Magnifying Glass over Seismograph
  drawMagnifyingGlass(ctx, 1070, 600, 70);

  // 7. Bottom HUD Strip (4 circular metrics)
  drawHudStrip(ctx, 30, 615, 620, 82);

  // 8. Slanted Headline on Left
  drawSlantedHeadline(ctx, 45, 80);

  const overlayPng = path.join(rootDir, "scratch", "investigation-overlay.png");
  await PImage.encodePNGToStream(img, fs.createWriteStream(overlayPng));
  console.log("[OK] Saved Overlay PNG:", overlayPng);

  // ---------------------------------------------------------------------------
  // COMPOSITE WITH FFMPEG
  // ---------------------------------------------------------------------------
  const tobaImg = path.join(rootDir, "scratch", "toba-aerial.jpg");
  const moltenLavaImg = path.join(rootDir, "scratch", "molten-lava.jpg");
  const embersImg = path.join(rootDir, "assets", "textures", "embers.png");
  const finalJpg = path.join("C:\\Users\\Lenovo\\Desktop\\Hasil-Thumbnail-Baru", "Kompilasi-Investigasi-Danau-Toba.jpg");

  console.log("Compositing multi-layer collage with FFmpeg...");

  // Filtergraph:
  // 0:v = Lake Toba aerial (graded with stormy sky, deep blue lake, rich contrast)
  // 1:v = Molten lava flow
  // 2:v = Embers
  // 3:v = Overlay PNG
  const graph = [
    // [0:v] Color grade aerial landscape
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.25/0.14 0.7/0.58 1/0.88',` +
    `eq=contrast=1.35:saturation=1.15:brightness=-0.04,` +
    `colorbalance=rs=0.06:gs=0.02:bs=-0.04:rm=0.08:gm=0.03:bm=-0.05,` +
    `vignette=angle=PI/2.8:mode=backward[graded_bg]`,

    // [1:v] Prepare fiery underground magma layer
    `[1:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `eq=contrast=1.35:saturation=1.3:brightness=0.04,` +
    `colorbalance=rs=0.25:gs=0.05:bs=-0.25[molten_magma]`,

    // Cutaway mask for underground magma (visible in middle-right bottom)
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(gt(X\\,420)*gt(Y\\,390)\\,210*pow((Y-390)/330\\,1.2)*(X-420)/860\\,0)'[magma_mask]`,
    `[molten_magma][magma_mask]alphamerge[cutaway_magma]`,
    `[graded_bg][cutaway_magma]overlay=0:0[bg_with_magma]`,

    // Embers particles
    `[2:v]scale=1280:720[embers]`,
    `[bg_with_magma][embers]overlay=0:0[bg_particles]`,

    // Left side soft dark scrim for headline readability
    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(X\\,560)\\,155*pow((560-X)/560\\,1.5)\\,0)'[left_scrim]`,
    `[bg_particles][left_scrim]overlay=0:0[bg_scrimmed]`,

    // Overlay the Forensic Graphic Layout PNG
    `[3:v]scale=1280:720[overlay_png]`,
    `[bg_scrimmed][overlay_png]overlay=0:0[out]`
  ].join(";");

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", tobaImg,
      "-i", moltenLavaImg,
      "-i", embersImg,
      "-i", overlayPng,
      "-filter_complex", graph,
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      finalJpg
    ], { windowsHide: true });

    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600) || `FFmpeg code ${code}`));
    });
  });

  console.log("[SUCCESS] Rendered Investigation Collage to:", finalJpg);
}

main().catch(console.error);
