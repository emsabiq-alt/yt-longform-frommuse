/**
 * flow-image.js — generator gambar via Google Flow (tab Chrome yang sudah login).
 *
 * Port Node.js dari GoogleFlowRunner (repo cinematic): terhubung ke Chrome lewat
 * DevTools Protocol (CDP), mengetik prompt ke editor Flow, mengklik "Start
 * generation", lalu mengunduh gambar baru yang muncul.
 *
 * Kontrak return SAMA dengan generateSceneImage() di openai.js:
 *   { sceneIndex, segmentIndex, provider: "flow", path, url, prompt }
 * sehingga bisa dipakai sebagai drop-in pengganti lewat IMAGE_PROVIDER=flow.
 *
 * Syarat: Chrome khusus Flow berjalan dengan --remote-debugging-port=FLOW_CDP_PORT
 * dan satu tab terbuka di flow.google.com/project/... (sudah login).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function flowLog(message) {
  console.log(`[Flow] ${message}`);
}

/** Mutex sederhana: Flow hanya punya satu tab, generate harus berurutan. */
let flowQueue = Promise.resolve();
function enqueueFlow(task) {
  const run = flowQueue.then(task, task);
  flowQueue = run.catch(() => {});
  return run;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(`CDP error: ${JSON.stringify(data.error)}`));
        else resolve(data.result || {});
      }
    });
    this.ws.on("error", () => {});
  }

  send(method, params = {}) {
    this.msgId += 1;
    const id = this.msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout menunggu respons ${method}`));
        }
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async evaluate(script) {
    const res = await this.send("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true
    });
    return res?.result?.value;
  }

  close() {
    try { this.ws?.close(); } catch { /* abaikan */ }
    this.ws = null;
  }
}

async function findFlowTab(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(8000) })
    .catch(() => { throw new Error(`Chrome CDP tidak merespons di 127.0.0.1:${port}. Jalankan Chrome Flow dulu (lihat README).`); });
  if (!response.ok) throw new Error(`CDP /json HTTP ${response.status} di port ${port}.`);
  const tabs = await response.json();
  const tab = tabs.find((t) => String(t.url || "").includes("flow.google.com/project"))
    || tabs.find((t) => String(t.url || "").includes("flow.google.com"));
  if (!tab?.webSocketDebuggerUrl) {
    throw new Error("Tab Google Flow tidak ditemukan. Buka flow.google.com/project/... di Chrome Flow lalu coba lagi.");
  }
  return tab;
}

async function getFlowImageSources(cdp) {
  const sources = await cdp.evaluate(`(() => Array.from(document.images)
    .map(i => i.src)
    .filter(Boolean)
    .filter(s => s.includes('flow.google.com/asb/') || s.includes('flow-content.google/image/'))
  )()`);
  return sources || [];
}

function buildFlowPrompt(imagePrompt, size = "") {
  let orientation = "vertical 9:16";
  if (size) {
    const [w, h] = String(size).split("x").map(Number);
    if (w > h) orientation = "horizontal landscape 16:9";
  }
  return [
    String(imagePrompt || "").trim(),
    `${orientation} cinematic documentary film still, photorealistic, high detail, clear subject, varied composition, no written text inside the image, no logo, no watermark, no celebrity likeness, no gore, no injury`
  ].join(", ");
}

async function optimizeToJpg(inputPath, outputPath, size = "") {
  let scaleCrop = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
  if (size) {
    const [w, h] = String(size).split("x").map(Number);
    if (w > h) scaleCrop = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";
  }
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", scaleCrop,
      "-frames:v", "1",
      "-q:v", "7",
      outputPath
    ], { windowsHide: true, cwd: paths.rootDir });
    const MAX_BUFFER = 64 * 1024;
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-MAX_BUFFER); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Optimasi gambar Flow gagal (${code})`));
    });
  });
}

