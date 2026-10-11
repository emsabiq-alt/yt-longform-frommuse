import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";

const STATE_FILES = ["items.json", "queue.json"];

const MAX_BODY_BYTES = 1_000_000; // 1 MB — batas ukuran request body.

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

/**
 * Error yang aman ditampilkan ke klien (pesan validasi/operasional).
 * Error tanpa flag ini dianggap internal → pesan disembunyikan oleh sendError.
 */
export function clientError(message, status = 400) {
  const error = new Error(message);
  error.expose = true;
  error.status = status;
  return error;
}

/**
 * Kirim error: detail lengkap ke log server, pesan generik ke klien
 * kecuali error sengaja ditandai aman (expose).
 */
export function sendError(res, error, fallbackStatus = 500) {
  console.error("[api]", error?.stack || error?.message || error);
  const status = Number(error?.status) || fallbackStatus;
  const message = error?.expose ? error.message : "Terjadi kesalahan internal. Cek log server.";
  sendJson(res, status, { error: message });
}

export function methodAllowed(req, res, methods) {
  if (methods.includes(req.method)) return true;
  sendJson(res, 405, { error: `Method ${req.method} tidak didukung.` });
  return false;
}

function parseJsonBody(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw clientError("Body JSON tidak valid.", 400);
  }
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return parseJsonBody(req.body);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw clientError("Request body terlalu besar.", 413);
    chunks.push(Buffer.from(chunk));
  }
  return parseJsonBody(Buffer.concat(chunks).toString("utf8"));
}

export function clean(value) {
  return String(value || "").trim();
}

