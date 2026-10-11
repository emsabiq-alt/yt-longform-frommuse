import fs from "node:fs/promises";
import path from "node:path";
import { config, ensureProjectDirs } from "./config.js";
import { buildTitle, buildDescription, formatMetaForCopy } from "./youtube-meta.js";
import { generateFullItem } from "./pipeline.js";
import { absolutizeGeneratedUrls, publicBaseUrl, remoteEnabled, uploadGeneratedStateAndAssets } from "./remote.js";
import { listContextItems, mergeMemoryItems, saveItem } from "./storage.js";
import { publishToYoutube, getYoutubeAccessToken } from "./youtube-publisher.js";
import { addToPlaylistByCategory } from "./youtube-playlist.js";
import { translateYoutubeMetadata } from "./youtube-localization.js";
import { reportProgress } from "./progress.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function topicValue(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        topic: String(parsed.topic || ""),
        trend: parsed.trend || null,
        dynamicScenes: parsed.dynamicScenes === true
      };
    }
  } catch {
    // Topik biasa memang bukan JSON.
  }
  return { topic: value, trend: null, dynamicScenes: false };
}

ensureProjectDirs();

const ttsProvider = argValue("--tts-provider", process.env.YT_TTS_PROVIDER || "openai");
const defaultTtsVoice = String(ttsProvider).toLowerCase() === "elevenlabs"
  ? config.elevenlabs.voiceId
  : String(ttsProvider).toLowerCase() === "groq"
    ? config.groq.ttsVoice
    : config.openai.ttsVoice;
const topicPayload = topicValue(argValue("--topic", process.env.YT_TOPIC || ""));

const durationSec = Number(argValue("--duration", process.env.YT_DURATION_SEC || String(config.automation.durationSec))) || config.automation.durationSec;
const defaultScenes = Math.round(durationSec / 33);
const rawScenes = argValue("--scenes", process.env.YT_SCENE_COUNT || "");
const sceneCount = rawScenes ? (Number(rawScenes) || defaultScenes) : defaultScenes;

const defaultCategory = process.env.YT_DEFAULT_CATEGORY || config.topic?.defaultCategory || "vulkanologi";
const rawCategory = argValue("--category", defaultCategory);
const category = (!rawCategory || rawCategory === "random") ? defaultCategory : rawCategory;

const input = {
  category,
  topic: topicPayload.topic || (argValue("--topic") ? "" : undefined),
  formatType: argValue("--format-type", process.env.YT_FORMAT_TYPE || ""),
  ttsProvider,
  ttsVoice: argValue("--tts-voice", process.env.YT_TTS_VOICE || defaultTtsVoice),
  durationSec,
  sceneCount,
  imageQuality: argValue("--image-quality", process.env.IMAGE_QUALITY || config.openai.imageQuality),
  imageSize: argValue("--image-size", process.env.IMAGE_SIZE || "1536x1024"),
  resolution: argValue("--resolution", process.env.YT_RESOLUTION || "720p"),
  trend: topicPayload.trend,
  dynamicScenes: topicPayload.dynamicScenes || false
};

const dailyGenerateLimit = config.automation.dailyGenerateLimit;

console.log("YT Longform run started.");
console.log(`Category=${input.category}, duration=${input.durationSec}, scenes=${input.sceneCount}, ttsVoice=${input.ttsVoice}`);

const noRemote = boolValue(argValue("--no-remote", "false"));
const noUpload = boolValue(argValue("--no-upload", "false"));
const localOnly = boolValue(argValue("--local", process.env.YT_LOCAL_ONLY || "false"));

const shouldUploadRemote = remoteEnabled() && !localOnly && !noRemote;
const shouldUploadYoutube = config.youtube.enabled && !localOnly && !noUpload;

if (shouldUploadRemote) {
  await importRemoteState();
}

