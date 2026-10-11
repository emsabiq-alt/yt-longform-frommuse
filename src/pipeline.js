import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { estimateTtsUsd } from "./cost.js";
import { generateElevenLabsSpeech } from "./elevenlabs.js";
import { generateGroqSpeech } from "./groq.js";
import { generatePiperSpeech } from "./piper-tts.js";
import { generateSupertonicSpeech } from "./supertonic-tts.js";
import { generateOpenAiSpeech, generateSceneGridImage, generateSceneImage, normalizeImageQuality, transcribeSpeechSegments } from "./openai.js";
import {
  fetchPexelsClipForScene,
  PEXELS_SELECTOR_VERSION,
  scoreSceneVisualConcreteness
} from "./pexels.js";
import {
  fetchWikimediaMediaForScene,
  WIKIMEDIA_SELECTOR_VERSION
} from "./wikimedia.js";
import { fetchPixabayMediaForScene } from "./pixabay.js";
import { findPersonImage } from "./wikidata.js";
import { ensureFigureImages } from "./person-image.js";
import { ensureNewsImages, extractSceneRealEntityQuery } from "./news-image.js";
import { isGoogleImageApiAvailable, searchGoogleImages, downloadImageWithCandidates, isGenericPlaceholderQuery } from "./google-image.js";
import { renderLongformVideo, prepareRenderLayout, measureNarrationFit } from "./longform-render.js";
import { generateThumbnail } from "./thumbnail.js";
import { saveItem, listContextItems } from "./storage.js";
import { createLongformDraft, enrichLongformDraft, buildLongformStoryboard, writeLongformStoryboard } from "./longform-story-engine.js";
import { MAX_ENRICHMENT_ATTEMPTS } from "./duration-control.js";
import { nowIso, normalizeTtsText, alignCaptionsToSource, isValidImageFileSync } from "./util.js";
import { reportProgress } from "./progress.js";

const LANDSCAPE_SIZE = "1536x1024";

/**
 * FROMMUSE: resolusi provider TTS. Nilai valid: "openai" | "elevenlabs" | "groq" | "piper" | "supertonic".
 * Selain itu dianggap "openai" (kompatibel ke belakang).
 */
function resolveTtsProvider(raw) {
  const p = String(raw || "openai").toLowerCase();
  if (p === "elevenlabs" || p === "groq" || p === "piper" || p === "supertonic") return p;
  return "openai";
}

function ttsVoiceFor(provider, overrideVoice) {
  if (overrideVoice) return overrideVoice;
  if (provider === "groq") return config.groq.ttsVoice;
  if (provider === "elevenlabs") return config.elevenlabs.voiceId;
  if (provider === "piper") return config.piper.voice;
  if (provider === "supertonic") return config.supertonic.voice;
  return config.openai.ttsVoice;
}

function ttsSpeedFor(provider) {
  if (provider === "groq") return config.groq.ttsSpeed;
  if (provider === "elevenlabs") return config.elevenlabs.speed;
  return config.openai.ttsSpeed;
}

// FROMMUSE: dispatcher TTS per provider (signature seragam).
async function generateTtsForProvider(ttsProvider, { itemId, text, voice, instructions, filenameSuffix }) {
  if (ttsProvider === "elevenlabs") {
    return generateElevenLabsSpeech({ itemId, text, voiceId: voice, filenameSuffix });
  }
  if (ttsProvider === "groq") {
    return generateGroqSpeech({ itemId, text, voice, filenameSuffix });
  }
  if (ttsProvider === "piper") {
    return generatePiperSpeech({ itemId, text, voice, filenameSuffix });
  }
  if (ttsProvider === "supertonic") {
    return generateSupertonicSpeech({ itemId, text, voice, filenameSuffix });
  }
  return generateOpenAiSpeech({ itemId, text, voice, instructions, filenameSuffix });
}

// FROMMUSE: urutan coba TTS — provider pilihan dulu, lalu provider lain
// yang API key-nya tersedia. Supertonic (suara film cinematic) dan Piper
// selalu tersedia (gratis, tanpa key, jalan lokal di CPU) dan fasih
// Bahasa Indonesia — jadi prioritas setelah provider pilihan.
// "Fallback ke yg bisa aja."
function ttsFallbackChain(requested) {
  const hasKey = {
    openai: Boolean(config.openai.apiKey),
    elevenlabs: Boolean(config.elevenlabs.apiKey),
    groq: Boolean(config.groq.apiKey),
    piper: true,
    supertonic: true
  };
  const seen = new Set();
  return [requested, "supertonic", "piper", "openai", "elevenlabs", "groq"].filter((p) => {
    if (seen.has(p) || !hasKey[p]) return false;
    seen.add(p);
    return true;
  });
}

/**
 * Pastikan aset visual dalam urutan yang benar: video relevan dicoba lebih
 * dahulu, lalu gambar hanya mengisi slot yang masih kosong.
 */
export async function ensureVisualAssets(item, options = {}) {
  const warnings = options.warnings || [];
  const pexelsRunner = options.pexelsRunner || ensurePexelsClips;
  const pixabayRunner = options.pixabayRunner || ensurePixabayMedia;
  const wikimediaRunner = options.wikimediaRunner || ensureWikimediaMedia;
  const realPhotoRunner = options.realPhotoRunner || ensureRealPhotosForScenes;
  const imageRunner = options.imageRunner || ensureImages;
  const pexelsOptions = options.pexelsOptions || {};
  const pixabayOptions = options.pixabayOptions || {};
  const wikimediaOptions = options.wikimediaOptions || {};
  const realPhotoOptions = options.realPhotoOptions || {};
  const imageOptions = options.imageOptions || {};

  // 1. ATURAN ENTITAS SPESIFIK: Cari foto asli via Serper.dev / Google Images untuk entitas/tempat/tokoh/peta
  // sebelum slot sisanya diisi klip video latar Pexels / Pixabay
  await realPhotoRunner(item, { ...realPhotoOptions, warnings }).catch((err) => {
    console.warn(`[RealPhoto] realPhotoRunner gagal: ${err.message}`);
  });

  // 2. Klip video B-roll Pexels / Pixabay (sebagai video utama atau video latar di belakang foto nyata)
  await pexelsRunner(item, { ...pexelsOptions, warnings });
  if (options.pixabayRunner || (!options.pexelsRunner && !options.wikimediaRunner)) {
    await pixabayRunner(item, { ...pixabayOptions, warnings });
  }
  await wikimediaRunner(item, { ...wikimediaOptions, warnings });

  // 3. Fallback jika masih ada slot kosong yang belum terisi foto nyata
  await realPhotoRunner(item, { ...realPhotoOptions, warnings }).catch((err) => {
    console.warn(`[RealPhoto] realPhotoRunner fallback gagal: ${err.message}`);
  });

  // Openverse dihapus — API tidak stabil (sering 502). Slot gambar ditangani
  // sepenuhnya oleh Wikimedia Commons + Google Images + OpenAI image generation.
  await imageRunner(item, {
    ...imageOptions,
    warnings,
    strict: options.strict ?? imageOptions.strict ?? true
  });

  // Foto tokoh untuk overlay Spotlight (type "figure") — download di latar.
  await ensureFigureImages(item).catch((err) => {
    console.warn(`[PersonImage] ensureFigureImages gagal: ${err.message}`);
  });

  // Foto berita (og:image dari artikel) untuk phone frame overlay.
  await ensureNewsImages(item).catch((err) => {
    console.warn(`[NewsImage] ensureNewsImages gagal: ${err.message}`);
  });
}