/** Trim + potong string ke panjang maksimum (cegah input liar membengkak). */
export function clampStr(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

/** Number terbatas: NaN/di luar rentang dikembalikan ke nilai aman. */
export function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeTrendInput(trend) {
  if (!trend || typeof trend !== "object" || Array.isArray(trend)) return null;
  const newsItems = (Array.isArray(trend.newsItems) ? trend.newsItems : []).slice(0, 12).map((item) => ({
    title: clampStr(item?.title || item?.headline, 240),
    source: clampStr(item?.source || item?.outlet, 100),
    url: clampStr(item?.url, 500),
    publishedAt: clampStr(item?.publishedAt, 80),
    excerpt: clampStr(item?.excerpt, 1000),
    imageUrl: clampStr(item?.imageUrl, 500)
  })).filter((item) => item.title && item.source);
  if (!newsItems.length) return null;
  return {
    title: clampStr(trend.title, 180),
    articles: clampNum(trend.articles, 0, 10_000, 0),
    sources: clampNum(trend.sources, 0, 1_000, 0),
    days: clampNum(trend.days, 0, 365, 0),
    newsItems
  };
}

export function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function boolInput(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

// ---------------- Auth ----------------
const SESSION_COOKIE = "yt_dashboard_session";
const LEGACY_PIN_COOKIE = "yt_dashboard_pin";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

/**
 * Perbandingan string konstan-waktu (anti timing attack).
 * HMAC kedua sisi dengan kunci acak sehingga digest selalu sama panjang —
 * aman untuk PIN dengan panjang berapa pun tanpa membocorkan panjang lewat timing.
 */
export function safeEqual(a, b) {
  const key = crypto.randomBytes(32);
  const da = crypto.createHmac("sha256", key).update(String(a ?? "")).digest();
  const db = crypto.createHmac("sha256", key).update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(da, db);
}

// ---- Rate limit brute-force (best-effort, in-memory per instance) ----
// Catatan: di serverless counter ini per-instance & hilang saat cold start —
// jadi ini "speed bump", bukan proteksi mutlak. Pertahanan utama = PIN panjang-acak.
// Untuk proteksi kuat lintas-instance, pindahkan ke store eksternal (Vercel KV/Upstash).
const RL_WINDOW_MS = 60_000;
const RL_MAX_FAILS = 10;
const authFails = new Map(); // ip -> { count, resetAt }

function clientIp(req) {
  const xff = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket?.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const entry = authFails.get(clientIp(req));
  return Boolean(entry && entry.resetAt > Date.now() && entry.count >= RL_MAX_FAILS);
}

function noteAuthFailure(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = authFails.get(ip);
  if (!entry || entry.resetAt <= now) authFails.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
  else entry.count += 1;
}

function noteAuthSuccess(req) {
  authFails.delete(clientIp(req));
}

// ---- Token sesi (cookie tidak lagi menyimpan PIN mentah) ----
function sessionSecret() {
  const explicit = clean(process.env.DASHBOARD_SESSION_SECRET);
  if (explicit) return explicit;
  // Fallback: turunkan dari PIN agar tetap berfungsi tanpa env baru.
  // Token otomatis invalid bila PIN diganti.
  return `pin:${clean(process.env.AUTO_DASHBOARD_PIN)}`;
}

export function issueSessionToken() {
  const payload = `v1.${Date.now() + SESSION_TTL_MS}`;
  const sig = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(`v1.${parts[1]}`).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAuth(req, res) {
  const expected = clean(process.env.AUTO_DASHBOARD_PIN);
  if (!expected) {
    sendJson(res, 403, { error: "AUTO_DASHBOARD_PIN belum diset di Vercel Environment." });
    return false;
  }
  if (isRateLimited(req)) {
    sendJson(res, 429, { error: "Terlalu banyak percobaan. Coba lagi dalam semenit." });
    return false;
  }
  const headerPin = clean(req.headers["x-dashboard-pin"]);
  const sessionOk = verifySessionToken(cookieValue(req.headers.cookie || "", SESSION_COOKIE));
  if ((headerPin && safeEqual(headerPin, expected)) || sessionOk) {
    noteAuthSuccess(req);
    return true;
  }
  noteAuthFailure(req);
  sendJson(res, 401, { error: "PIN dashboard tidak valid atau belum diisi." });
  return false;
}

/** Cek rate-limit khusus endpoint login. Mengembalikan false (+ kirim 429) bila terblokir. */
export function checkLoginRate(req, res) {
  if (isRateLimited(req)) {
    sendJson(res, 429, { error: "Terlalu banyak percobaan. Coba lagi dalam semenit." });
    return false;
  }
  return true;
}

/** Catat hasil percobaan login untuk rate-limit. */
export function recordLogin(req, ok) {
  if (ok) noteAuthSuccess(req);
  else noteAuthFailure(req);
}

export function setSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${issueSessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function clearPinCookie(res) {
  // Hapus cookie sesi baru sekaligus cookie PIN lama (legacy).
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${LEGACY_PIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  ]);
}

// ---------------- State (read from hosting, write via SFTP) ----------------
export async function readState() {
  const entries = await Promise.all(STATE_FILES.map(async (file) => [file.replace(/\.json$/, ""), await readStateFile(file)]));
  return Object.fromEntries(entries);
}

export async function readStateFile(file) {
  const fromRemote = await readStateFileFromPublicBaseUrl(file);
  if (fromRemote !== null) return fromRemote;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", file), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function readStateFileFromPublicBaseUrl(file) {
  const baseUrl = cleanBaseUrl(process.env.PUBLIC_BASE_URL);
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${baseUrl}/state/${encodeURIComponent(file)}?v=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (file === "items.json" && data && !Array.isArray(data) && Array.isArray(data.items)) return data.items;
    return data;
  } catch {
    return null;
  }
}

export async function uploadStateFile(file, data) {
  const cfg = remoteConfig();
  if (!["ftp", "sftp"].includes(cfg.driver)) return { skipped: true };
  const missing = remoteMissingEnv(cfg);
  if (missing.length) throw clientError(`${cfg.label} env belum lengkap untuk update state: ${missing.join(", ")}`, 500);

  const raw = `${JSON.stringify(data, null, 2)}\n`;
  await withRemoteRetry(async () => {
    if (cfg.driver === "sftp") {
      const client = new SftpClient();
      try {
        await client.connect({
          host: cfg.host, port: cfg.port, username: cfg.user,
          privateKey: cfg.privateKey || undefined,
          password: cfg.password || undefined,
          readyTimeout: Math.max(cfg.stateTimeoutMs, 30000),
          keepaliveInterval: 10000, keepaliveCountMax: 12
        });
        const stateDir = path.posix.join(cfg.remoteDir, "state");
        await client.mkdir(stateDir, true);
        await client.put(Readable.from([Buffer.from(raw, "utf8")]), path.posix.join(stateDir, file));
      } finally {
        await client.end().catch(() => {});
      }
      return;
    }
    const client = new FtpClient(cfg.stateTimeoutMs);
    try {
      await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: false });
      await client.ensureDir(path.posix.join(cfg.remoteDir, "state"));
      await client.uploadFrom(Readable.from([Buffer.from(raw, "utf8")]), file);
    } finally {
      client.close();
    }
  });
  return { skipped: false };
}