// Di luar GitHub Actions (run lokal) selalu paksa supaya mudah dites.
// Di dalam Actions — baik schedule maupun manual dispatch dari dashboard — hormati nilai --force,
// sehingga kotak ceklis "Paksa (abaikan batas harian)" benar-benar mengontrol bypass limit.
const runningInActions = process.env.GITHUB_ACTIONS === "true";
const forceArg = argValue("--force", process.env.YT_FORCE_GENERATE || "false");
const force = boolValue(forceArg) || !runningInActions;
// Log eksplisit supaya status "Paksa" terlihat jelas di log workflow — memudahkan
// memastikan apakah ceklis benar-benar terkirim (true) atau tidak (false/kosong).
console.log(`Mode Paksa (abaikan batas harian): ${force ? "AKTIF — limit harian diabaikan" : "NON-AKTIF — limit harian dihormati"} (nilai --force="${forceArg}", di GitHub Actions=${runningInActions}).`);

if (localOnly) {
  console.log("Mode LOKAL: render saja, tanpa SFTP & tanpa upload YouTube.");
} else {
  if (noRemote) {
    console.log("Upload SFTP dilewati sesuai parameter --no-remote.");
  }
  if (noUpload) {
    console.log("Upload YouTube dilewati sesuai parameter --no-upload.");
  }
}

if (!force && await dailyGenerationLimitReached()) {
  console.log(JSON.stringify({
    status: "skipped",
    reason: `Batas generate harian tercapai (${dailyGenerateLimit}/hari). Centang "Paksa (abaikan batas harian)" di dashboard sebelum Generate untuk tetap menjalankan.`,
    dateKey: localDayKey(new Date()),
    dailyGenerateLimit,
    force
  }, null, 2));
  process.exit(0);
}

const result = await generateFullItem(input, { voice: input.ttsVoice });

if (localOnly) {
  const videoPath = result.item.assets?.video?.path || "";
  let metaPath = "";
  try {
    const metaText = formatMetaForCopy(result.item);
    if (videoPath) {
      metaPath = videoPath.replace(/\.[^.]+$/, "") + "-youtube.txt";
      await fs.writeFile(metaPath, metaText, "utf8");
    }
    console.log("\n========== JUDUL & DESKRIPSI YOUTUBE (siap copy) ==========\n");
    console.log(metaText);
    if (metaPath) console.log("Tersimpan juga di: " + metaPath);
  } catch (e) { console.warn("Gagal membuat meta YouTube: " + e.message); }
  console.log("@@LOCAL_OUTPUT " + JSON.stringify({ path: videoPath, title: result.item.title, metaPath }) + "@@");
  console.log(JSON.stringify({
    status: "done-local",
    id: result.item.id,
    title: result.item.title,
    videoPath,
    note: "File tersimpan lokal. Tidak diupload.",
    warnings: result.warnings
  }, null, 2));
  process.exit(0);
}

let remoteUploadError = null;
if (shouldUploadRemote) {
  reportProgress("upload", "Mengunggah aset ke SFTP/Hosting", 10, "menghubungkan...");
  result.item = absolutizeGeneratedUrls(result.item);
  await mergeMemoryItems([result.item]);
  await saveItem(result.item);
  try {
    await uploadGeneratedStateAndAssets({ item: result.item });
    console.log("Remote upload complete.");
    reportProgress("upload", "Upload SFTP selesai", 100, "sukses");
  } catch (error) {
    const message = `Remote upload gagal: ${error.message}`;
    result.warnings.push(message);
    console.warn(message);
    remoteUploadError = error;
    reportProgress("upload", "Upload SFTP gagal", 100, "gagal");
  }
} else {
  reportProgress("upload", "Upload SFTP dilewati", 100, "dilewati");
}

if (shouldUploadYoutube) {
  console.log("[Publish] Memulai upload YouTube dari file lokal runner.");
  reportProgress("publish", "Mengunggah video ke YouTube", 10, "persiapan...");
  await publishYoutubeIfEnabled(result);
} else {
  reportProgress("publish", "Publish YouTube dilewati", 100, "dilewati");
}

if (remoteUploadError && config.automation.strictRemote) throw remoteUploadError;