export async function generateFullItem(input = {}, options = {}) {
  const warnings = [];
  reportProgress("script", "Menyusun naskah AI", 10, "meminta storyboard");
  const existingItems = await listContextItems();
  const item = await createLongformDraft({
    topic: input.topic || "",
    category: input.category || "random",
    durationSec: input.durationSec || config.automation.durationSec,
    sceneCount: input.sceneCount || config.automation.sceneCount,
    ttsProvider: input.ttsProvider || "openai",
    imageQuality: input.imageQuality || config.openai.imageQuality,
    resolution: input.resolution || "1080p",
    angle: input.angle,
    formatType: input.formatType,
    viralAngleId: input.viralAngleId,
    viralAngleLabel: input.viralAngleLabel,
    trend: input.trend || null,
    dynamicScenes: input.dynamicScenes || false
  }, { existingItems });
  await saveItem(item);
  reportProgress("script", "Naskah siap", 100, item.title || "");

  await ensureLongformSceneAudio(item, {
    provider: item.input.ttsProvider,
    voice: options.voice || input.ttsVoice,
    instructions: config.openai.ttsInstructions,
    warnings,
    strict: true,
    reuseExisting: true
  });
  if (config.automation.coldOpenEnabled) {
    await ensureHookAudio(item, {
      provider: item.input.ttsProvider,
      voice: options.voice || input.ttsVoice,
      warnings
    });
  }
  const layout = await prepareRenderLayout(item);
  if (item.input.durationLocked) {
    for (let attempt = 0; ; attempt++) {
      const fit = await measureNarrationFit(item, layout);
      if (fit.status === "ready") {
        item.assets.durationControl = { ...fit, sceneCount: item.plan.scenes.length };
        item.plan.scenes.forEach((scene, index) => { scene.durationSec = fit.durations[index]; });
        item.plan.longformStoryboard = buildLongformStoryboard(item.plan);
        item.assets.storyboard = await writeLongformStoryboard(item);
        console.log(`[Duration] Target ${item.input.durationSec}s, ${item.plan.scenes.length} scene, koreksi tempo ${fit.tempo.toFixed(4)}x.`);
        break;
      }
      if (attempt >= MAX_ENRICHMENT_ATTEMPTS) {
        throw new Error(`Durasi belum terpenuhi setelah ${MAX_ENRICHMENT_ATTEMPTS} tahap pengayaan. Storyboard tetap utuh; render dihentikan.`);
      }
      reportProgress("script", "Memperkaya storyboard sesuai durasi audio", 70, `tambahan sekitar ${Math.round(fit.missingSec)} detik`);
      await enrichLongformDraft(item, fit);
      await ensureLongformSceneAudio(item, {
        provider: item.input.ttsProvider, voice: options.voice || input.ttsVoice,
        instructions: config.openai.ttsInstructions, warnings, strict: true, reuseExisting: true
      });
    }
    await saveItem(item);
  }
  // Finalize the enriched scene order before generating mockups, spotlight portraits and B-roll.
  await ensureVisualAssets(item, { warnings, strict: true });
  if (config.thumbnail?.enabled) {
    reportProgress("thumbnail", "Membuat thumbnail", 20, "");
    await ensureThumbnail(item, { warnings });
    reportProgress("thumbnail", "Thumbnail siap", 100, "");
  } else {
    console.log("[Thumbnail] THUMBNAIL_GENERATION_ENABLED=false, skip generate thumbnail.");
    reportProgress("thumbnail", "Thumbnail dilewati", 100, "manual mode");
  }
  reportProgress("render", "Merender video (FFmpeg)", 5, "menyusun segmen");
  await renderAndPersist(item, { layout });
  reportProgress("render", "Render selesai", 100, "");
  return { item, warnings };
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function cleanIntentText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function segmentSlot(sceneIndex, segmentIndex) {
  return `${Number(sceneIndex)}:${Number(segmentIndex || 0)}`;
}

function sceneSegments(scene) {
  if (Array.isArray(scene?.visualSegments) && scene.visualSegments.length) {
    return scene.visualSegments;
  }
  return [scene || {}];
}

function buildSegmentScene(scene, segment, segmentIndex) {
  const segScene = {
    ...scene,
    visualKeywords: cleanIntentText(segment?.visualKeywords || scene?.visualKeywords),
    mustMatchTerms: Array.isArray(segment?.mustMatchTerms)
      ? segment.mustMatchTerms
      : Array.isArray(scene?.mustMatchTerms)
        ? scene.mustMatchTerms
        : [],
    narrativeContext: cleanIntentText(segment?.narrativeContext || scene?.narrativeContext),
    segmentIndex
  };

  if (own(segment, "pexelsQuery")) segScene.pexelsQuery = cleanIntentText(segment.pexelsQuery);
  else if (own(scene, "pexelsQuery")) segScene.pexelsQuery = cleanIntentText(scene.pexelsQuery);
  else delete segScene.pexelsQuery;

  return segScene;
}

function flattenPexelsSegments(item) {
  const topicFallback = cleanIntentText(item?.input?.topic);
  const slots = [];
  let flatIndex = 0;

  for (const scene of item?.plan?.scenes || []) {
    if (scene?.sceneType === "reaction") continue;
    const segments = sceneSegments(scene);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex] || {};
      const segScene = buildSegmentScene(scene, segment, segmentIndex);
      const explicitIntent = own(segScene, "pexelsQuery");
      const query = explicitIntent
        ? cleanIntentText(segScene.pexelsQuery)
        : cleanIntentText(segScene.visualKeywords || topicFallback);
      const selectionText = [
        query,
        ...(Array.isArray(segScene.mustMatchTerms) ? segScene.mustMatchTerms : []),
        segScene.visualKeywords
      ].filter(Boolean).join(", ");

      slots.push({
        scene,
        segment,
        segScene,
        sceneIndex: scene.index,
        segmentIndex,
        flatIndex,
        slot: segmentSlot(scene.index, segmentIndex),
        explicitIntent,
        explicitImageFallback: explicitIntent && !query,
        hasSearchIntent: Boolean(query),
        query,
        selectionScore: scoreSceneVisualConcreteness({ visualKeywords: selectionText })
      });
      flatIndex += 1;
    }
  }
  return slots;
}

/**
 * Rencanakan slot Pexels per segmen. Kuota adalah batas maksimum, bukan target
 * yang dipaksakan: intent kosong tetap menjadi slot gambar.
 */
export function buildPexelsClipJobs(item, options = {}) {
  const seenSlots = new Set();
  const slots = flattenPexelsSegments(item).filter((slot) => {
    if (seenSlots.has(slot.slot)) return false;
    seenSlots.add(slot.slot);
    return true;
  });
  // Satu segmen tetap mendapat satu kesempatan. Untuk lebih dari satu segmen,
  // kuota mengikuti rasio klip (default 70% agar video mendominasi visual;
  // atur via PEXELS_CLIP_RATIO). Dibulatkan ke bawah agar rasio tidak terlampaui.
  const clipRatio = Math.max(0, Math.min(1, Number(options.clipRatio ?? config.pexels.clipRatio ?? 0.7)));
  const quota = slots.length === 1 ? 1 : Math.max(1, Math.floor(slots.length * clipRatio));
  const eligible = slots.filter((slot) => (
    slot.hasSearchIntent
    && !slot.explicitImageFallback
    // Intent terstruktur sudah divalidasi story engine. Fallback legacy hanya
    // layak dicari bila punya subjek visual konkret, bukan sekadar konsep.
    && (slot.explicitIntent || slot.selectionScore > 0)
  ));
  const semanticSelection = options.semanticSelection ?? true;

  let chosen;
  if (semanticSelection) {
    chosen = new Set(
      [...eligible]
        .sort((a, b) => (b.selectionScore - a.selectionScore) || (a.flatIndex - b.flatIndex))
        .slice(0, quota)
        .map((slot) => slot.slot)
    );
  } else {
    chosen = new Set(
      eligible
        .filter((slot) => slot.flatIndex % 2 === 0)
        .slice(0, quota)
        .map((slot) => slot.slot)
    );
  }

  return slots.filter((slot) => chosen.has(slot.slot));
}

/**
 * Hash intent stabil untuk memastikan klip lama hanya dipakai pada intent
 * storyboard yang sama.
 */
