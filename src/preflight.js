import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, paths } from "./config.js";
import { remoteConfig, remoteEnabled } from "./remote.js";
import { checkFlowAvailable } from "./flow-image.js";

export async function runPreflight() {
  const checks = [];
  checks.push(checkCommand("ffmpeg"));
  checks.push(checkCommand("ffprobe"));
  // FROMMUSE: story/chat kini lewat STORY_* (Hermes/9Router); gambar via Flow tidak butuh OpenAI key.
  checks.push(checkValue("STORY_API_KEY", Boolean(config.story.apiKey), "Naskah/ide/judul butuh STORY_API_KEY (atau OPENAI_API_KEY). Arahkan STORY_BASE_URL ke 9Router bila memakai Hermes."));
  const imageProvider = String(config.image?.provider || "openai").toLowerCase();
  if (imageProvider === "flow") {
    const flow = await checkFlowAvailable();
    checks.push(checkValue("FLOW_CDP", flow.ok, flow.ok ? `Chrome Flow terhubung (port ${config.flow.cdpPort}).` : `Chrome Flow tidak terjangkau: ${flow.error}`));
  } else {
    checks.push(checkValue("OPENAI_API_KEY", Boolean(config.openai.apiKey), "IMAGE_PROVIDER=openai butuh OPENAI_API_KEY untuk generate gambar."));
  }
  checks.push(checkOptional("GROQ_API_KEY", Boolean(config.groq.apiKey), "YT_TTS_PROVIDER=groq butuh GROQ_API_KEY. Tanpa key, TTS memakai OpenAI/ElevenLabs."));
  checks.push(checkOptional("PEXELS_API_KEY", Boolean(config.pexels?.apiKey), "Video B-roll Pexels butuh key ini. Tanpa key, media dilanjutkan ke Wikimedia/OpenAI."));
  checks.push(checkOptional("WIKIMEDIA_MEDIA", Boolean(config.wikimedia?.enabled), "Wikimedia Commons aktif tanpa API key sebagai fallback media berlisensi aman."));
  checks.push(checkOptional("GOOGLE_CSE_KEY", Boolean((config.googleSearch?.apiKey && config.googleSearch?.cx) || config.serper?.apiKey), "Google Images API aktif untuk mengambil gambar berita mockup secara resmi via Google Image Search."));
  checks.push(checkOptional("YOUTUBE_DATA_API_KEY", Boolean(config.youtube?.dataApiKey), "Trending topic engine butuh key ini. Tanpa key, topik dipilih tanpa sinyal trending."));
  // PUBLIC_BASE_URL hanya wajib bila YouTube upload aktif (pelajaran 12 Okt 2026)
  if (config.youtube.enabled) {
    checks.push(checkValue("PUBLIC_BASE_URL", Boolean(config.publicBaseUrl || process.env.PUBLIC_BASE_URL), "Butuh base URL publik untuk preview asset dan upload YouTube fetchable."));
  } else {
    checks.push(checkOptional("PUBLIC_BASE_URL", Boolean(config.publicBaseUrl || process.env.PUBLIC_BASE_URL), "Opsional untuk run lokal tanpa upload YouTube."));
  }

  const remote = remoteConfig();
  // UPLOAD_DRIVER=none valid untuk run lokal tanpa upload remote (pelajaran 12 Okt 2026)
  const driverOk = remote.driver === "none" || remoteEnabled();
  checks.push(checkValue("UPLOAD_DRIVER", driverOk, `Driver aktif: ${remote.driver}`));
  if (remoteEnabled()) {
    checks.push(checkValue(`${remote.prefix}_HOST`, Boolean(remote.host), "Host upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_USER`, Boolean(remote.user), "User upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_PASSWORD`, Boolean(remote.password), "Password upload remote wajib ada."));
    checks.push(checkValue(`${remote.prefix}_REMOTE_DIR`, Boolean(remote.remoteDir), "Folder remote wajib ada."));
  }

  if (config.youtube.enabled) {
    checks.push(checkValue("YOUTUBE_CLIENT_ID", Boolean(config.youtube.clientId), "OAuth Client ID YouTube wajib diisi."));
    checks.push(checkValue("YOUTUBE_CLIENT_SECRET", Boolean(config.youtube.clientSecret), "OAuth Client Secret YouTube wajib diisi."));
    checks.push(checkValue("YOUTUBE_REFRESH_TOKEN", Boolean(config.youtube.refreshToken), "Refresh token YouTube wajib diisi."));
  }

  checks.push(await checkFile("background_music", path.join(paths.rootDir, "assets", "music", "Marimba Curiosity Case (5 Minute Version).mp3")));
  checks.push(await checkFile("font_title", path.join(paths.fontDir, "BebasNeue-Regular.ttf")));
  checks.push(await checkFile("font_body", path.join(paths.fontDir, "NotoSans-Variable.ttf")));
  checks.push(await checkFile("font_mono", path.join(paths.fontDir, "JetBrainsMono-Variable.ttf")));
  if (config.pexels.overlayEnabled) {
    checks.push(await checkFile("pexels_overlay", config.pexels.overlayPath));
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    checks,
    summary: failed.length ? `${failed.length} preflight check gagal.` : "Preflight aman."
  };
}

function checkCommand(name) {
  const result = spawnSync(name, ["-version"], { encoding: "utf8", windowsHide: true });
  return { name, ok: result.status === 0, detail: result.status === 0 ? firstLine(result.stdout || result.stderr) : `${name} tidak tersedia.` };
}

function checkValue(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

function checkOptional(name, ok, detail) {
  return { name, ok: true, detail: ok ? detail : `[opsional] ${detail}` };
}

async function checkFile(name, filePath) {
  try {
    const stat = await fs.stat(filePath);
    return { name, ok: stat.isFile(), detail: `${Math.round(stat.size / 1024)} KB` };
  } catch {
    return { name, ok: false, detail: `${filePath} tidak ditemukan.` };
  }
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || "OK";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