console.log(JSON.stringify({
  status: "done",
  id: result.item.id,
  title: result.item.title,
  videoUrl: result.item.assets?.video?.url || "",
  youtubeUrl: result.item.publish?.youtube?.url || "",
  warnings: result.warnings
}, null, 2));

async function publishYoutubeIfEnabled(result) {
  if (!shouldUploadYoutube) return;
  const item = result.item;
  try {
    if (!force && await youtubeDailyLimitReached()) {
      const message = `Batas upload YouTube harian tercapai (${config.youtube.dailyUploadLimit}/hari).`;
      result.warnings.push(message);
      console.warn(message);
      reportProgress("publish", "Batas upload harian tercapai", 100, "limit tercapai");
      return;
    }
    reportProgress("publish", "Mengunggah video ke YouTube", 30, "mengirim berkas...");
    const title = buildTitle(item);
    const description = buildDescription(item);
    const localization = await translateYoutubeMetadata({ title, description });
    if (localization.skipped) {
      console.log(`[Localization] Dilewati: ${localization.reason}`);
    } else if (!localization.ok) {
      result.warnings.push(`Lokalisasi YouTube gagal: ${localization.reason}`);
      console.warn(`[Localization] ${localization.reason}`);
    } else {
      console.log(`[Localization] Siap: ${localization.languages.join(", ")}`);
    }
    const published = await publishToYoutube({
      videoPath: item.assets?.video?.path || "",
      title,
      description,
      tags: [item.input?.category, item.input?.topic].filter(Boolean),
      thumbnailPath: item.assets?.thumbnail?.path || "",
      srtPath: item.assets?.video?.srtPath || "",
      localizations: localization.localizations
    });
    if (published.thumbnailError) {
      result.warnings.push(`Upload thumbnail gagal: ${published.thumbnailError}`);
      console.warn(`[Thumbnail] ${published.thumbnailError}`);
    } else if (published.customThumbnail) {
      console.log("[Thumbnail] Custom thumbnail YouTube berhasil dipasang.");
    }
    if (published.localizationError) {
      result.warnings.push(`Lokalisasi YouTube gagal: ${published.localizationError}`);
      console.warn(`[Localization] ${published.localizationError}`);
    }
    if (published.captionError) {
      result.warnings.push(`Upload subtitle gagal: ${published.captionError}`);
      console.warn(`[Caption] ${published.captionError}`);
    } else if (published.caption) {
      console.log("[Caption] Track subtitle terunggah; terjemahan otomatis YouTube aktif.");
    }

    reportProgress("publish", "Menambahkan ke playlist YouTube", 80, "playlist...");
    // Auto-playlist: masukkan video ke playlist berdasarkan kategori
    let playlistResult = { ok: false, skipped: true, error: "" };
    if (published.videoId) {
      try {
        const accessToken = await getYoutubeAccessToken();
        playlistResult = await addToPlaylistByCategory({
          videoId: published.videoId,
          category: item.input?.category || "",
          accessToken
        });
      } catch (error) {
        playlistResult = { ok: false, error: error.message };
        console.warn(`[Playlist] ${error.message}`);
      }
    }

    item.publish = {
      ...(item.publish || {}),
      youtube: {
        ...published,
        publishedAt: new Date().toISOString(),
        playlist: playlistResult.ok ? playlistResult.playlistId : null,
        playlistError: playlistResult.ok || playlistResult.skipped ? "" : playlistResult.error
      }
    };
    await saveItem(item);
    await mergeMemoryItems([item]);
    if (shouldUploadRemote) {
      reportProgress("upload", "Sinkronisasi state ke SFTP", 90, "sftp...");
      try {
        await uploadGeneratedStateAndAssets({ item });
      } catch (error) {
        console.warn(`Remote state setelah publish gagal: ${error.message}`);
      }
      reportProgress("upload", "Sinkronisasi state selesai", 100, "sukses");
    }
    console.log(`YouTube publish complete: ${published.url}`);
    reportProgress("publish", "Publish YouTube selesai", 100, "sukses");
  } catch (error) {
    const message = `YouTube publish gagal: ${error.message}`;
    result.warnings.push(message);
    console.warn(message);
    item.publish = { ...(item.publish || {}), errors: { ...(item.publish?.errors || {}), youtube: error.message } };
    await saveItem(item);
    throw error;
  }
}