async function generateFlowImageInner({ itemId, scene, size, quality }) {
  const port = config.flow.cdpPort;
  const timeoutMs = config.flow.timeoutMs;
  const prompt = buildFlowPrompt(scene.imagePrompt, size);

  const tab = await findFlowTab(port);
  const cdp = new CdpClient(tab.webSocketDebuggerUrl);
  await cdp.connect();
  flowLog(`terhubung ke tab Flow: ${(tab.title || "").slice(0, 60)}`);

  try {
    const before = new Set(await getFlowImageSources(cdp));

    // Kosongkan editor lalu fokus.
    await cdp.evaluate(`(() => {
      const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
      if (editor) {
        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        return true;
      }
      return false;
    })()`);
    await sleep(300);

    // Ketik prompt.
    await cdp.send("Input.insertText", { text: prompt });
    await sleep(400);
    await cdp.evaluate(`(() => {
      const editor = document.querySelector('.ProseMirror');
      if (editor) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await sleep(300);

    // Klik tombol Start generation, atau Enter sebagai fallback.
    const coords = await cdp.evaluate(`(() => {
      const btn = document.querySelector('button[aria-label="Start generation"], button[aria-label="Mulai pembuatan"], button[aria-label*="generation" i], button[aria-label*="pembuatan" i]') ||
        Array.from(document.querySelectorAll('button')).find(b => {
          const al = (b.getAttribute('aria-label') || '').toLowerCase();
          return al.includes('generation') || al.includes('pembuatan') || (b.innerText || '').includes('arrow_forward');
        });
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      if (!btn.disabled) { try { btn.click(); } catch (e) {} }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: btn.disabled };
    })()`);

    if (coords && !coords.disabled) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
      flowLog("prompt terkirim, menunggu gambar baru...");
    } else {
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 13, unmodifiedText: "\r", text: "\r" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 13, unmodifiedText: "\r", text: "\r" });
      flowLog("tombol generate tidak ketemu, Enter dikirim, menunggu gambar baru...");
    }

    // Tunggu gambar baru muncul.
    const startedAt = Date.now();
    let newUrl = null;
    while (Date.now() - startedAt < timeoutMs) {
      await sleep(3000);
      const now = await getFlowImageSources(cdp);
      const diff = now.filter((u) => !before.has(u));
      if (diff.length > 0) { newUrl = diff[0]; break; }
    }
    if (!newUrl) throw new Error(`Flow tidak menyelesaikan gambar dalam ${Math.round(timeoutMs / 1000)}s.`);

    // Unduh gambar.
    await fs.mkdir(paths.workDir, { recursive: true });
    await fs.mkdir(paths.imageDir, { recursive: true });
    const segSuffix = typeof scene.segmentIndex === "number" ? `-seg-${scene.segmentIndex}` : "";
    const rawFilename = `${itemId}-scene-${scene.index}${segSuffix}-${safeFilename(scene.screenText)}-flow-raw.png`;
    const rawPath = path.join(paths.workDir, rawFilename);
    const response = await fetch(newUrl.replace(/&amp;/g, "&"), {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://flow.google.com/" },
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`Gagal mengunduh gambar Flow: HTTP ${response.status}`);
    await fs.writeFile(rawPath, Buffer.from(await response.arrayBuffer()));

    // Optimasi ke JPG 16:9 / 9:16 seperti pipeline OpenAI.
    let filename = `${itemId}-scene-${scene.index}${segSuffix}-${safeFilename(scene.screenText)}.jpg`;
    let outputPath = path.join(paths.imageDir, filename);
    try {
      await optimizeToJpg(rawPath, outputPath, size);
      await fs.rm(rawPath, { force: true });
    } catch {
      filename = `${itemId}-scene-${scene.index}${segSuffix}-${safeFilename(scene.screenText)}.png`;
      outputPath = path.join(paths.imageDir, filename);
      await fs.rename(rawPath, outputPath);
    }

    flowLog(`gambar scene ${scene.index} tersimpan: ${filename}`);
    if (config.flow.delayBetweenMs > 0) await sleep(config.flow.delayBetweenMs);

    return {
      sceneIndex: scene.index,
      segmentIndex: scene.segmentIndex || 0,
      provider: "flow",
      path: outputPath,
      url: `/generated/images/${filename}`,
      prompt
    };
  } finally {
    cdp.close();
  }
}

/**
 * Generate SATU gambar Flow per scene (drop-in pengganti generateSceneImage).
 * Dijalankan berurutan lewat antrean karena Flow hanya punya satu tab.
 */
export function generateFlowImage(args) {
  return enqueueFlow(() => generateFlowImageInner(args));
}

/**
 * Pengganti generateSceneGridImage untuk Flow: Flow tidak mendukung grid 2x2,
 * jadi tiap segmen di-generate sebagai gambar tunggal berurutan.
 * Return: array objek dengan bentuk identik (sceneIndex, segmentIndex, ...).
 */
export async function generateFlowGridImages({ itemId, scene, segments, size, quality }) {
  // Kontrak sama dengan generateSceneGridImage: tepat 4 segmen.
  if (!Array.isArray(segments) || segments.length !== 4) {
    throw new Error("Grid image membutuhkan tepat 4 segmen visual.");
  }
  const results = [];
  for (let segIdx = 0; segIdx < segments.length; segIdx += 1) {
    const segment = segments[segIdx];
    const result = await generateFlowImage({
      itemId,
      scene: { ...scene, segmentIndex: segIdx, imagePrompt: segment?.imagePrompt || scene.imagePrompt, screenText: `${scene.screenText}-seg${segIdx}` },
      size,
      quality
    });
    results.push({ ...result, segmentIndex: segIdx, gridSource: false });
  }
  return results;
}

/** Cek cepat: apakah Chrome Flow terjangkau via CDP (untuk preflight). */
export async function checkFlowAvailable() {
  try {
    const tab = await findFlowTab(config.flow.cdpPort);
    return { ok: true, title: tab.title || "", url: tab.url || "" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