export function pexelsIntentHash(scene = {}) {
  const intent = {
    pexelsQuery: own(scene, "pexelsQuery")
      ? cleanIntentText(scene.pexelsQuery).toLowerCase()
      : null,
    mustMatchTerms: [...new Set(
      (Array.isArray(scene.mustMatchTerms) ? scene.mustMatchTerms : [])
        .map((term) => cleanIntentText(term).toLowerCase())
        .filter(Boolean)
    )].sort(),
    visualKeywords: cleanIntentText(scene.visualKeywords).toLowerCase()
  };
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

export function isReusablePexelsClip(clip, scene) {
  return Boolean(
    clip?.path
    && isPexelsClip(clip)
    && validPexelsId(clip.pexelsId)
    && clip?.selectorVersion === PEXELS_SELECTOR_VERSION
    && clip?.intentHash === pexelsIntentHash(scene)
  );
}

function isPexelsClip(clip) {
  return clip?.provider === "pexels" || clip?.pexelsId !== undefined;
}

function validPexelsId(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function pexelsIdKey(value) {
  return validPexelsId(value) ? String(value).trim() : null;
}

async function pathExists(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return false;
  try {
    const mediaStat = await fs.stat(filePath);
    return mediaStat.isFile() && mediaStat.size > 0;
  } catch {
    return false;
  }
}

function createMediaExists(fileExists = pathExists) {
  const cache = new Map();
  return async (filePath, { refresh = false } = {}) => {
    if (typeof filePath !== "string" || !filePath.trim()) return false;
    if (refresh) cache.delete(filePath);
    if (!cache.has(filePath)) {
      cache.set(filePath, Promise.resolve()
        .then(() => fileExists(filePath))
        .then(Boolean)
        .catch(() => false));
    }
    return cache.get(filePath);
  };
}

function upsertPexelsAudit(audits, entry) {
  const slot = segmentSlot(entry.sceneIndex, entry.segmentIndex);
  const next = (Array.isArray(audits) ? audits : [])
    .filter((audit) => segmentSlot(audit.sceneIndex, audit.segmentIndex) !== slot);
  next.push(entry);
  return sortByScene(next);
}

/**
 * Cari dan download klip Pexels per segmen. Segmen yang tidak lolos kuota,
 * sengaja ber-intent kosong, atau tak punya kandidat relevan dibiarkan tanpa
 * metadata klip agar ensureImages membuat fallback gambar.
 */
export async function ensurePexelsClips(item, options = {}) {
  const warnings = options.warnings || [];
  const fetchClip = options.fetchClip || fetchPexelsClipForScene;
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const delayMs = Math.max(0, Number(options.delayMs ?? 200) || 0);
  const semanticSelection = options.semanticSelection ?? config.pexels.semanticSelection;
  const pexelsEnabled = Boolean(config.pexels.apiKey && config.pexels.preferVideo);
  item.assets = item.assets || {};
  const allSlots = flattenPexelsSegments(item);
  const jobs = buildPexelsClipJobs(item, { semanticSelection });
  const jobSlots = new Set(jobs.map((job) => job.slot));
  const managedSlots = new Set(allSlots.map((slot) => slot.slot));
  const existingClips = [...(item.assets?.clips || [])];
  const existingImages = [...(item.assets?.images || [])];
  const pexelsBySlot = new Map();
  const blockingMediaBySlot = new Map();

  for (const clip of existingClips) {
    if (!isPexelsClip(clip)) continue;
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!pexelsBySlot.has(slot)) pexelsBySlot.set(slot, []);
    pexelsBySlot.get(slot).push(clip);
  }

  // Gambar valid yang sudah ada menang atas Pexels. Metadata stale hanya
  // dipangkas pada slot storyboard aktif; metadata di luar rencana dipertahankan.
  const images = [];
  for (const image of existingImages) {
    const slot = segmentSlot(image.sceneIndex, image.segmentIndex);
    if (!managedSlots.has(slot)) {
      images.push(image);
      continue;
    }
    if (!await mediaExists(image.path)) continue;
    images.push(image);
    // Foto entitas riil (isRealEntity / provider google-images) TIDAK boleh memblokir Pexels!
    // Klip Pexels tetap diunduh untuk dijadikan video latar (backdrop B-roll) di belakang foto entitas.
    if (!image.isRealEntity && image.provider !== "google-images") {
      blockingMediaBySlot.set(slot, "existing-image");
    }
  }

  // Klip manual/non-Pexels yang file-nya masih valid juga menang. Pengecekan
  // file mencegah metadata path yang sudah hilang memblokir regenerasi.
  const retainedNonPexelsClips = [];
  for (const clip of existingClips) {
    if (isPexelsClip(clip)) continue;
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!managedSlots.has(slot)) {
      retainedNonPexelsClips.push(clip);
      continue;
    }
    if (!await mediaExists(clip.path)) continue;
    retainedNonPexelsClips.push(clip);
    if (!blockingMediaBySlot.has(slot)) {
      blockingMediaBySlot.set(slot, "existing-media");
    }
  }

  // Pertahankan klip non-Pexels valid dan klip Pexels di luar storyboard aktif.
  // Semua slot aktif dibangun ulang dari kandidat reusable yang tervalidasi.
  const clips = [
    ...retainedNonPexelsClips,
    ...existingClips.filter((clip) => (
      isPexelsClip(clip)
      && !managedSlots.has(segmentSlot(clip.sceneIndex, clip.segmentIndex))
    ))
  ];
  const usedPexelsIds = new Set();
  const pendingJobs = [];
  let audits = [];

  // ID Pexels di luar storyboard terkelola tetap direservasi secara
  // konservatif, bahkan bila file lamanya tidak ada, agar video yang sama
  // tidak dipilih lagi untuk slot baru.
  for (const clip of clips) {
    if (!isPexelsClip(clip)) continue;
    const id = pexelsIdKey(clip.pexelsId);
    if (id !== null) usedPexelsIds.add(id);
  }

  for (const slot of allSlots) {
    if (jobSlots.has(slot.slot)) continue;
    const blockingReason = blockingMediaBySlot.get(slot.slot);
    audits = upsertPexelsAudit(audits, {
      sceneIndex: slot.sceneIndex,
      segmentIndex: slot.segmentIndex,
      status: "image-fallback",
      intentHash: pexelsIntentHash(slot.segScene),
      query: slot.query,
      fallbackReason: blockingReason || (slot.explicitImageFallback
        ? "explicit-image-fallback"
        : slot.hasSearchIntent
          ? "video-quota"
          : "no-search-intent")
    });
  }

  for (const job of jobs) {
    const blockingReason = blockingMediaBySlot.get(job.slot);
    if (blockingReason) {
      audits = upsertPexelsAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "image-fallback",
        intentHash: pexelsIntentHash(job.segScene),
        query: job.query,
        fallbackReason: blockingReason
      });
      continue;
    }

    let reusable = null;
    for (const clip of pexelsBySlot.get(job.slot) || []) {
      if (!isReusablePexelsClip(clip, job.segScene)) continue;
      const id = pexelsIdKey(clip.pexelsId);
      if (id === null || usedPexelsIds.has(id)) continue;
      if (!await mediaExists(clip.path)) continue;
      reusable = clip;
      break;
    }
    if (!reusable) {
      pendingJobs.push(job);
      continue;
    }

    clips.push(reusable);
    usedPexelsIds.add(String(reusable.pexelsId));
    audits = upsertPexelsAudit(audits, {
      sceneIndex: job.sceneIndex,
      segmentIndex: job.segmentIndex,
      status: "selected",
      intentHash: pexelsIntentHash(job.segScene),
      query: reusable.query || job.query,
      source: "reused"
    });
  }

  const fetchJobs = pendingJobs;

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  item.assets.pexelsAudit = audits;

  if (!pexelsEnabled) {
    for (const job of fetchJobs) {
      audits = upsertPexelsAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "image-fallback",
        intentHash: pexelsIntentHash(job.segScene),
        query: job.query,
        fallbackReason: "pexels-disabled"
      });
    }
    item.assets.pexelsAudit = audits;
    item.updatedAt = nowIso();
    await persistItem(item);
    console.log("[Pexels] Dimatikan atau API key tidak tersedia; slot tanpa klip valid memakai gambar.");
    return;
  }

  let clipDone = 0;
  const totalJobs = fetchJobs.length;
  reportProgress("images", "Mencari video B-roll Pexels", 0, `0/${totalJobs}`);
  console.log(`[Pexels] ${jobs.length}/${allSlots.length} segmen masuk kuota; ${totalJobs} perlu dicari.`);

  for (const job of fetchJobs) {
    const intentHash = pexelsIntentHash(job.segScene);
    let fetchAudit = null;
    try {
      reportProgress(
        "images",
        "Mencari video B-roll Pexels",
        totalJobs ? Math.round((clipDone / totalJobs) * 100) : 100,
        `scene ${job.sceneIndex} seg ${job.segmentIndex + 1}`
      );
      const clip = await fetchClip({
        itemId: item.id,
        scene: job.segScene,
        topicFallback: item.input?.topic || "",
        usedPexelsIds,
        onAudit: (audit) => {
          fetchAudit = audit;
        }
      });
      clipDone += 1;

      const fetchedId = pexelsIdKey(clip?.pexelsId);
      const validClip = Boolean(clip && cleanIntentText(clip.path) && fetchedId !== null);
      const duplicateId = validClip && usedPexelsIds.has(fetchedId);
      const fetchedFileExists = validClip && !duplicateId
        // Download dapat mengisi ulang path yang tadi tercatat stale, jadi
        // validasi hasil fetch harus membaca keadaan file terbaru.
        ? await mediaExists(clip.path, { refresh: true })
        : false;
      if (validClip && !duplicateId && fetchedFileExists) {
        const selected = {
          ...clip,
          provider: "pexels",
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          selectorVersion: PEXELS_SELECTOR_VERSION,
          intentHash
        };
        clips.push(selected);
        usedPexelsIds.add(fetchedId);
        audits = upsertPexelsAudit(audits, {
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          status: "selected",
          intentHash,
          query: selected.query || job.query,
          source: "fetched"
        });
      } else {
        let fallbackReason = fetchAudit?.fallbackReason || "no-relevant-candidate";
        if (duplicateId) fallbackReason = "duplicate-pexels-id";
        else if (!validClip && clip) fallbackReason = "invalid-clip";
        else if (validClip) fallbackReason = "missing-fetched-file";
        audits = upsertPexelsAudit(audits, {
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          status: "image-fallback",
          intentHash,
          query: fetchAudit?.query || job.query,
          fallbackReason
        });
      }
    } catch (error) {
      clipDone += 1;
      const message = `Pexels scene ${job.sceneIndex} seg ${job.segmentIndex} gagal: ${error.message}`;
      warnings.push(message);
      console.warn(message);
      audits = upsertPexelsAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "image-fallback",
        intentHash,
        query: job.query,
        fallbackReason: "fetch-error"
      });
    }

    item.assets.clips = sortByScene(clips);
    item.assets.pexelsAudit = audits;
    item.updatedAt = nowIso();
    await persistItem(item);
    reportProgress(
      "images",
      "Mencari video B-roll Pexels",
      totalJobs ? Math.round((clipDone / totalJobs) * 100) : 100,
      `${clipDone}/${totalJobs}`
    );
    if (delayMs > 0 && clipDone < totalJobs) await sleep(delayMs);
  }

  item.assets.clips = sortByScene(clips);
  item.assets.pexelsAudit = audits;
  item.updatedAt = nowIso();
  await persistItem(item);

  const totalClips = clips.filter((clip) => isPexelsClip(clip) && clip.path).length;
  const mode = semanticSelection ? "seleksi semantik" : "pola alternating";
  console.log(`[Pexels] Total klip valid: ${totalClips}; mode ${mode}, seleksi per segmen.`);
}

