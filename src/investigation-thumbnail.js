import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import PImage from "pureimage";
import { config, paths } from "./config.js";
import { generatePollinationsImage } from "./pollinations.js";

// Load fonts for vector canvas overlay
const fontBebasPath = path.join(paths.fontDir, "BebasNeue-Regular.ttf");
const fontMontPath = path.join(paths.fontDir, "Montserrat-Black.ttf");

let fontsLoaded = false;
function ensureFonts() {
  if (fontsLoaded) return;
  if (fs.existsSync(fontBebasPath)) {
    const fb = PImage.registerFont(fontBebasPath, "BebasNeue");
    fb.loadSync();
  }
  if (fs.existsSync(fontMontPath)) {
    const fm = PImage.registerFont(fontMontPath, "Montserrat");
    fm.loadSync();
  }
  fontsLoaded = true;
}

function drawWarningTriangle(ctx, cx, cy, size) {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = "rgba(255, 30, 30, 0.4)";
  ctx.beginPath();
  ctx.moveTo(0, -size - 6);
  ctx.lineTo(size * 0.92 + 6, size * 0.65 + 6);
  ctx.lineTo(-size * 0.92 - 6, size * 0.65 + 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#E00000";
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.92, size * 0.65);
  ctx.lineTo(-size * 0.92, size * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#141414";
  const inner = size * 0.72;
  ctx.beginPath();
  ctx.moveTo(0, -inner + 4);
  ctx.lineTo(inner * 0.9, inner * 0.65);
  ctx.lineTo(-inner * 0.9, inner * 0.65);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(-size * 0.08, -size * 0.35, size * 0.16, size * 0.42);
  ctx.fillRect(-size * 0.08, size * 0.22, size * 0.16, size * 0.16);

  ctx.restore();
}

function drawPinnedNote(ctx, x, y, w, h, lines = ["FAKTA YANG", "TERLUPAKAN", "SELAMA", "PULUHAN TAHUN!"]) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((4.2 * Math.PI) / 180);

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(8, 10, w, h);

  ctx.fillStyle = "#E7D7B5";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#BFA97D";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  ctx.strokeStyle = "rgba(200, 60, 60, 0.25)";
  ctx.lineWidth = 1;
  for (let ly = 32; ly < h - 10; ly += 24) {
    ctx.beginPath();
    ctx.moveTo(8, ly);
    ctx.lineTo(w - 8, ly);
    ctx.stroke();
  }

  ctx.fillStyle = "#1A150E";
  ctx.font = "14pt Montserrat";
  if (lines[0]) ctx.fillText(lines[0], 16, 38);
  if (lines[1]) ctx.fillText(lines[1], 16, 64);
  ctx.fillStyle = "#A80000";
  if (lines[2]) ctx.fillText(lines[2], 16, 90);
  if (lines[3]) ctx.fillText(lines[3], 12, 116);

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

function drawPolaroidPhoto(ctx, x, y, w, h, stampText = "BUKTI LAMA") {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-5.5 * Math.PI) / 180);

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(10, 12, w, h);

  ctx.fillStyle = "#F8F6F0";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#D0CCC0";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h);

  const pad = 12;
  const pw = w - pad * 2;
  const ph = h - 52;
  ctx.fillStyle = "#2D2218";
  ctx.fillRect(pad, pad, pw, ph);

  // Mountain & smoke silhouette
  ctx.fillStyle = "#5A442E";
  ctx.beginPath();
  ctx.moveTo(pad, pad + ph);
  ctx.lineTo(pad + pw * 0.4, pad + ph * 0.4);
  ctx.lineTo(pad + pw * 0.7, pad + ph * 0.6);
  ctx.lineTo(pad + pw, pad + ph);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(220, 190, 150, 0.65)";
  ctx.beginPath();
  ctx.arc(pad + pw * 0.4, pad + ph * 0.28, 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(w * 0.5, h - 26);
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.strokeStyle = "rgba(215, 0, 0, 0.9)";
  ctx.lineWidth = 3;
  ctx.strokeRect(-58, -15, 116, 30);
  ctx.fillStyle = "#D60000";
  ctx.font = "14pt Montserrat";
  ctx.fillText(stampText, -50, 7);
  ctx.restore();

  ctx.restore();
}