async function dailyGenerationLimitReached() {
  if (!dailyGenerateLimit) return false;
  const [items, workflowCount] = await Promise.all([
    mergeKnownItems(),
    countSuccessfulWorkflowRunsToday()
  ]);
  const today = localDayKey(new Date());
  const stateCount = items.filter((entry) => {
    if (!entry?.assets?.video?.url && entry?.status !== "rendered" && !entry?.videoUrl) return false;
    const generatedAt = entry.createdAt || entry.updatedAt;
    return generatedAt && localDayKey(new Date(generatedAt)) === today;
  }).length;
  const count = Math.max(stateCount, workflowCount);
  if (count >= dailyGenerateLimit) {
    console.log(`Daily generate limit reached: ${count}/${dailyGenerateLimit} for ${today} (state=${stateCount}, workflow=${workflowCount}).`);
  }
  return count >= dailyGenerateLimit;
}

async function countSuccessfulWorkflowRunsToday() {
  const token = process.env.GITHUB_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const workflow = process.env.YT_WORKFLOW_FILE || config.automation.workflowFile;
  if (!token || !repo) return 0;
  try {
    const url = new URL(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("status", "success");
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "yt-longform-runner"
      },
      cache: "no-store"
    });
    if (!response.ok) return 0;
    const data = await response.json();
    const today = localDayKey(new Date());
    return (data.workflow_runs || []).filter((run) => (
      run.conclusion === "success"
      && ["schedule", "workflow_dispatch"].includes(run.event)
      && localDayKey(new Date(run.created_at)) === today
    )).length;
  } catch (error) {
    console.warn(`Hitung run GitHub harian gagal: ${error.message}`);
    return 0;
  }
}

async function youtubeDailyLimitReached() {
  const limit = Number(config.youtube.dailyUploadLimit || 0);
  if (!limit) return false;
  const items = await mergeKnownItems();
  const today = localDayKey(new Date());
  const count = items.filter((entry) => {
    const publishedAt = entry?.publish?.youtube?.publishedAt;
    return publishedAt && localDayKey(new Date(publishedAt)) === today;
  }).length;
  return count >= limit;
}

async function mergeKnownItems() {
  try {
    const localItems = await listContextItems();
    return Array.isArray(localItems) ? localItems : [];
  } catch {
    return [];
  }
}

function localDayKey(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  const timeZone = config.automation.timeZone;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function importRemoteState() {
  const base = publicBaseUrl();
  if (!base) return;
  try {
    const remoteItems = await fetchRemoteJson(`${base}/state/items.json?v=${Date.now()}`, []);
    const remoteMemory = await fetchRemoteJson(`${base}/state/memory.json?v=${Date.now()}`, { items: [] });
    for (const item of remoteItems) {
      if (item?.id) await saveItem(item);
    }
    await mergeMemoryItems([...remoteItems, ...normalizeMemoryPayload(remoteMemory)]);
  } catch (error) {
    console.warn(`Remote memory lama tidak bisa digabung: ${error.message}`);
  }
}

async function fetchRemoteJson(url, fallback) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return fallback;
  return response.json();
}

function normalizeMemoryPayload(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

function youtubeDescription(item) {
  const points = (item.plan?.importantPoints || [])
    .slice(0, 5)
    .map((point) => `• ${point}`)
    .join("\n");
  return [
    item.plan?.hook || item.title,
    cleanLine(item.plan?.summary),
    points ? `Yang dibahas:\n${points}` : "",
    "Video edukasi panjang tentang fakta menarik, sains, sejarah, dan teknologi.",
    "#Edukasi #Pengetahuan #FaktaMenarik"
  ].filter(Boolean).join("\n\n").slice(0, 4900);
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