function isWikimediaMedia(asset) {
  return asset?.provider === "wikimedia" || asset?.wikimediaPageId !== undefined;
}

function wikimediaPageIdKey(value) {
  return value !== undefined && value !== null && String(value).trim()
    ? String(value).trim()
    : null;
}

function upsertWikimediaAudit(audits, entry) {
  const slot = segmentSlot(entry.sceneIndex, entry.segmentIndex);
  const next = (Array.isArray(audits) ? audits : [])
    .filter((audit) => segmentSlot(audit.sceneIndex, audit.segmentIndex) !== slot);
  next.push(entry);
  return sortByScene(next);
}

/**
 * Isi slot yang masih kosong menggunakan Wikimedia Commons sebelum meminta
 * gambar berbayar ke OpenAI. Hanya media berlisensi aman yang dapat lolos dari
 * src/wikimedia.js; metadata atribusi disimpan bersama aset.
 */
export async function ensureWikimediaMedia(item, options = {}) {
  const warnings = options.warnings || [];
  const fetchMedia = options.fetchMedia || fetchWikimediaMediaForScene;
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const delayMs = Math.max(0, Number(
    options.delayMs ?? config.wikimedia.requestDelayMs
  ) || 0);
  const maxAssets = Math.max(0, Math.floor(Number(
    options.maxAssets ?? config.wikimedia.maxAssetsPerVideo
  ) || 0));

  item.assets = item.assets || {};
  const slots = flattenPexelsSegments(item);
  const managedSlots = new Set(slots.map((slot) => slot.slot));
  const images = [];
  const clips = [];
  const occupiedSlots = new Set();
  let prunedStaleMedia = false;

  for (const image of item.assets.images || []) {
    const slot = segmentSlot(image.sceneIndex, image.segmentIndex);
    if (!managedSlots.has(slot)) {
      images.push(image);
      continue;
    }
    if (await mediaExists(image.path)) {
      images.push(image);
      occupiedSlots.add(slot);
    } else {
      prunedStaleMedia = true;
    }
  }
  for (const clip of item.assets.clips || []) {
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!managedSlots.has(slot)) {
      clips.push(clip);
      continue;
    }
    if (await mediaExists(clip.path)) {
      clips.push(clip);
      occupiedSlots.add(slot);
    } else {
      prunedStaleMedia = true;
    }
  }

  let audits = Array.isArray(item.assets.wikimediaAudit)
    ? item.assets.wikimediaAudit.filter((audit) => managedSlots.has(
      segmentSlot(audit.sceneIndex, audit.segmentIndex)
    ))
    : [];
  const retainedMedia = [...images, ...clips];
  const usedPageIds = new Set(
    retainedMedia
      .filter(isWikimediaMedia)
      .map((asset) => wikimediaPageIdKey(asset.wikimediaPageId))
      .filter(Boolean)
  );
  const existingWikimediaCount = retainedMedia.filter((asset) => (
    isWikimediaMedia(asset) && managedSlots.has(
      segmentSlot(asset.sceneIndex, asset.segmentIndex)
    )
  )).length;

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  item.assets.wikimediaAudit = audits;
  if (prunedStaleMedia) {
    item.updatedAt = nowIso();
    await persistItem(item);
  }

  if (!config.wikimedia.enabled || maxAssets === 0) {
    console.log("[Wikimedia] Dinonaktifkan; slot kosong dilanjutkan ke gambar OpenAI.");
    return;
  }

  const remainingQuota = Math.max(0, maxAssets - existingWikimediaCount);
  const jobs = slots
    .filter((slot) => (
      !occupiedSlots.has(slot.slot)
      && slot.hasSearchIntent
      && !slot.explicitImageFallback
    ))
    .sort((a, b) => (
      (b.selectionScore - a.selectionScore)
      || (a.flatIndex - b.flatIndex)
    ))
    .slice(0, remainingQuota);

  if (!jobs.length) {
    console.log("[Wikimedia] Tidak ada slot relevan yang perlu dicari.");
    return;
  }

  let done = 0;
  reportProgress("images", "Mencari media Wikimedia Commons", 0, `0/${jobs.length}`);
  console.log(`[Wikimedia] Mencari maksimal ${jobs.length} media berlisensi aman.`);

  for (const job of jobs) {
    const intentHash = pexelsIntentHash(job.segScene);
    try {
      reportProgress(
        "images",
        "Mencari media Wikimedia Commons",
        Math.round((done / jobs.length) * 100),
        `scene ${job.sceneIndex} seg ${job.segmentIndex + 1}`
      );
      const media = await fetchMedia({
        itemId: item.id,
        scene: job.segScene,
        topicFallback: item.input?.topic || "",
        usedPageIds
      });
      done += 1;

      const pageId = wikimediaPageIdKey(media?.wikimediaPageId);
      const validMetadata = Boolean(
        media
        && cleanIntentText(media.path)
        && ["image", "video"].includes(media.mediaType)
        && pageId
      );
      const duplicatePage = validMetadata && usedPageIds.has(pageId);
      const downloadedFileExists = validMetadata && !duplicatePage
        ? await mediaExists(media.path, { refresh: true })
        : false;

      if (validMetadata && !duplicatePage && downloadedFileExists) {
        const selected = {
          ...media,
          provider: "wikimedia",
          selectorVersion: WIKIMEDIA_SELECTOR_VERSION,
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          intentHash
        };
        if (selected.mediaType === "video") clips.push(selected);
        else images.push(selected);
        occupiedSlots.add(job.slot);
        usedPageIds.add(pageId);
        audits = upsertWikimediaAudit(audits, {
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          status: "selected",
          intentHash,
          query: selected.query || job.query,
          mediaType: selected.mediaType,
          wikimediaPageId: selected.wikimediaPageId
        });
      } else {
        let fallbackReason = media ? "invalid-media" : "no-relevant-candidate";
        if (duplicatePage) fallbackReason = "duplicate-wikimedia-page";
        else if (validMetadata) fallbackReason = "missing-fetched-file";
        audits = upsertWikimediaAudit(audits, {
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          status: "openai-fallback",
          intentHash,
          query: media?.query || job.query,
          fallbackReason
        });
      }
    } catch (error) {
      done += 1;
      const message = `Wikimedia scene ${job.sceneIndex} seg ${job.segmentIndex} gagal: ${error.message}`;
      warnings.push(message);
      console.warn(`[Wikimedia] ${message}`);
      audits = upsertWikimediaAudit(audits, {
        sceneIndex: job.sceneIndex,
        segmentIndex: job.segmentIndex,
        status: "openai-fallback",
        intentHash,
        query: job.query,
        fallbackReason: "fetch-error"
      });
    }

    item.assets.images = sortByScene(images);
    item.assets.clips = sortByScene(clips);
    item.assets.wikimediaAudit = audits;
    item.updatedAt = nowIso();
    await persistItem(item);
    reportProgress(
      "images",
      "Mencari media Wikimedia Commons",
      Math.round((done / jobs.length) * 100),
      `${done}/${jobs.length}`
    );
    if (delayMs > 0 && done < jobs.length) await sleep(delayMs);
  }

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  item.assets.wikimediaAudit = audits;
  item.updatedAt = nowIso();
  await persistItem(item);
  const selectedCount = [...images, ...clips].filter((asset) => (
    isWikimediaMedia(asset) && managedSlots.has(
      segmentSlot(asset.sceneIndex, asset.segmentIndex)
    )
  )).length;
  console.log(`[Wikimedia] Total media Commons valid: ${selectedCount}/${maxAssets}.`);
}