function drawMagnifyingGlass(ctx, cx, cy, radius, labelText = "74.000 Thn Lalu") {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.save();
  ctx.rotate((38 * Math.PI) / 180);
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(-14, radius + 4, 28, 110);
  ctx.fillStyle = "#5A381E";
  ctx.fillRect(-10, radius, 20, 105);
  ctx.fillStyle = "#D4AF37";
  ctx.fillRect(-13, radius, 26, 16);
  ctx.restore();

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.beginPath();
  ctx.arc(8, 10, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#F6F4EB";
  ctx.beginPath();
  ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
  ctx.fill();

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

  // Waveform graph
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

  ctx.fillStyle = "#A80000";
  ctx.font = "8.5pt Montserrat";
  ctx.fillText(labelText, -radius * 0.42, radius * 0.46);

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

  ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
  ctx.beginPath();
  ctx.arc(0, 0, radius - 8, -Math.PI * 0.72, -Math.PI * 0.12);
  ctx.lineTo(radius * 0.35, -radius * 0.35);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCalloutTarget(ctx, cx, cy, r, badgeText = "AKTIVITAS VULKANIK MASIH TERJADI!") {
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

  ctx.strokeStyle = "#FF1E1E";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy + 90);
  ctx.quadraticCurveTo(cx - 65, cy + 45, cx - 25, cy + 18);
  ctx.stroke();

  ctx.fillStyle = "#FF1E1E";
  ctx.beginPath();
  ctx.moveTo(cx - 25, cy + 18);
  ctx.lineTo(cx - 40, cy + 28);
  ctx.lineTo(cx - 20, cy + 34);
  ctx.closePath();
  ctx.fill();

  const bx = cx - 120;
  const by = cy + 95;
  const bw = 250;
  const bh = 36;

  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(bx + 4, by + 4, bw, bh);

  ctx.fillStyle = "#FFC800";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = "#000000";
  ctx.font = "10.5pt Montserrat";
  ctx.fillText(badgeText, bx + 14, by + 23);
}

function drawHudStrip(ctx, x, y, w, h, items) {
  ctx.fillStyle = "rgba(5, 8, 14, 0.90)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255, 200, 0, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  const colW = w / items.length;

  items.forEach((it, idx) => {
    const colX = x + idx * colW;

    if (idx > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, y + 8);
      ctx.lineTo(colX, y + h - 8);
      ctx.stroke();
    }

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

    ctx.strokeStyle = "#FFFFFF";
    ctx.fillStyle = "#FFC400";
    ctx.lineWidth = 1.8;

    ctx.beginPath();
    ctx.moveTo(icx - 8, icy + 8);
    ctx.lineTo(icx - 3, icy - 2);
    ctx.lineTo(icx + 3, icy - 2);
    ctx.lineTo(icx + 8, icy + 8);
    ctx.stroke();
    ctx.fillRect(icx - 2, icy - 8, 4, 3);

    const tx = colX + 58;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "8pt Montserrat";
    ctx.fillText(it.title, tx, icy - 4);

    ctx.fillStyle = "#FFC400";
    ctx.font = "7.5pt Montserrat";
    ctx.fillText(it.val, tx, icy + 12);
  });
}

function drawSlantedHeadline(ctx, x, y, line1, line2, line3, line4) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((-3.2 * Math.PI) / 180);

  // Line 1
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "96pt BebasNeue";
  ctx.fillText(line1, 6, 96);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(line1, 0, 90);

  drawWarningTriangle(ctx, line1.length * 52 + 50, 48, 42);

  // Line 2
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "80pt BebasNeue";
  ctx.fillText(line2, 6, 186);
  ctx.fillStyle = "#FFC800";
  ctx.fillText(line2, 0, 180);

  // Red Laser Underline Slash Bar
  ctx.fillStyle = "rgba(255, 20, 20, 0.4)";
  ctx.fillRect(-10, 200, 440, 16);
  ctx.fillStyle = "#E60000";
  ctx.fillRect(-6, 202, 430, 9);

  // Line 3
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "64pt BebasNeue";
  ctx.fillText(line3, 6, 276);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(line3, 0, 270);

  // Line 4
  ctx.fillStyle = "rgba(0, 0, 0, 0.95)";
  ctx.font = "66pt BebasNeue";
  ctx.fillText(line4, 6, 354);
  ctx.fillStyle = "#FFC800";
  ctx.fillText(line4, 0, 348);

  ctx.restore();
}