// ---------------- Config summary ----------------
export function configSummary() {
  return {
    publicBaseUrl: cleanBaseUrl(process.env.PUBLIC_BASE_URL),
    timezone: clean(process.env.YT_TIME_ZONE || "Asia/Bangkok"),
    uploadDriver: clean(process.env.UPLOAD_DRIVER || "sftp"),
    durationSec: clampNum(process.env.YT_DURATION_SEC || 1200, 300, 1200, 1200),
    sceneCount: Math.min(48, Math.max(8, Number(process.env.YT_SCENE_COUNT || 36))),
    dailyGenerateLimit: Number(process.env.YT_DAILY_GENERATE_LIMIT || 1),
    youtubeEnabled: boolEnv("YOUTUBE_UPLOAD_ENABLED", true),
    youtubeDailyUploadLimit: Number(process.env.YOUTUBE_DAILY_UPLOAD_LIMIT || 2),
    youtubePrivacy: clean(process.env.YOUTUBE_PRIVACY_STATUS || "public"),
    ttsModel: clean(process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"),
    ttsVoice: clean(process.env.OPENAI_TTS_VOICE || "nova"),
    openaiTtsSpeed: Math.min(4, Math.max(0.25, numberEnv("OPENAI_TTS_SPEED", 1.08))),
    ttsProvider: clean(process.env.YT_TTS_PROVIDER || "openai"),
    resolution: clean(process.env.YT_RESOLUTION || "1080p"),
    elevenlabsVoiceId: clean(process.env.ELEVENLABS_VOICE_ID || "wUrGnU2Kx934kbDdOWDo"),
    elevenlabsSpeed: Math.min(1.2, Math.max(0.7, numberEnv("ELEVENLABS_SPEED", 1.08))),
    storyModel: clean(process.env.STORY_MODEL || "gpt-4.1-mini"),
    imageModel: clean(process.env.IMAGE_MODEL || "gpt-image-1-mini"),
    workflow: clean(process.env.DASHBOARD_WORKFLOW_FILE || process.env.YT_WORKFLOW_FILE || "yt-longform-generate.yml"),
    repo: githubRepo(),
    vercelDashboard: true
  };
}

// ---------------- GitHub Actions ----------------
export async function getRecentRuns(limit = 6) {
  const token = githubToken();
  if (!token) return [];
  const repo = githubRepo();
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=${limit}`, {
    headers: githubHeaders(token), cache: "no-store"
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.workflow_runs || []).map((run) => ({
    id: run.id, name: run.name, status: run.status, conclusion: run.conclusion,
    event: run.event, head_branch: run.head_branch, run_attempt: run.run_attempt,
    display_title: run.display_title || run.head_commit?.message || "",
    created_at: run.created_at, updated_at: run.updated_at, html_url: run.html_url
  }));
}

export async function getRunJobs(runId) {
  const token = githubToken();
  if (!token || !runId) return [];
  const repo = githubRepo();
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=30`, {
    headers: githubHeaders(token), cache: "no-store"
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.jobs || []).map((job) => ({
    id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
    started_at: job.started_at, completed_at: job.completed_at, html_url: job.html_url,
    steps: (job.steps || []).map((step) => ({
      name: step.name, status: step.status, conclusion: step.conclusion,
      number: step.number, started_at: step.started_at, completed_at: step.completed_at
    }))
  }));
}

export async function dispatchWorkflow(inputs) {
  const token = githubToken();
  if (!token) throw clientError("GH_REPO_SECRET_TOKEN belum diset di Vercel Environment.", 500);
  const repo = githubRepo();
  const workflow = clean(process.env.DASHBOARD_WORKFLOW_FILE || process.env.YT_WORKFLOW_FILE || "yt-longform-generate.yml");
  const ref = clean(process.env.DASHBOARD_GITHUB_REF || "main");
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    { method: "POST", headers: githubHeaders(token), body: JSON.stringify({ ref, inputs }) }
  );
  if (response.status === 204) return { ok: true, repo, workflow, ref };
  let detail = "";
  try { detail = JSON.stringify(await response.json()); } catch { detail = await response.text(); }
  // Detail lengkap GitHub API ke log saja; klien cukup tahu status (hindari bocor struktur repo).
  console.error("[dispatchWorkflow]", response.status, detail.slice(0, 500));
  throw clientError(`Gagal trigger workflow (HTTP ${response.status}).`, 502);
}