function isPixabayMedia(asset) {
  return asset?.provider === "pixabay" || asset?.pixabayId !== undefined;
}

/**
 * Isi slot video/gambar yang belum terisi Pexels menggunakan Pixabay API gratis.
 * Mendukung video MP4 (landscape 1080p/720p) dan foto horizontal resolusi tinggi.
 */
export async function ensurePixabayMedia(item, options = {}) {
  const warnings = options.warnings || [];
  const fetchMedia = options.fetchMedia || fetchPixabayMediaForScene;
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  const maxAssets = Math.max(0, Math.floor(Number(
    options.maxAssets ?? config.pixabay?.maxAssetsPerVideo
  ) || 10));

  if (!config.pixabay?.enabled || !config.pixabay?.apiKey || maxAssets === 0) {
    return;
  }

  item.assets = item.assets || {};
  const slots = flattenPexelsSegments(item);
  const managedSlots = new Set(slots.map((slot) => slot.slot));
  const images = [];
  const clips = [];
  const occupiedSlots = new Set();
  let prunedStaleMedia = false;

  for (const image of item.assets.images || []) {
    const slot = segmentSlot(image.sceneIndex, image.segmentIndex);
    if (!managedSlots.has(slot)) {
      images.push(image);
      continue;
    }
    if (await mediaExists(image.path)) {
      images.push(image);
      occupiedSlots.add(slot);
    } else {
      prunedStaleMedia = true;
    }
  }

  for (const clip of item.assets.clips || []) {
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!managedSlots.has(slot)) {
      clips.push(clip);
      continue;
    }
    if (await mediaExists(clip.path)) {
      clips.push(clip);
      occupiedSlots.add(slot);
    } else {
      prunedStaleMedia = true;
    }
  }

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  if (prunedStaleMedia) {
    item.updatedAt = nowIso();
    await persistItem(item);
  }

  const existingPixabayCount = [...images, ...clips].filter((asset) => (
    isPixabayMedia(asset) && managedSlots.has(segmentSlot(asset.sceneIndex, asset.segmentIndex))
  )).length;

  const remainingQuota = Math.max(0, maxAssets - existingPixabayCount);
  if (remainingQuota === 0) return;

  const jobs = slots
    .filter((slot) => (
      !occupiedSlots.has(slot.slot)
      && slot.hasSearchIntent
      && !slot.explicitImageFallback
    ))
    .slice(0, remainingQuota);

  if (!jobs.length) return;

  console.log(`[Pixabay] Mencari media untuk ${jobs.length} slot kosong.`);
  let addedCount = 0;

  for (const job of jobs) {
    try {
      const media = await fetchMedia({
        itemId: item.id,
        scene: job.segScene,
        topicFallback: item.input?.topic || "",
        preferVideo: config.pixabay?.preferVideo ?? true
      });

      if (media && media.path && await mediaExists(media.path, { refresh: true })) {
        const isVideo = String(media.path).endsWith(".mp4") || Number(media.duration || 0) > 0;
        if (isVideo) {
          clips.push(media);
        } else {
          images.push(media);
        }
        occupiedSlots.add(job.slot);
        addedCount++;
      }
    } catch (err) {
      console.warn(`[Pixabay] Error slot ${job.slot}: ${err.message}`);
    }
  }

  item.assets.clips = sortByScene(clips);
  item.assets.images = sortByScene(images);
  if (addedCount > 0) {
    item.updatedAt = nowIso();
    await persistItem(item);
    console.log(`[Pixabay] Berhasil menambahkan ${addedCount} aset media ke video.`);
  }
}

/**
 * Lapisan terakhir sebelum gambar berbayar: Openverse (ratusan juta gambar CC
 * dari Flickr, museum, NASA, Smithsonian) dengan foto tokoh Wikidata P18 lebih
 * dulu bila scene menyebut nama orang.
 *
 * Slot yang sudah terisi Pexels/Commons tidak disentuh; ini murni pengisi
 * kekosongan. Gagal apa pun → slot dibiarkan kosong dan ensureImages yang
 * menanganinya, jadi tidak ada jalur yang bisa membuat render batal.
 */
