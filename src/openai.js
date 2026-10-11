import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { safeFilename } from "./util.js";
import { generateFlowImage, generateFlowGridImages } from "./flow-image.js";

// Batas waktu per jenis panggilan (pola konstanta modul sama dengan pexels.js).
const CHAT_TIMEOUT_MS = 600_000;
const IMAGE_TIMEOUT_MS = 180_000;
const TTS_TIMEOUT_MS = 120_000;
const TRANSCRIBE_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const RETRY_ATTEMPTS = 3;

export async function requestKnowledgeJson(promptText) {
  assertStory();
  const response = await openAiFetch(`${config.story.baseUrl}/chat/completions`, config.story.timeoutMs, {
    method: "POST",
    headers: storyHeaders(),
    body: JSON.stringify({
      model: config.story.model,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an Indonesian educational video writer. Write factual, engaging, natural Indonesian narration for encyclopedia-style short or long videos according to the user's requested format. Return valid JSON only."
        },
        { role: "user", content: promptText }
      ],
      temperature: 0.78
    })
  });
  const data = await parseOpenAiResponse(response);
  const content = data.choices?.[0]?.message?.content || "";
  return parseStoryJson(content);
}

export async function requestIdeaJson(promptText) {
  assertStory();
  const response = await openAiFetch(`${config.story.baseUrl}/chat/completions`, config.story.timeoutMs, {
    method: "POST",
    headers: storyHeaders(),
    body: JSON.stringify({
      model: config.story.model,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are an Indonesian short-video ideation producer for a factual knowledge channel. Recommend scroll-stopping, factual, low-cost visual ideas. Return valid JSON only."
        },
        { role: "user", content: promptText }
      ],
      temperature: 0.92
    })
  });
  const data = await parseOpenAiResponse(response);
  const content = data.choices?.[0]?.message?.content || "";
  return parseStoryJson(content);
}

export function normalizeImageQuality(quality, model = config.openai.imageModel) {
  const q = String(quality || "").toLowerCase().trim();
  const m = String(model || "").toLowerCase().trim();
  if (m.startsWith("dall-e")) {
    if (q === "high" || q === "hd") return "hd";
    return "standard";
  }
  // gpt-image-1, gpt-image-1-mini, etc.
  // OpenAI Image API supported values: 'low', 'medium', 'high', and 'auto'.
  if (["low", "medium", "high", "auto"].includes(q)) return q;
  if (q === "standard") return "medium";
  if (q === "hd") return "high";
  return "low";
}

export async function generateSceneImage({ itemId, scene, size, quality }) {
  // FROMMUSE: bila IMAGE_PROVIDER=flow, gambar dibuat via Google Flow (CDP),
  // bukan OpenAI. Kontrak return identik.
  if (String(config.image?.provider || "openai").toLowerCase() === "flow") {
    return generateFlowImage({ itemId, scene, size, quality });
  }
  assertOpenAi();
  await fs.mkdir(paths.imageDir, { recursive: true });

  const prompt = sanitizeImagePrompt(scene.imagePrompt, size);
  const normalizedQuality = normalizeImageQuality(quality);
  const response = await openAiFetch(`${config.openai.baseUrl}/images/generations`, IMAGE_TIMEOUT_MS, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.imageModel,
      prompt,
      size,
      quality: normalizedQuality,
      n: 1
    })
  });
  const data = await parseOpenAiResponse(response);
  const item = data.data?.[0];
  if (!item) throw new Error("OpenAI tidak mengembalikan gambar.");

  const segSuffix = typeof scene.segmentIndex === "number" ? `-seg-${scene.segmentIndex}` : "";
  const rawFilename = `${itemId}-scene-${scene.index}${segSuffix}-${safeFilename(scene.screenText)}-raw.png`;
  const rawPath = path.join(paths.workDir, rawFilename);
  let filename = `${itemId}-scene-${scene.index}${segSuffix}-${safeFilename(scene.screenText)}.jpg`;
  let outputPath = path.join(paths.imageDir, filename);
  await fs.mkdir(paths.workDir, { recursive: true });

  if (item.b64_json) {
    await fs.writeFile(rawPath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const image = await fetch(item.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!image.ok) throw new Error(`Gagal download image: HTTP ${image.status}`);
    await fs.writeFile(rawPath, Buffer.from(await image.arrayBuffer()));
  } else {
    throw new Error("Format response image tidak dikenali.");
  }

  try {
    await optimizeImage(rawPath, outputPath, size);
    await fs.rm(rawPath, { force: true });
  } catch {
    filename = `${itemId}-scene-${scene.index}${segSuffix}-${safeFilename(scene.screenText)}.png`;
    outputPath = path.join(paths.imageDir, filename);
    await fs.rename(rawPath, outputPath);
  }

  return {
    sceneIndex: scene.index,
    segmentIndex: scene.segmentIndex || 0,
    provider: providerName(),
    path: outputPath,
    url: `/generated/images/${filename}`,
    prompt
  };
}