// ---------------- Queue helpers ----------------
export function buildQueueItem(input) {
  const now = new Date().toISOString();
  const ttsProviderRaw = clean(input.ttsProvider || "openai").toLowerCase();
  const ttsProvider = ttsProviderRaw === "elevenlabs" || ttsProviderRaw === "groq" ? ttsProviderRaw : "openai";
  const defaultTtsVoice = ttsProvider === "elevenlabs"
    ? process.env.ELEVENLABS_VOICE_ID || "wUrGnU2Kx934kbDdOWDo"
    : ttsProvider === "groq"
      ? process.env.GROQ_TTS_VOICE || "troy"
      : process.env.OPENAI_TTS_VOICE || "fable";
  const durSec = clampNum(input.durationSec || process.env.YT_DURATION_SEC || 1200, 300, 1200, 1200);
  const defaultScenes = Math.round(durSec / 33);
  return {
    id: clampStr(input.id, 80) || makeId("q"),
    topic: clampStr(input.topic, 300),
    category: clampStr(input.category || process.env.YT_DEFAULT_CATEGORY || "vulkanologi", 80),
    formatType: clampStr(input.formatType || input.format_type || "", 40),
    durationSec: durSec,
    sceneCount: clampNum(
      input.sceneCount || (input.durationSec ? defaultScenes : (process.env.YT_SCENE_COUNT || defaultScenes)),
      8,
      48,
      defaultScenes
    ),
    ttsProvider,
    ttsVoice: clampStr(input.ttsVoice || defaultTtsVoice, 80),
    imageQuality: clampStr(input.imageQuality || "low", 20),
    resolution: clampStr(input.resolution || "1080p", 10),
    priority: clampNum(input.priority || 1, 1, 99, 1),
    status: clampStr(input.status || "pending", 40),
    notes: clampStr(input.notes || "", 500),
    trend: normalizeTrendInput(input.trendContext || input.trend),
    dynamicScenes: input.dynamicScenes === true || input.dynamicScenes === "true",
    createdAt: clampStr(input.createdAt, 40) || now,
    updatedAt: now
  };
}

export function upsertById(items, item) {
  const list = Array.isArray(items) ? [...items] : [];
  const index = list.findIndex((entry) => entry?.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = { ...list[index], ...item };
  return list;
}

export function removeById(items, id) {
  return (Array.isArray(items) ? items : []).filter((entry) => entry?.id !== id);
}

export function makeId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = crypto.randomBytes(2).toString("hex");
  return `${prefix}_${stamp}_${random}`;
}

export function check(name, ok, detail = "", required = true) {
  return { name, ok: Boolean(ok), detail, required };
}

// ---------------- Remote config ----------------
export function remoteConfig() {
  const driver = clean(process.env.UPLOAD_DRIVER || "sftp").toLowerCase();
  const prefix = driver === "sftp" ? "SFTP" : "FTP";
  const fallbackPrefix = prefix === "SFTP" ? "FTP" : "SFTP";
  const names = (suffix) => [`${prefix}_${suffix}`, `${fallbackPrefix}_${suffix}`];
  const defaultPort = driver === "sftp" ? 65002 : 21;
  return {
    driver,
    label: driver === "sftp" ? "SFTP" : "FTP",
    prefix,
    host: clean(firstEnv(names("HOST"))),
    port: numberEnvFrom(driver === "sftp" ? ["SFTP_PORT"] : names("PORT"), defaultPort),
    user: clean(firstEnv(names("USER"))),
    password: firstEnv(names("PASSWORD")),
    privateKey: firstEnv(names("PRIVATE_KEY")),
    remoteDir: clean(firstEnv(names("REMOTE_DIR"), "/public_html/yt")),
    stateTimeoutMs: numberEnvFrom(names("STATE_TIMEOUT_SECONDS"), 180) * 1000,
    retries: Math.max(1, numberEnvFrom(names("UPLOAD_RETRIES"), 4))
  };
}

export function remoteMissingEnv(cfg) {
  const missing = [];
  if (!cfg.host) missing.push(`${cfg.prefix}_HOST`);
  if (!cfg.user) missing.push(`${cfg.prefix}_USER`);
  if (!cfg.password && !cfg.privateKey) missing.push(`${cfg.prefix}_PASSWORD`);
  if (!cfg.remoteDir) missing.push(`${cfg.prefix}_REMOTE_DIR`);
  return missing;
}

async function withRemoteRetry(task) {
  const cfg = remoteConfig();
  const attempts = cfg.retries;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const retriable = !/\b(530|550|553)\b|auth|authentication|permission denied|login incorrect/i.test(message)
        && /timeout|timed out|closed|socket|econn|etimedout|econnreset|econnrefused|epipe|421|425|426|450|451/i.test(message);
      if (attempt >= attempts || !retriable) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 1500 * attempt)));
    }
  }
  throw lastError;
}

// ---------------- internals ----------------
function githubRepo() {
  return clean(process.env.DASHBOARD_GITHUB_REPO || process.env.GITHUB_REPOSITORY || "emsabiq-alt/yt-longform");
}

function githubToken() {
  return clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN);
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "yt-longform-dashboard"
  };
}

function firstEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function numberEnvFrom(names, fallback) {
  const value = Number(firstEnv(names));
  return Number.isFinite(value) ? value : fallback;
}

function cleanBaseUrl(value) {
  return clean(value).replace(/\/+$/, "");
}

function cookieValue(raw, name) {
  for (const part of String(raw || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