/**
 * Generate a complete Investigation Documentary Collage Thumbnail
 * using Pollinations.ai (authenticated with user's key) + FFmpeg compositing.
 */
export async function generateInvestigationThumbnail({
  title = "Danau Toba Masih Aktif? Bukti Ini Lama Diabaikan",
  topic = "Danau Toba",
  outputPath
}) {
  ensureFonts();

  // 1. Generate visual background via Pollinations AI
  const prompt = `hyper-detailed cinematic aerial landscape 16:9 widescreen, ${topic}, volcanic caldera crater lake, subterranean glowing magma chamber cutaway, dramatic sunset storm clouds, 8k raytraced render`;

  console.log(`[Investigation Thumbnail] Generating AI background via Pollinations...`);
  const pollinationsRes = await generatePollinationsImage({
    prompt,
    width: 1280,
    height: 720,
    model: config.pollinations?.model || "flux"
  });

  console.log(`[Investigation Thumbnail] Background generated in ${(pollinationsRes.durationMs / 1000).toFixed(1)}s: ${pollinationsRes.path}`);

  // 2. Build Evidence Overlay Canvas
  const overlayCanvas = PImage.make(1280, 720);
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, 1280, 720);

  drawPinnedNote(ctx, 1020, 25, 205, 132, ["FAKTA YANG", "TERLUPAKAN", "SELAMA", "PULUHAN TAHUN!"]);
  drawCalloutTarget(ctx, 1140, 310, 46, "AKTIVITAS VULKANIK MASIH TERJADI!");
  drawPolaroidPhoto(ctx, 770, 520, 180, 195, "BUKTI LAMA");
  drawMagnifyingGlass(ctx, 1070, 600, 70, "74.000 Thn Lalu");

  const hudItems = [
    { title: "LETUSAN SUPER", val: "74.000 TAHUN LALU" },
    { title: "GAS VULKANIK", val: "MASIH TERDETEKSI" },
    { title: "AKTIVITAS SEISMIK", val: "MASIH TERJADI" },
    { title: "BUKTI GEOLOGI", val: "TERLUPAKAN?" }
  ];
  drawHudStrip(ctx, 30, 615, 620, 82, hudItems);

  drawSlantedHeadline(ctx, 45, 80, "TOBA", "MASIH AKTIF?", "BUKTI INI", "LAMA DIABAIKAN");

  const overlayPath = path.join(paths.scratchDir || path.join(paths.rootDir, "scratch"), `overlay-${Date.now()}.png`);
  await PImage.encodePNGToStream(overlayCanvas, fs.createWriteStream(overlayPath));

  // 3. Composite with FFmpeg
  const embersPath = path.join(paths.rootDir, "assets", "textures", "embers.png");
  const targetOutput = outputPath || path.join(paths.thumbnailDir, `investigation-${Date.now()}.jpg`);

  const graph = [
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
    `curves=all='0/0 0.25/0.14 0.7/0.58 1/0.88',` +
    `eq=contrast=1.35:saturation=1.15:brightness=-0.04,` +
    `vignette=angle=PI/2.8:mode=backward[graded_bg]`,

    `[1:v]scale=1280:720[embers]`,
    `[graded_bg][embers]overlay=0:0[bg_particles]`,

    `color=c=black:s=1280x720,format=rgba,geq=r=0:g=0:b=0:a='if(lt(X\\,560)\\,155*pow((560-X)/560\\,1.5)\\,0)'[left_scrim]`,
    `[bg_particles][left_scrim]overlay=0:0[bg_scrimmed]`,

    `[2:v]scale=1280:720[overlay_png]`,
    `[bg_scrimmed][overlay_png]overlay=0:0[out]`
  ].join(";");

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", pollinationsRes.path,
      "-i", embersPath,
      "-i", overlayPath,
      "-filter_complex", graph,
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "2",
      targetOutput
    ], { windowsHide: true });

    const MAX_BUFFER = 64 * 1024;
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr = (stderr + c.toString()).slice(-MAX_BUFFER);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-600).trim() || `FFmpeg code ${code}`));
    });
  });

  return {
    path: targetOutput,
    backgroundPath: pollinationsRes.path
  };
}