/**
 * Generate SATU gambar grid 2x2 (4 panel fotorealistis berurutan) untuk satu scene,
 * lalu potong menjadi 4 frame 16:9 terpisah. 1 panggilan API = 4 visual konsisten.
 * Return: array 4 objek dengan bentuk identik dengan output generateSceneImage.
 */
export async function generateSceneGridImage({ itemId, scene, segments, size, quality }) {
  // FROMMUSE: Flow tidak mendukung grid 2x2; tiap segmen di-generate tunggal.
  if (String(config.image?.provider || "openai").toLowerCase() === "flow") {
    return generateFlowGridImages({ itemId, scene, segments, size, quality });
  }
  assertOpenAi();
  if (!Array.isArray(segments) || segments.length !== 4) {
    throw new Error("Grid image membutuhkan tepat 4 segmen visual.");
  }
  await fs.mkdir(paths.imageDir, { recursive: true });
  await fs.mkdir(paths.workDir, { recursive: true });

  const prompt = buildGridPrompt(segments);
  const normalizedQuality = normalizeImageQuality(quality);
  const response = await openAiFetch(`${config.openai.baseUrl}/images/generations`, IMAGE_TIMEOUT_MS, {
    method: "POST",
    headers: headersJson(),
    body: JSON.stringify({
      model: config.openai.imageModel,
      prompt,
      size,
      quality: normalizedQuality,
      n: 1
    })
  });
  const data = await parseOpenAiResponse(response);
  const item = data.data?.[0];
  if (!item) throw new Error("OpenAI tidak mengembalikan gambar grid.");

  const baseName = `${itemId}-scene-${scene.index}-${safeFilename(scene.screenText)}`;
  const rawPath = path.join(paths.workDir, `${baseName}-grid-raw.png`);
  if (item.b64_json) {
    await fs.writeFile(rawPath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const image = await fetch(item.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!image.ok) throw new Error(`Gagal download image grid: HTTP ${image.status}`);
    await fs.writeFile(rawPath, Buffer.from(await image.arrayBuffer()));
  } else {
    throw new Error("Format response image grid tidak dikenali.");
  }

  let panelPaths;
  try {
    panelPaths = await splitGridImage(rawPath, paths.imageDir, baseName);
  } finally {
    await fs.rm(rawPath, { force: true });
  }

  return panelPaths.map((panelPath, segIdx) => ({
    sceneIndex: scene.index,
    segmentIndex: segIdx,
    provider: providerName(),
    gridSource: true,
    path: panelPath,
    url: `/generated/images/${path.basename(panelPath)}`,
    prompt
  }));
}

export function buildGridPrompt(segments) {
  const positions = ["top-left", "top-right", "bottom-left", "bottom-right"];
  const panelLines = segments.map((segment, index) => (
    `Panel ${index + 1} (${positions[index]}): ${String(segment?.imagePrompt || "").trim()}`
  ));
  return [
    "A single image composed as a strict 2x2 grid of four photorealistic panels separated by thin straight white gutter lines.",
    "The four panels tell ONE continuous visual story in reading order (top-left, top-right, bottom-left, bottom-right), like sequential documentary film stills.",
    ...panelLines,
    `Consistency: all four panels share the exact same photorealistic style, color grading, lighting mood, and recurring main subject or location so they feel like moments from the same footage. ${IMAGE_STYLE_SUFFIX("horizontal landscape 16:9")}`
  ].join("\n");
}

/**
 * Potong gambar grid 2x2 menjadi 4 frame 16:9 (1280x720) dengan FFmpeg.
 * Inset ~2% per sisi kuadran untuk menghindari bleed garis gutter.
 * @returns {Promise<string[]>} 4 path JPG berurutan (panel 1-4).
 */
export function splitGridImage(inputPath, outDir, baseName) {
  const quadrants = [
    { x: "0", y: "0" },
    { x: "iw/2", y: "0" },
    { x: "0", y: "ih/2" },
    { x: "iw/2", y: "ih/2" }
  ];
  const outputs = quadrants.map((_, index) => path.join(outDir, `${baseName}-seg-${index}.jpg`));
  const jobs = quadrants.map((quadrant, index) => {
    // Crop kuadran dengan inset 2% dari tiap sisi (buang gutter), lalu scale+crop ke 1280x720.
    const vf = [
      `crop=iw/2-iw*0.02:ih/2-ih*0.02:${quadrant.x}+iw*0.01:${quadrant.y}+ih*0.01`,
      "scale=1280:720:force_original_aspect_ratio=increase",
      "crop=1280:720"
    ].join(",");
    return new Promise((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-y",
        "-i", inputPath,
        "-vf", vf,
        "-frames:v", "1",
        "-q:v", "7",
        outputs[index]
      ], { windowsHide: true, cwd: paths.rootDir });
      const MAX_BUFFER = 64 * 1024;
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-MAX_BUFFER);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Split grid panel ${index + 1} gagal (${code})`));
      });
    });
  });
  return Promise.all(jobs).then(() => outputs);
}

function optimizeImage(inputPath, outputPath, size = "") {
  let scaleCrop = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
  if (size) {
    const [w, h] = size.split("x").map(Number);
    if (w > h) {
      scaleCrop = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", scaleCrop,
      "-frames:v", "1",
      "-q:v", "7",
      outputPath
    ], { windowsHide: true, cwd: paths.rootDir });
    const MAX_BUFFER = 64 * 1024;
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_BUFFER);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Optimasi gambar gagal (${code})`));
    });
  });
}