export async function ensureOpenverseImages(item, options = {}) {
  const warnings = options.warnings || [];
  const fetchImage = options.fetchImage || (() => Promise.resolve(null));
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  const delayMs = Math.max(0, Number(options.delayMs ?? config.openverse.requestDelayMs) || 0);
  const maxAssets = Math.max(0, Math.floor(Number(
    options.maxAssets ?? config.openverse.maxAssetsPerVideo
  ) || 0));

  item.assets = item.assets || {};
  const slots = flattenPexelsSegments(item);
  const managedSlots = new Set(slots.map((slot) => slot.slot));
  const images = [...(item.assets.images || [])];
  const occupiedSlots = new Set();
  for (const asset of [...images, ...(item.assets.clips || [])]) {
    const slot = segmentSlot(asset.sceneIndex, asset.segmentIndex);
    if (managedSlots.has(slot) && await mediaExists(asset.path)) occupiedSlots.add(slot);
  }

  if (!config.openverse.enabled || maxAssets === 0) return;

  const usedPageIds = new Set(
    images.map((asset) => asset.openversePageId).filter(Boolean).map(String)
  );
  const jobs = slots
    .filter((slot) => (
      !occupiedSlots.has(slot.slot)
      && slot.hasSearchIntent
      && !slot.explicitImageFallback
    ))
    .sort((a, b) => (b.selectionScore - a.selectionScore) || (a.flatIndex - b.flatIndex))
    .slice(0, maxAssets);

  if (!jobs.length) {
    console.log("[Openverse] Tidak ada slot kosong yang perlu diisi.");
    return;
  }

  let done = 0;
  console.log(`[Openverse] Mencari maksimal ${jobs.length} gambar berlisensi terbuka.`);
  for (const job of jobs) {
    try {
      const media = await fetchImage({
        itemId: item.id,
        scene: job.segScene,
        topicFallback: item.input?.topic || "",
        usedPageIds: [...usedPageIds],
        personImage: config.openverse.personLookup ? findPersonImage : null
      });
      const pageId = media?.openversePageId ? String(media.openversePageId) : "";
      if (media?.path && pageId && !usedPageIds.has(pageId)
        && await mediaExists(media.path, { refresh: true })) {
        images.push({
          ...media,
          sceneIndex: job.sceneIndex,
          segmentIndex: job.segmentIndex,
          intentHash: pexelsIntentHash(job.segScene)
        });
        usedPageIds.add(pageId);
        done += 1;
        item.assets.images = sortByScene(images);
        item.updatedAt = nowIso();
        await persistItem(item);
      }
    } catch (error) {
      const message = `Openverse scene ${job.sceneIndex} seg ${job.segmentIndex} gagal: ${error.message}`;
      warnings.push(message);
      console.warn(`[Openverse] ${message}`);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  item.assets.images = sortByScene(images);
  item.updatedAt = nowIso();
  await persistItem(item);
  console.log(`[Openverse] Total gambar terisi: ${done}/${jobs.length}.`);
}

/**
 * Perkaya query entitas spesifik yang berulang (seperti nama lokasi utama "Selat Sunda")
 * dengan instrumen teknis, aspek geologi, atau topik fokus dari scene tersebut.
 */
function enrichEntityQueryForScene(baseQuery, scene) {
  if (!scene) return baseQuery;
  const narration = String(scene.narration || "");
  const spotlight = String(scene.spotlight?.label || "");
  const keywords = Array.isArray(scene.visualKeywords)
    ? scene.visualKeywords.join(" ")
    : String(scene.visualKeywords || "");

  // 1. Cek instrumen teknis, sensor, alat ukur, artefak, atau blueprint spesifik
  const technicalMatch = narration.match(
    /\b(seismometer|seismograf|sensor\s+buoy|pelampung\s+tsunami|radar\s+satelit|sonar|teleskop|mikroskop|spektrometer|osiloskop|black\s+box|kokpit|mesin\s+jet|turbin|reaktor|laboratorium|cleanroom|microchip|transistor|motherboard|server|kabel\s+bawah\s+laut|manuskrip|prasasti|artefak|fosil|litografi|arsip\s+sejarah|dokumen\s+paten|peta\s+batimetri|peta\s+navigasi|blueprint|diagram\s+irisan|penampang|simulasi\s+komputer|patahan|sesar\s+aktif|zona\s+subduksi|dapur\s+magma|lapisan\s+tephra|abu\s+vulkanik|kapal\s+riset|stasiun\s+geofisika|sirene\s+evakuasi|uji\s+klinis|ct\s+scan|mri)\b/i
  ) || spotlight.match(
    /\b(seismometer|seismograf|sensor|radar|satelit|sonar|teleskop|mikroskop|mesin|turbin|reaktor|chip|transistor|server|manuskrip|artefak|fosil|dokumen|peta|blueprint|diagram|irisan|penampang|simulasi|patahan|subduksi|magma|tsunami)\b/i
  );

  if (technicalMatch) {
    const term = technicalMatch[1].trim();
    return `${term} ${baseQuery}`.trim();
  }

  // 2. Cek visualKeywords pembeda konkret (bukan istilah komposisi kamera)
  const cleanKw = keywords
    .replace(/\b(horizontal|cinematic|photo|picture|scene|documentary|wide|angle|shot|4k|hd|render)\b/gi, "")
    .trim();
  if (cleanKw && cleanKw.length >= 4 && !cleanKw.toLowerCase().includes(baseQuery.toLowerCase())) {
    const firstWord = cleanKw.split(/[\s,]+/)[0];
    if (firstWord && firstWord.length >= 3) {
      return `${firstWord} ${baseQuery}`.trim();
    }
  }

  return "";
}

/**
 * Unduh foto nyata melalui Google Images / Serper / Bing untuk scene yang membahas
 * tempat, landmark geografis, tokoh, atau objek riil spesifik sebelum sisa slot
 * digenerate oleh AI (DALL-E / Pollinations).
 */
export async function ensureRealPhotosForScenes(item, options = {}) {
  if (!isGoogleImageApiAvailable()) return;
  const scenes = item.plan?.scenes || [];
  item.assets = item.assets || {};
  const images = [...(item.assets.images || [])];
  const clips = item.assets.clips || [];

  // 1. Kumpulkan URL yang sudah terpakai di video ini untuk memfilter duplikasi
  const usedUrls = new Set(
    images
      .flatMap((img) => [img.sourceUrl, img.originalUrl, img.url])
      .filter((u) => u && typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")))
  );

  // 2. Lacak query entitas agar query umum (misal "Selat Sunda") tidak dicari mentah berulang kali
  const queryUsage = new Map();
  const normalizeQuery = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").trim();

  const entityTargets = [];
  const genericEmptyTargets = [];

  for (const scene of scenes) {
    if (scene.sceneType === "reaction" || scene.sceneType === "summary") continue;
    const hasRealImg = images.some(
      (img) => Number(img.sceneIndex) === Number(scene.index) && img.path && (img.provider === "google-images" || img.isRealEntity)
    );
    if (hasRealImg) continue;

    let query = extractSceneRealEntityQuery(scene, item.input?.topic);
    if (query && !isGenericPlaceholderQuery(query)) {
      const qKey = normalizeQuery(query);
      const prevCount = queryUsage.get(qKey) || 0;
      if (prevCount >= 1) {
        // Query generik sudah pernah dipakai; perkaya dengan aspek spesifik scene ini
        const enriched = enrichEntityQueryForScene(query, scene);
        if (enriched && normalizeQuery(enriched) !== qKey) {
          query = enriched;
        } else {
          // Jika tidak ada pembeda unik, lewati foto nyata untuk scene ini agar tidak memunculkan gambar kembar
          continue;
        }
      }
      queryUsage.set(normalizeQuery(query), (queryUsage.get(normalizeQuery(query)) || 0) + 1);
      entityTargets.push({ scene, query, isSpecificEntity: true });
    } else {
      const hasClip = clips.some((c) => Number(c.sceneIndex) === Number(scene.index) && c.path);
      const hasImg = images.some((img) => Number(img.sceneIndex) === Number(scene.index) && img.path);
      if (!hasClip && !hasImg) {
        genericEmptyTargets.push({ scene, query: item.input?.topic || "", isSpecificEntity: false });
      }
    }
  }

  const targetQueue = [...entityTargets, ...genericEmptyTargets];
  if (!targetQueue.length) return;

  const realPhotosDir = path.join(paths.generatedDir, "real-photos");
  await fs.mkdir(realPhotosDir, { recursive: true });

  let filledCount = 0;
  // Kuota fleksibel agar seluruh entitas nyata dapat dipenuhi
  const maxRealPhotos = Math.min(18, Math.max(6, Math.floor(scenes.length * 0.75)));

  for (const { scene, query, isSpecificEntity } of targetQueue) {
    if (filledCount >= maxRealPhotos) break;
    if (!query || isGenericPlaceholderQuery(query)) continue;

    try {
      console.log(`[RealPhoto] Mencari foto nyata untuk Scene ${scene.index} (${isSpecificEntity ? "Entitas Spesifik" : "Slot Kosong"}): "${query}"...`);
      const candidates = await searchGoogleImages(query, {
        fallbackQueries: [item.input?.topic].filter(Boolean)
      });
      if (candidates.length) {
        const dest = path.join(realPhotosDir, `${item.id}-scene-${String(scene.index).padStart(2, "0")}-real.jpg`);
        const dl = await downloadImageWithCandidates(candidates, dest, { excludedUrls: usedUrls });
        if (dl.success && isValidImageFileSync(dest)) {
          if (dl.url) usedUrls.add(dl.url);
          images.push({
            sceneIndex: Number(scene.index),
            segmentIndex: 0,
            provider: "google-images",
            query,
            isRealEntity: true,
            source: dl.source || "Google Images",
            sourceUrl: dl.url,
            originalUrl: dl.url,
            path: dest,
            url: `/generated/real-photos/${path.basename(dest)}`
          });
          filledCount++;
          console.log(`[RealPhoto] Scene ${scene.index} berhasil memasang foto nyata unik ("${query}"): ${path.basename(dest)} [URL: ${dl.url}]`);
        } else {
          await fs.unlink(dest).catch(() => {});
        }
      }
    } catch (err) {
      console.warn(`[RealPhoto] Gagal ambil foto nyata scene ${scene.index}: ${err.message}`);
    }
  }

  if (filledCount > 0) {
    item.assets.images = sortByScene(images);
    item.updatedAt = nowIso();
    const persistItem = options.persistItem || saveItem;
    await persistItem(item);
    console.log(`[RealPhoto] Total ${filledCount} foto nyata unik berhasil dipasang ke dalam aset video.`);
  }
}

export async function ensureImages(item, options = {}) {
  // FROMMUSE: provider "flow" tidak butuh OPENAI_API_KEY.
  const imageProvider = String(config.image?.provider || "openai").toLowerCase();
  if (imageProvider !== "flow" && !config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY wajib diisi untuk generate gambar.");
  }
  const warnings = options.warnings || [];
  const generateImage = options.generateImage || generateImageWithRetry;
  const persistItem = options.persistItem || saveItem;
  const mediaExists = createMediaExists(options.fileExists || pathExists);
  item.assets = item.assets || {};
  const managedSlots = new Set(flattenPexelsSegments(item).map((slot) => slot.slot));
  const images = [];
  const clips = [];
  let prunedStaleMedia = false;

  for (const image of item.assets.images || []) {
    const slot = segmentSlot(image.sceneIndex, image.segmentIndex);
    if (!managedSlots.has(slot) || await mediaExists(image.path)) {
      images.push(image);
    } else {
      prunedStaleMedia = true;
    }
  }
  for (const clip of item.assets.clips || []) {
    const slot = segmentSlot(clip.sceneIndex, clip.segmentIndex);
    if (!managedSlots.has(slot) || await mediaExists(clip.path)) {
      clips.push(clip);
    } else {
      prunedStaleMedia = true;
    }
  }

  item.assets.images = sortByScene(images);
  item.assets.clips = sortByScene(clips);
  if (prunedStaleMedia) {
    item.updatedAt = nowIso();
    await persistItem(item);
  }

  const size = item.input.imageSize || LANDSCAPE_SIZE;
  const quality = normalizeImageQuality(item.input.imageQuality || config.openai.imageQuality);

  // Hanya generate gambar untuk scene yang BELUM punya klip Pexels
  const imageScenes = item.plan.scenes.filter((s) => {
    if (s.sceneType === "reaction") return false;
    return true;
  });

  if (imageScenes.length === 0) {
    console.log("[Images] Tidak ada scene yang perlu gambar DALL-E.");
    return;
  }

  const gridMode = options.gridMode ?? config.openai.imageGridMode;
  const gridQuality = normalizeImageQuality(options.gridQuality || config.openai.imageGridQuality || quality);
  const generateGridImages = options.generateGridImages || generateGridImagesDefault;

  // Kelompokkan pekerjaan PER SCENE: kumpulkan segmen yang belum punya media
  // (klip Pexels/gambar). Grid 2x2 dipakai jika scene punya 4 visualSegments
  // dan >= 2 segmen kosong (1 panggilan API menghasilkan 4 panel).
  let totalSegments = 0;
  const sceneJobs = [];
  for (const scene of imageScenes) {
    const segments = scene.visualSegments?.length ? scene.visualSegments : [{ imagePrompt: scene.imagePrompt, visualKeywords: scene.visualKeywords }];
    const missing = [];
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      // Skip jika sudah punya klip video Pexels untuk segmen ini
      const hasClip = clips.find((c) => Number(c.sceneIndex) === Number(scene.index) && Number(c.segmentIndex || 0) === segIdx && c.path);
      if (hasClip) continue;
      // Skip jika sudah punya gambar untuk segmen ini
      const hasImage = images.find((img) => Number(img.sceneIndex) === Number(scene.index) && Number(img.segmentIndex || 0) === segIdx && img.path);
      if (hasImage) continue;
      missing.push({ segIdx, segment: segments[segIdx] });
      totalSegments++;
    }
    if (missing.length) sceneJobs.push({ scene, segments, missing });
  }

  if (totalSegments === 0) {
    console.log("[Images] Semua segmen sudah punya media (klip/gambar), skip generate gambar DALL-E.");
    return;
  }

  console.log(`[Images] Generate gambar untuk ${totalSegments} segmen visual (${gridMode ? "grid 2x2 per scene" : "single per segmen"}).`);
  let imageDone = 0;
  reportProgress("images", "Membuat gambar (grid multi-segment)", 0, `0/${totalSegments}`);

  const generateSingleSegment = async ({ scene, segIdx, segment }) => {
    const segScene = {
      ...scene,
      imagePrompt: segment.imagePrompt || scene.imagePrompt,
      segmentIndex: segIdx
    };
    const image = await generateImage({ item, scene: segScene, size, quality });
    image.segmentIndex = segIdx;
    return image;
  };

  for (const { scene, segments, missing } of sceneJobs) {
    const useGrid = gridMode && segments.length === 4 && missing.length >= 2;
    reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `scene ${scene.index}`);

    if (useGrid) {
      try {
        const panels = await generateGridImages({ item, scene, segments, size, quality: gridQuality });
        const missingIndexes = new Set(missing.map((entry) => entry.segIdx));
        for (const panel of panels) {
          // Simpan hanya panel untuk segmen yang belum punya media
          // (panel milik segmen ber-klip Pexels dibuang).
          if (!missingIndexes.has(Number(panel.segmentIndex))) continue;
          images.push(panel);
          imageDone += 1;
        }
        reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `${imageDone}/${totalSegments}`);
        item.assets.images = sortByScene(images);
        item.updatedAt = nowIso();
        await persistItem(item);
        continue;
      } catch (error) {
        // Fallback otomatis ke single-image per segmen (perilaku lama).
        const message = `Grid gambar scene ${scene.index} gagal: ${error.message}. Fallback ke single-image per segmen.`;
        console.warn(`[Images] ${message}`);
        warnings.push(message);
      }
    }

    for (const { segIdx, segment } of missing) {
      try {
        reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `scene ${scene.index} seg ${segIdx + 1}`);
        const image = await generateSingleSegment({ scene, segIdx, segment });
        imageDone += 1;
        reportProgress("images", "Membuat gambar (grid multi-segment)", Math.round((imageDone / totalSegments) * 100), `${imageDone}/${totalSegments}`);
        images.push(image);
        item.assets.images = sortByScene(images);
        item.updatedAt = nowIso();
        await persistItem(item);
      } catch (error) {
        const message = `Gambar scene ${scene.index} seg ${segIdx} gagal: ${error.message}`;
        if (options.strict) throw new Error(message);
        warnings.push(message);
      }
    }
  }
  item.assets.images = sortByScene(images);
}