export async function generateOpenAiSpeech({ itemId, text, voice, instructions, filenameSuffix = "openai" }) {
  assertOpenAi();
  await fs.mkdir(paths.audioDir, { recursive: true });

  let selectedVoice = voice || config.openai.ttsVoice;
  const filename = `${itemId}-${safeFilename(filenameSuffix)}-narration.mp3`;
  const outputPath = path.join(paths.audioDir, filename);
  const speechInstructions = instructions || config.openai.ttsInstructions;
  const speechSpeed = config.openai.ttsSpeed;
  const supportsInstructions = !["tts-1", "tts-1-hd"].includes(config.openai.ttsModel);

  const requestSpeech = async (voiceName) => {
    const response = await openAiFetch(`${config.openai.baseUrl}/audio/speech`, TTS_TIMEOUT_MS, {
      method: "POST",
      headers: headersJson(),
      body: JSON.stringify({
        model: config.openai.ttsModel,
        voice: voiceName,
        input: text,
        response_format: "mp3",
        speed: speechSpeed,
        ...(supportsInstructions ? { instructions: speechInstructions } : {})
      })
    });
    return {
      response,
      detail: response.ok ? "" : await response.text()
    };
  };

  let result = await requestSpeech(selectedVoice);
  const invalidVoice = /invalid value.*supported values|["']param["']\s*:\s*["']voice["']/i.test(result.detail);
  if (!result.response.ok && invalidVoice && selectedVoice !== "nova") {
    console.warn(`[TTS] Voice OpenAI "${selectedVoice}" tidak valid, fallback ke voice "nova".`);
    selectedVoice = "nova";
    result = await requestSpeech(selectedVoice);
  }
  if (!result.response.ok) {
    throw new Error(`OpenAI TTS gagal HTTP ${result.response.status}: ${result.detail.slice(0, 500)}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await result.response.arrayBuffer()));
  return {
    provider: providerName(),
    model: config.openai.ttsModel,
    voice: selectedVoice,
    speed: speechSpeed,
    path: outputPath,
    url: `/generated/audio/${filename}`
  };
}

export async function transcribeSpeechSegments(audioPath, options = {}) {
  assertOpenAi();
  try {
    return await transcribeSpeechSegmentsWithModel(audioPath, config.openai.transcribeModel, options);
  } catch (error) {
    if (!/verbose_json|response_format|timestamp/i.test(error.message) || config.openai.transcribeModel === "whisper-1") {
      throw error;
    }
    return transcribeSpeechSegmentsWithModel(audioPath, "whisper-1", options);
  }
}

async function transcribeSpeechSegmentsWithModel(audioPath, model, options = {}) {
  const buffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer]), path.basename(audioPath));
  form.append("model", model);
  form.append("language", options.language || "id");
  form.append("response_format", "verbose_json");
  form.append("temperature", String(options.temperature ?? 0));
  // Timestamp per kata dipakai untuk menyelaraskan pergantian visual dan popup
  // dengan momen kata itu benar-benar diucapkan. Harganya sama dengan
  // verbose_json biasa; hanya field responsnya yang bertambah.
  if (options.wordTimestamps !== false) {
    form.append("timestamp_granularities[]", "segment");
    form.append("timestamp_granularities[]", "word");
  }

  if (options.prompt) {
    form.append("prompt", String(options.prompt).slice(0, 220));
  }

  const response = await openAiFetch(`${config.openai.baseUrl}/audio/transcriptions`, TRANSCRIBE_TIMEOUT_MS, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form
  });
  const data = await parseOpenAiResponse(response);
  const words = Array.isArray(data.words)
    ? data.words
      .map((word) => ({
        word: String(word?.word || "").trim(),
        start: Number(word?.start ?? 0),
        end: Number(word?.end ?? 0)
      }))
      .filter((word) => word.word && word.end >= word.start)
    : [];
  const segments = Array.isArray(data.segments) ? data.segments : [];
  if (segments.length) {
    const mapped = segments
      .map((segment) => ({
        start: Number(segment.start || 0),
        end: Number(segment.end || 0),
        text: String(segment.text || "").replace(/\s+/g, " ").trim(),
        avgLogprob: Number(segment.avg_logprob ?? 0),
        noSpeechProb: Number(segment.no_speech_prob ?? 0)
      }))
      .filter((segment) => segment.text && segment.end > segment.start);
    // Kata ditempelkan pada segmen yang memuatnya supaya konsumen bisa memakai
    // waktu asli tiap kata tanpa mengubah bentuk data segmen yang sudah dipakai.
    if (words.length && mapped.length) {
      for (const segment of mapped) {
        segment.words = words.filter((word) => word.start >= segment.start - 0.05 && word.start < segment.end + 0.05);
      }
    }
    return mapped;
  }

  const text = String(data.text || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  return [{
    start: words.length ? words[0].start : 0,
    end: words.length ? words.at(-1).end : 0,
    text,
    avgLogprob: 0,
    noSpeechProb: 0,
    words
  }];
}

// FROMMUSE: beberapa backend OpenAI-compatible (mis. Gemini via 9Router)
// membungkus JSON dengan pagar markdown atau kalimat tambahan.
// Parser toleran: buang pagar, lalu ambil objek JSON terluar.
function parseStoryJson(content) {
  const raw = String(content || "").trim();
  if (!raw) throw new Error("Story backend mengembalikan respons kosong.");
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch (firstError) {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // Lempar error awal dengan konteks di bawah.
      }
    }
    throw new Error(`Respons story bukan JSON valid: ${firstError.message}. Isi: ${unfenced.slice(0, 200)}`);
  }
}

function providerName() {
  return /dinoiki/i.test(config.openai.baseUrl) ? "dinoiki" : "openai";
}

function assertOpenAi() {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY belum diisi.");
}

// FROMMUSE: story/chat boleh memakai endpoint berbeda (Hermes/9Router).
// Key mengikuti fallback runtime ke OPENAI_API_KEY agar stub/pola lama tetap jalan.
function storyApiKey() {
  return config.story.apiKey || config.openai.apiKey;
}

function assertStory() {
  if (!storyApiKey()) throw new Error("STORY_API_KEY (atau OPENAI_API_KEY) belum diisi.");
}

function storyHeaders() {
  return {
    Authorization: `Bearer ${storyApiKey()}`,
    "Content-Type": "application/json"
  };
}

function headersJson() {
  return {
    Authorization: `Bearer ${config.openai.apiKey}`,
    "Content-Type": "application/json"
  };
}

function IMAGE_STYLE_SUFFIX(orientation) {
  return `${orientation} editorial knowledge video illustration, Indonesian friendly educational visual style, cinematic but bright, high detail, clear subject, varied composition, no written text inside the image, no logo, no watermark, no celebrity likeness, no gore, no injury`;
}

function sanitizeImagePrompt(value, size = "") {
  let orientation = "vertical 9:16";
  if (size) {
    const [w, h] = size.split("x").map(Number);
    if (w > h) orientation = "horizontal landscape 16:9";
  }
  return [
    String(value || ""),
    IMAGE_STYLE_SUFFIX(orientation)
  ].join(", ");
}

async function parseOpenAiResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

/**
 * fetch ke OpenAI dengan timeout + retry untuk error transien (429 dan 5xx).
 * Tanpa ini, satu 429 di scene ke-18 membatalkan seluruh run dan menghanguskan
 * 17 gambar yang sudah dibayar.
 *
 * Timeout sengaja TIDAK di-retry: request gambar yang sudah diproses server tetap
 * ditagih, jadi mengulangnya berarti bayar dua kali. Lebih baik gagal dengan pesan jelas.
 */
async function openAiFetch(url, timeoutMs, init) {
  for (let attempt = 1; ; attempt += 1) {
    const lastAttempt = attempt >= RETRY_ATTEMPTS;
    let response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new Error(`OpenAI tidak merespons dalam ${Math.round(timeoutMs / 1000)}s: ${endpointName(url)}`);
      }
      if (lastAttempt) throw error;
      console.warn(`[OpenAI] ${endpointName(url)} gagal (${error.message}), retry ${attempt + 1}/${RETRY_ATTEMPTS}.`);
      await sleep(retryDelayMs(attempt, null));
      continue;
    }

    if (lastAttempt || (response.status !== 429 && response.status < 500)) return response;

    const delayMs = retryDelayMs(attempt, response.headers.get("retry-after"));
    // Buang body supaya koneksi bebas sebelum menunggu.
    await response.body?.cancel().catch(() => {});
    console.warn(`[OpenAI] ${endpointName(url)} HTTP ${response.status}, retry ${attempt + 1}/${RETRY_ATTEMPTS} dalam ${delayMs}ms.`);
    await sleep(delayMs);
  }
}

function retryDelayMs(attempt, retryAfterHeader) {
  // Retry-After bisa berupa detik atau HTTP-date; hanya bentuk detik yang dipakai.
  const seconds = Number(retryAfterHeader);
  if (retryAfterHeader !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, seconds * 1000);
  }
  return attempt * 3000;
}

function endpointName(url) {
  return String(url).split("/").pop() || "openai";
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