/**
 * TTS per scene (termasuk reaction). Durasi visual mengikuti durasi audio asli
 * sehingga subtitle dan suara selalu sinkron dan tidak ada narasi yang terpotong.
 */
export async function ensureLongformSceneAudio(item, options = {}) {
  const warnings = options.warnings || [];
  // FROMMUSE: dukung "groq" di samping "elevenlabs"/"openai".
  const provider = resolveTtsProvider(options.provider || item.input.ttsProvider);
  const scenes = item.plan?.scenes || [];
  const sceneAudio = [];
  const cachedAudio = new Map((item.assets.sceneAudio || []).map((entry) => [entry.sceneIndex, entry]));
  let totalChars = 0;
  let audioDone = 0;
  reportProgress("audio", "Membuat suara TTS per scene", 0, `0/${scenes.length}`);

  for (const scene of scenes) {
    const text = normalizeTtsText(sceneNarrationText(scene));
    const textHash = createHash("sha256").update(JSON.stringify({ text, provider,
      voice: ttsVoiceFor(provider, options.voice),
      speed: ttsSpeedFor(provider),
      instructions: options.instructions || config.openai.ttsInstructions })).digest("hex");
    const cached = cachedAudio.get(scene.index);
    if (options.reuseExisting && cached?.textHash === textHash && cached.path &&
        await fs.access(cached.path).then(() => true, () => false)) {
      sceneAudio.push(cached);
      totalChars += cached.characters;
      audioDone++;
      continue;
    }
    if (!text) {
      sceneAudio.push({ sceneIndex: scene.index, sceneType: scene.sceneType || "image", path: null, captions: [], characters: 0 });
      continue;
    }

    reportProgress("audio", "Membuat suara TTS per scene", Math.round((audioDone / scenes.length) * 100), `scene ${scene.index}`);
    // FROMMUSE: rantai fallback TTS — coba provider pilihan dulu, lalu provider
    // lain yang API key-nya tersedia ("fallback ke yg bisa aja").
    const ttsChain = ttsFallbackChain(provider);
    let audio = null;
    let currentProvider = provider;
    let lastTtsError = null;
    for (const attemptProvider of ttsChain) {
      const attemptSuffix = `scene-${String(scene.index).padStart(2, "0")}-${attemptProvider}-${textHash.slice(0, 12)}`;
      try {
        audio = await generateTtsForProvider(attemptProvider, {
          itemId: item.id,
          text,
          voice: options.voice,
          instructions: options.instructions || config.openai.ttsInstructions,
          filenameSuffix: attemptSuffix
        });
        currentProvider = attemptProvider;
        if (attemptProvider !== provider) {
          const msg = `TTS ${provider} scene ${scene.index} gagal (${lastTtsError?.message}); memakai ${attemptProvider}.`;
          warnings.push(msg);
          console.warn(`[TTS] ${msg}`);
        }
        break;
      } catch (ttsError) {
        lastTtsError = ttsError;
        console.warn(`[TTS] ${attemptProvider} scene ${scene.index} gagal: ${ttsError.message}`);
      }
    }
    if (!audio) {
      const error = lastTtsError || new Error("Semua provider TTS gagal.");
      if (options.strict) throw error;
      warnings.push(`TTS scene ${scene.index} gagal: ${error.message}`);
      sceneAudio.push({ sceneIndex: scene.index, sceneType: scene.sceneType || "image", path: null, captions: [], characters: 0 });
      continue;
    }

    let captions = [];
    try {
      const whisperSegments = await transcribeSpeechSegments(audio.path);
      captions = alignCaptionsToSource(text, whisperSegments);
    } catch (error) {
      warnings.push(`Transkripsi subtitle scene ${scene.index} gagal: ${error.message}`);
      captions = [];
    }

    totalChars += text.length;
    audioDone += 1;
    reportProgress("audio", "Membuat suara TTS per scene", Math.round((audioDone / scenes.length) * 100), `${audioDone}/${scenes.length}`);
    sceneAudio.push({
      sceneIndex: scene.index,
      sceneType: scene.sceneType || "image",
      provider: currentProvider,
      speed: audio.speed,
      textHash,
      path: audio.path,
      url: audio.url,
      characters: text.length,
      captions
    });
  }

  item.assets.sceneAudio = sceneAudio;
  item.assets.audio = {
    provider,
    sceneBased: true,
    characters: totalChars,
    scenes: sceneAudio.filter((entry) => entry.path).length
  };
  item.input.ttsProvider = provider;
  item.cost.ttsUsd = estimateTtsUsd(totalChars, provider, config.pricing)
    + (item.assets.hookAudio ? estimateTtsUsd(item.assets.hookAudio.characters, item.assets.hookAudio.provider, config.pricing) : 0);
  updateTotalCost(item);
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

/**
 * TTS khusus untuk "cold open" (hook teaser di 15 detik pertama).
 * Membacakan item.plan.hook sebagai kalimat pembuka yang punchy, terpisah dari
 * scene audio. Visualnya nanti memakai media scene-1 (Pexels/gambar) di render.
 * Gagal/terlewat = aman: render otomatis kembali ke struktur tanpa cold open.
 */
export async function ensureHookAudio(item, options = {}) {
  const warnings = options.warnings || [];
  const hookText = normalizeTtsText(item.plan?.hook || "");
  if (!hookText) return;

  const provider = resolveTtsProvider(options.provider || item.input.ttsProvider);
  reportProgress("audio", "Membuat suara hook (cold open)", 0, "");

  // FROMMUSE: rantai fallback TTS seperti scene audio.
  const hookChain = ttsFallbackChain(provider);
  let audio = null;
  let currentProvider = provider;
  let lastTtsError = null;
  for (const attemptProvider of hookChain) {
    const attemptSuffix = attemptProvider === "elevenlabs" ? "cold-open-elevenlabs"
      : attemptProvider === "groq" ? "cold-open-groq" : "cold-open-openai";
    try {
      audio = await generateTtsForProvider(attemptProvider, {
        itemId: item.id,
        text: hookText,
        voice: options.voice,
        instructions: config.openai.ttsInstructions,
        filenameSuffix: attemptSuffix
      });
      currentProvider = attemptProvider;
      if (attemptProvider !== provider) {
        const msg = `TTS ${provider} cold-open gagal (${lastTtsError?.message}); memakai ${attemptProvider}.`;
        warnings.push(msg);
        console.warn(`[TTS] ${msg}`);
      }
      break;
    } catch (ttsError) {
      lastTtsError = ttsError;
      console.warn(`[TTS] ${attemptProvider} cold-open gagal: ${ttsError.message}`);
    }
  }
  if (!audio) {
    const error = lastTtsError || new Error("Semua provider TTS gagal.");
    warnings.push(`Cold-open TTS gagal: ${error.message}`);
    reportProgress("audio", "Hook cold open dilewati", 100, "tanpa suara");
    return;
  }

  item.assets.hookAudio = {
    provider: currentProvider,
    path: audio.path,
    url: audio.url,
    text: hookText,
    characters: hookText.length
  };
  item.cost.ttsUsd = Number((Number(item.cost.ttsUsd || 0) + estimateTtsUsd(hookText.length, currentProvider, config.pricing)).toFixed(5));
  updateTotalCost(item);
  item.updatedAt = nowIso();
  await saveItem(item);
  reportProgress("audio", "Suara hook siap", 100, "");
}

function sceneNarrationText(scene) {
  return String(scene.narration || scene.screenText || "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ensureThumbnail(item, options = {}) {
  if (item.assets.thumbnail?.path) return;
  const warnings = options.warnings || [];
  try {
    item.assets.thumbnail = await generateThumbnail(item);
    item.updatedAt = nowIso();
    await saveItem(item);
  } catch (error) {
    warnings.push(`Thumbnail gagal: ${error.message}`);
  }
}

export async function renderAndPersist(item, options = {}) {
  assertReadyToRender(item);
  item.assets.video = await renderLongformVideo(item, options);
  item.status = "rendered";
  item.updatedAt = nowIso();
  await saveItem(item);
  return item;
}

export function assertReadyToRender(item) {
  // Cek: setiap segmen visual dari setiap scene image/summary harus punya MINIMAL klip video ATAU gambar
  const requiredScenes = (item.plan.scenes || []).filter((scene) => scene.sceneType !== "reaction");
  const clips = item.assets.clips || [];
  const images = item.assets.images || [];
  for (const scene of requiredScenes) {
    const segCount = scene.visualSegments?.length || 1;
    for (let segIdx = 0; segIdx < segCount; segIdx++) {
      const hasClip = clips.find((c) => Number(c.sceneIndex) === Number(scene.index) && Number(c.segmentIndex || 0) === segIdx && c.path);
      const hasImage = images.find((img) => Number(img.sceneIndex) === Number(scene.index) && Number(img.segmentIndex || 0) === segIdx && img.path);
      if (!hasClip && !hasImage) {
        const error = new Error(`Scene ${scene.index} segmen ${segIdx + 1} belum punya media (klip video atau gambar). Generate dulu.`);
        error.status = 409;
        throw error;
      }
    }
  }
  const hasSceneAudio = (item.assets.sceneAudio || []).some((entry) => entry?.path);
  if (!hasSceneAudio) {
    const error = new Error("Audio TTS per scene belum tersedia. Generate suara dulu.");
    error.status = 409;
    throw error;
  }
}

export function ffmpegAvailable() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", windowsHide: true });
  return ffmpeg.status === 0;
}

async function generateGridImagesDefault({ item, scene, segments, size, quality }) {
  try {
    return await generateSceneGridImage({ itemId: item.id, scene, segments, size, quality });
  } catch (error) {
    // Retry sekali dengan prompt panel yang di-safe-kan (pola sama dengan generateImageWithRetry).
    const safeSegments = segments.map((segment, segIdx) => ({
      ...segment,
      imagePrompt: [
        `safe educational illustration about ${item.input.topic}`,
        `scene focus: ${scene.screenText}`,
        `moment ${segIdx + 1} of 4 in sequence`,
        "objects, hands, table, museum display, science concept, no people in danger, no medical procedure, no text"
      ].join(", ")
    }));
    const panels = await generateSceneGridImage({ itemId: item.id, scene, segments: safeSegments, size, quality });
    for (const panel of panels) panel.recoveredFrom = error.message;
    return panels;
  }
}

async function generateImageWithRetry({ item, scene, size, quality }) {
  try {
    return await generateSceneImage({ itemId: item.id, scene, size, quality });
  } catch (error) {
    const safeScene = {
      ...scene,
      imagePrompt: [
        `safe educational illustration about ${item.input.topic}`,
        `scene focus: ${scene.screenText}`,
        "objects, hands, table, museum display, science concept, no people in danger, no medical procedure, no text"
      ].join(", ")
    };
    const image = await generateSceneImage({ itemId: item.id, scene: safeScene, size, quality });
    image.recoveredFrom = error.message;
    return image;
  }
}

function updateTotalCost(item) {
  item.cost = item.cost || {};
  item.cost.totalUsd = Number((
    Number(item.cost.storyUsd || 0)
    + Number(item.cost.imageUsd || 0)
    + Number(item.cost.ttsUsd || 0)
    + Number(item.cost.videoUsd || 0)
  ).toFixed(5));
}

function sortByScene(items) {
  return [...items].sort((a, b) => (
    (Number(a.sceneIndex || 0) - Number(b.sceneIndex || 0))
    || (Number(a.segmentIndex || 0) - Number(b.segmentIndex || 0))
  ));
}
