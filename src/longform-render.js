import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, paths } from "./config.js";
import { clamp, cleanText, normalizeTtsText, safeFilename, splitLines, isValidImageFileSync } from "./util.js";
import { reportProgress } from "./progress.js";
import { buildWordTimeline, findPhraseTime, tokenizeMatchText } from "./word-timeline.js";
import { planSceneSpotlights, spotlightDialogueLines, spotlightStyles, logSpotlightStats } from "./spotlight.js";
import { applyNewsImageOverlays } from "./news-image.js";
import { isGenericStoryboardText } from "./story-language.js";
import { assertFinalDuration, fitSceneAudio, quantizeDurations, scaleCaptionTimes } from "./duration-control.js";

const fps = 30;
const minLongformDurationSec = 300;
const maxLongformDurationSec = 1200;
const backgroundMusicVolume = 0.07;

/**
 * Resolves paths dynamically supporting both assets/personal and assets/music/personal
 */
async function getPersonalDir(subPath) {
  const path1 = path.resolve(paths.rootDir, "assets", "personal", subPath);
  const path2 = path.resolve(paths.rootDir, "assets", "music", "personal", subPath);
  try {
    await fs.access(path1);
    return path1;
  } catch {
    return path2;
  }
}

/**
 * Select a random intro video for the category, fallback to 'umum' if category does not exist.
 */
async function selectIntroVideo(category) {
  const introsDir = await getPersonalDir("intros");
  let catFolder = "umum";
  const catLower = String(category || "").toLowerCase();
  
  if (catLower.includes("sain") || catLower.includes("alam") || catLower.includes("tubuh") || catLower.includes("ekologi")) {
    catFolder = "sains";
  } else if (catLower.includes("sejarah") || catLower.includes("tokoh") || catLower.includes("budaya")) {
    catFolder = "sejarah";
  } else if (catLower.includes("teknologi") || catLower.includes("penemuan") || catLower.includes("material") || catLower.includes("benda") || catLower.includes("peta")) {
    catFolder = "teknologi";
  } else if (catLower.includes("bisnis")) {
    catFolder = "bisnis";
  } else if (catLower.includes("misteri")) {
    catFolder = "misteri";
  }

  let searchDir = path.join(introsDir, catFolder);
  try {
    await fs.access(searchDir);
  } catch {
    searchDir = path.join(introsDir, "umum");
  }

  try {
    const files = (await fs.readdir(searchDir)).filter(f => f.toLowerCase().endsWith(".mp4"));
    if (files.length > 0) {
      const selected = files[Math.floor(Math.random() * files.length)];
      return path.join(searchDir, selected);
    }
  } catch (e) {
    console.warn("Gagal membaca folder intro:", e.message);
  }
  return path.join(introsDir, "umum", "intro-1.mp4");
}

/**
 * Select a random general outro video.
 */
async function selectOutroVideo() {
  const outrosDir = await getPersonalDir(path.join("outros", "umum"));
  try {
    const files = (await fs.readdir(outrosDir)).filter(f => f.toLowerCase().endsWith(".mp4"));
    if (files.length > 0) {
      const selected = files[Math.floor(Math.random() * files.length)];
      return path.join(outrosDir, selected);
    }
  } catch (e) {
    console.warn("Gagal membaca folder outro:", e.message);
  }
  return path.join(outrosDir, "outro-1.mp4");
}

/**
 * Select a random reaction video.
 */
async function selectReactionVideo(cue = "") {
  const reactionsDir = await getPersonalDir("reactions");
  try {
    const files = (await fs.readdir(reactionsDir)).filter(f => f.toLowerCase().endsWith(".mp4"));
    if (files.length > 0) {
      const cueText = String(cue || "").toLowerCase();
      const preferredNames = cueText.includes("kaget") || cueText.includes("kejutan")
        ? ["kaget"]
        : cueText.includes("petunjuk") || cueText.includes("temu")
          ? ["petunjuk", "tekatekipetunjuk", "somethingmissing"]
          : cueText.includes("setuju") || cueText.includes("mantap")
            ? ["mantap", "fakta"]
            : cueText.includes("skeptis") || cueText.includes("kenapa") || cueText.includes("heran")
              ? ["hmmkenapabisa", "somethingmissing"]
              : [];
      const preferred = files.filter((file) => preferredNames.some((name) => file.toLowerCase().includes(name)));
      const pool = preferred.length ? preferred : files;
      const selected = pool[Math.floor(Math.random() * pool.length)];
      return path.join(reactionsDir, selected);
    }
  } catch (e) {
    console.warn("Gagal membaca folder reaction:", e.message);
  }
  return null;
}

/**
 * Prepare bumper by scaling, setting fps to 30 and audio channels to stereo/44100Hz
 */
async function prepareBumper(bumperPath, outputPath, resolution = "720p") {
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;
  await runFfmpeg([
    "-y",
    "-i", bumperPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-c:a", "aac",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ]);
}

/**
 * Make Category Intro Segment — full frame presenter video (no chroma keying).
 * User preference: intro/outro ditampilkan full frame, hanya reaction yang pakai keying.
 */
async function makeIntroSegment({ bgPath, bgType, introPath, outputPath, duration, bgMusicPath, resolution = "720p" }) {
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;
  await runFfmpeg([
    "-y",
    "-i", introPath,
    "-stream_loop", "-1",
    "-i", bgMusicPath,
    "-filter_complex",
    [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p[v]`,
      `[0:a]volume=1.0[speech]`,
      `[1:a]volume=${backgroundMusicVolume}[music]`,
      `[speech][music]amix=inputs=2:duration=first,alimiter=limit=0.95[a]`
    ].join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-r", String(fps),
    "-c:a", "aac",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ]);
}

/**
 * Make Category Outro Segment. If BANYAKTAU_KEY_INTRO_OUTRO is true, key presenter and overlay on blurred bg.
 */
async function makeOutroSegment({ bgPath, bgType, outroPath, outputPath, duration, bgMusicPath, musicOffset, resolution = "720p" }) {
  const fadeOutAt = Math.max(0.1, duration - 1.5).toFixed(2);
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;

  await runFfmpeg([
    "-y",
    "-i", outroPath,
    "-stream_loop", "-1",
    "-i", bgMusicPath,
    "-filter_complex",
    [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p[v]`,
      `[0:a]volume=1.0[speech]`,
      `[1:a]volume=${backgroundMusicVolume},afade=t=out:st=${fadeOutAt}:d=1.5[music]`,
      `[speech][music]amix=inputs=2:duration=first,alimiter=limit=0.95[a]`
    ].join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-r", String(fps),
    "-c:a", "aac",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ]);
}

/**
 * Make audio block for the content scenes, mixing voiceover with background music.
 */
async function makeContentAudio({ narrationPath, musicPath, outputPath, duration, tempo, scenes }) {
  const narrationScenes = scenes.filter((scene) => scene.sceneType !== "reaction");
  const splitLabels = narrationScenes.map((_, index) => `[n${index}]`).join("");
  const narrationFilters = [
    "aformat=sample_rates=44100:channel_layouts=stereo",
    ...atempoFilters(tempo),
    "loudnorm=I=-16:TP=-1.5:LRA=9",
    "volume=1.08"
  ].join(",");
  const timelineFilters = [`[0:a]${narrationFilters},asplit=${narrationScenes.length}${splitLabels}`];
  const timelineParts = [];
  let narrationIndex = 0;

  scenes.forEach((scene, index) => {
    const label = `part${index}`;
    if (scene.sceneType === "reaction") {
      timelineFilters.push(
        `anullsrc=r=44100:cl=stereo,atrim=duration=${scene.durationSec.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`
      );
    } else {
      timelineFilters.push(
        `[n${narrationIndex}]atrim=start=${scene.narrationStartSec.toFixed(3)}:end=${scene.narrationEndSec.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`
      );
      narrationIndex += 1;
    }
    timelineParts.push(`[${label}]`);
  });
  timelineFilters.push(`${timelineParts.join("")}concat=n=${timelineParts.length}:v=0:a=1[timeline]`);

  await runFfmpeg([
    "-y",
    "-i", narrationPath,
    "-stream_loop", "-1",
    "-t", String(duration),
    "-i", musicPath,
    "-filter_complex",
    [
      ...timelineFilters,
      `[1:a]volume=${backgroundMusicVolume}[music]`,
      `[timeline][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`
    ].join(";"),
    "-map", "[a]",
    "-t", String(duration),
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ], { timeoutMs: 600_000 });
}

/**
 * Make music-only audio block for content scenes if narration is missing.
 */
async function makeContentAudioOnlyMusic({ musicPath, outputPath, duration, musicOffset }) {
  await runFfmpeg([
    "-y",
    "-stream_loop", "-1",
    "-t", String(duration),
    "-i", musicPath,
    "-filter_complex",
    `[0:a]volume=${backgroundMusicVolume}[music]`,
    "-map", "[music]",
    "-t", String(duration),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ], { timeoutMs: 600_000 });
}

/**
 * Merender video horizontal landscape (16:9) dari draft naskah panjang.
 * @param {object} item - Objek item naskah panjang
 * @returns {Promise<object>} - Hasil data video yang dirender
 */
export async function prepareRenderLayout(item) {
  const bumperOutroEnabled = item.input?.bumperOutroEnabled ?? config.render.bumperOutroEnabled;
  const introEnabled = item.input?.introEnabled ?? config.render.introEnabled;
  const outroEnabled = item.input?.outroEnabled ?? config.render.outroEnabled;
  const bumperOutroRaw = path.join(paths.rootDir, "assets", "bumper-yt", "bumper-youtube-outro.mp4");
  const bumperExists = await fs.access(bumperOutroRaw).then(() => true, () => false);
  const introVideoPath = introEnabled ? await selectIntroVideo(item.input?.category) : null;
  const outroVideoPath = outroEnabled ? await selectOutroVideo() : null;
  const introDuration = introVideoPath ? await probeDuration(introVideoPath) : 0;
  const outroDuration = outroVideoPath ? await probeDuration(outroVideoPath) : 0;
  const bumperOutroDuration = bumperOutroEnabled && bumperExists ? await probeDuration(bumperOutroRaw) : 0;
  let coldOpenDuration = 0;
  if (config.automation.coldOpenEnabled && (item.plan?.hook || item.assets?.hookAudio?.text)) {
    const hookSec = item.assets?.hookAudio?.path ? await probeDuration(item.assets.hookAudio.path) : 0;
    const duration = item.input?.durationLocked ? Math.max(4, (hookSec || 6) + 0.8) : clamp((hookSec || 6) + 0.8, 4, 20);
    coldOpenDuration = Math.ceil(duration * fps) / fps;
  }
  return { bumperOutroEnabled, introEnabled, outroEnabled, bumperOutroRaw,
    bumperIntroDuration: 0, bumperOutroDuration, introVideoPath, introDuration,
    outroVideoPath, outroDuration, coldOpenDuration,
    fixedDuration: introDuration + outroDuration + bumperOutroDuration + coldOpenDuration };
}

export async function measureNarrationFit(item, layout) {
  const byIndex = new Map((item.assets.sceneAudio || []).map((entry) => [entry.sceneIndex, entry]));
  const durations = await Promise.all(item.plan.scenes.map((scene) => {
    const audio = byIndex.get(scene.index);
    return audio?.path ? probeDuration(audio.path) : 0;
  }));
  return fitSceneAudio(item.plan.scenes, durations, item.input.durationSec, layout.fixedDuration);
}

export async function renderLongformVideo(item, options = {}) {
  const workDir = path.join(paths.workDir, item.id);
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(paths.videoDir, { recursive: true });

  const resolution = (item.input?.resolution || "720p").toLowerCase();

  const customMusic = await findBackgroundMusic();
  if (!customMusic) {
    throw new Error("Background music not found! Please place Marimba Curiosity Case MP3 under assets/music.");
  }

  const layout = options.layout || await prepareRenderLayout(item);
  const { bumperOutroEnabled, introEnabled, outroEnabled, bumperOutroRaw,
    bumperIntroDuration, bumperOutroDuration, introVideoPath, introDuration,
    outroVideoPath, outroDuration } = layout;

  // Mode baru: TTS per scene (termasuk reaction). Durasi visual mengikuti durasi audio
  // sehingga subtitle dan suara selalu sinkron dan tidak ada narasi yang terpotong.
  const sceneAudioEntries = Array.isArray(item.assets?.sceneAudio) ? item.assets.sceneAudio : [];
  const hasSceneAudio = sceneAudioEntries.some((entry) => entry?.path);

  let timing;
  let renderScenes;

  if (hasSceneAudio) {
    const built = await buildSceneAudioTiming(item, {
      introDuration,
      outroDuration,
      bumperIntroDuration,
      bumperOutroDuration,
      coldOpenDuration: layout.coldOpenDuration
    });
    timing = built.timing;
    renderScenes = built.renderScenes;
  } else {
    const narrationDuration = item.assets?.audio?.path ? await probeDuration(item.assets.audio.path) : 0;
    timing = buildTiming(item, narrationDuration, introDuration, outroDuration, bumperIntroDuration, bumperOutroDuration);
    renderScenes = buildRenderScenes(item, timing.adjustedNarrationDuration, timing.contentDuration);
  }

  // Content segments visual rendering (multi-visual per scene via visualSegments)
  const contentSegmentPaths = [];
  for (let index = 0; index < renderScenes.length; index += 1) {
    const scene = renderScenes[index];
    const segmentPath = path.join(workDir, `content-segment-${String(index).padStart(2, "0")}.mp4`);

    if (scene.sceneType === "reaction") {
      const reactionPath = await selectReactionVideo(`${scene.reactionCue || ""} ${scene.screenText || ""}`);
      if (!reactionPath) throw new Error(`Asset reaction untuk scene ${scene.index} tidak tersedia.`);
      reportProgress("render", "Merender segmen video", Math.round(5 + (index / renderScenes.length) * 70), `reaction ${index + 1}/${renderScenes.length}`);
      console.log(`Rendering reaction scene ${index + 1}/${renderScenes.length} (${scene.durationSec}s): ${path.basename(reactionPath)}...`);
      await makeReactionSegment({
        reactionPath,
        outputPath: segmentPath,
        duration: scene.durationSec,
        resolution
      });
    } else {
      const mediaList = resolveSceneMediaList(item, scene);
      scene.mediaList = mediaList;
      reportProgress("render", "Merender segmen video", Math.round(5 + (index / renderScenes.length) * 70), `scene ${index + 1}/${renderScenes.length} (${mediaList.length} sub)`);
      console.log(`Rendering ${scene.sceneType || "image"} scene ${index + 1}/${renderScenes.length} (${scene.durationSec}s, ${mediaList.length} sub-segments)...`);

      if (mediaList.length <= 1) {
        // Single media: render langsung seperti sebelumnya
        const media = mediaList[0];
        try {
          if (media.type === "video") {
            await makeVideoSegment({ videoPath: media.path, outputPath: segmentPath, duration: scene.durationSec, resolution });
          } else {
            await makeImageSegment({
              imagePath: media.path,
              outputPath: segmentPath,
              duration: scene.durationSec,
              zoomDirection: index % 2 ? "out" : "in",
              resolution,
              backgroundVideoPath: media.backgroundVideoPath || null
            });
          }
        } catch (err) {
          console.warn(`[Render] Scene ${index + 1} visual gagal (${err.message}), mencoba media alternatif...`);
          const altVideo = (item.assets?.clips || []).find((c) => c.path && c.path !== media.path);
          const altImage = (item.assets?.images || []).find((img) => img.path && img.path !== media.path && isValidImageFileSync(img.path));
          if (altVideo?.path) {
            await makeVideoSegment({ videoPath: altVideo.path, outputPath: segmentPath, duration: scene.durationSec, resolution });
          } else if (altImage?.path) {
            await makeImageSegment({ imagePath: altImage.path, outputPath: segmentPath, duration: scene.durationSec, resolution });
          } else {
            throw err;
          }
        }
      } else {
        // Multi-media: render tiap sub-segment lalu concat.
        // Durasi sub-segment mengikuti timestamp kata TTS (narrativeContext),
        // sehingga gambar berganti tepat saat ide itu diucapkan.
        const subDurations = quantizeDurations(computeSegmentDurations(scene, mediaList.length), fps);
        const subPaths = [];
        for (let mi = 0; mi < mediaList.length; mi++) {
          const subPath = path.join(workDir, `content-segment-${String(index).padStart(2, "0")}-sub-${mi}.mp4`);
          const media = mediaList[mi];
          const subDuration = subDurations[mi] ?? scene.durationSec / mediaList.length;
          console.log(`  -> Sub-segment ${mi + 1}/${mediaList.length} (${subDuration.toFixed(2)}s, ${media.type}${media.isRealEntity ? " [real]" : ""}): ${path.basename(media.path)}...`);
          try {
            if (media.type === "video") {
              await makeVideoSegment({ videoPath: media.path, outputPath: subPath, duration: subDuration, resolution });
            } else {
              // Alternasi zoom direction per sub-segment
              const zoomDir = (index + mi) % 2 ? "out" : "in";
              await makeImageSegment({
                imagePath: media.path,
                outputPath: subPath,
                duration: subDuration,
                zoomDirection: zoomDir,
                resolution,
                backgroundVideoPath: media.backgroundVideoPath || null
              });
            }
          } catch (segErr) {
            console.warn(`[Render] Sub-segment ${mi + 1} gagal (${segErr.message}), mencoba fallback ke media alternatif...`);
            const altVideo = (item.assets?.clips || []).find((c) => c.path && c.path !== media.path)
              || mediaList.find((m) => m.type === "video" && m.path !== media.path);
            const altImage = (item.assets?.images || []).find((img) => img.path && img.path !== media.path && isValidImageFileSync(img.path));
            if (altVideo?.path) {
              console.log(`[Render] Fallback sub-segment ${mi + 1} menggunakan video: ${path.basename(altVideo.path)}`);
              await makeVideoSegment({ videoPath: altVideo.path, outputPath: subPath, duration: subDuration, resolution });
            } else if (altImage?.path) {
              console.log(`[Render] Fallback sub-segment ${mi + 1} menggunakan gambar: ${path.basename(altImage.path)}`);
              await makeImageSegment({ imagePath: altImage.path, outputPath: subPath, duration: subDuration, resolution });
            } else {
              throw segErr;
            }
          }
          subPaths.push(subPath);
        }
        await concatSegments(subPaths, segmentPath);
      }
    }
    contentSegmentPaths.push(segmentPath);
  }

  logSegmentSyncStats();

  // Concatenate all content visual segments
  const contentVisualPath = path.join(workDir, "content-visual.mp4");
  await concatSegments(contentSegmentPaths, contentVisualPath);

  // Write content captions ASS file
  const contentAssPath = path.join(workDir, "content-captions.ass");
  const { spotlightPlacements } = await writeContentCaptionAss({
    outputPath: contentAssPath,
    item,
    scenes: renderScenes,
    contentDuration: timing.contentDuration
  });

  // Burn subtitles on content visual
  const contentSubtitledPath = path.join(workDir, "content-subtitled.mp4");
  await burnSubtitles({ inputPath: contentVisualPath, assPath: contentAssPath, outputPath: contentSubtitledPath });

  // Overlay foto tokoh untuk spotlight "figure" (bila gambar tersedia)
  const contentFigurePath = path.join(workDir, "content-figure-overlay.mp4");
  const figurePlacements = (spotlightPlacements || []).filter((p) => p.type === "figure");
  await applyFigureImageOverlays(contentSubtitledPath, contentFigurePath, figurePlacements, item, resolution);

  // Overlay device mockup (phone/tablet) dengan foto berita asli via chroma key
  const contentDevicePath = path.join(workDir, "content-device-overlay.mp4");
  await applyNewsImageOverlays(contentFigurePath, contentDevicePath, item, renderScenes, resolution, runFfmpeg, { spotlightPlacements });

  // Add watermark logo to content
  const contentBrandedPath = path.join(workDir, "content-branded.mp4");
  await addLogoWatermark({ inputPath: contentDevicePath, outputPath: contentBrandedPath, resolution });

  // Generate audio for content
  const contentAudioPath = path.join(workDir, "content-audio.m4a");
  if (hasSceneAudio) {
    await makeContentAudioFromScenes({
      scenes: renderScenes,
      musicPath: customMusic,
      outputPath: contentAudioPath,
      duration: timing.contentDuration,
      workDir
    });
  } else if (item.assets?.audio?.path) {
    await makeContentAudio({
      narrationPath: item.assets.audio.path,
      musicPath: customMusic,
      outputPath: contentAudioPath,
      duration: timing.contentDuration,
      tempo: timing.narrationTempo,
      scenes: renderScenes
    });
  } else {
    await makeContentAudioOnlyMusic({
      musicPath: customMusic,
      outputPath: contentAudioPath,
      duration: timing.contentDuration,
      musicOffset: introDuration
    });
  }

  // Mux content video and audio
  const finalContentPath = path.join(workDir, "part-2-content.mp4");
  await muxVideoAudio({ videoPath: contentBrandedPath, audioPath: contentAudioPath, outputPath: finalContentPath });

  // Render Part 1 (Category Intro) — opsional
  let introPartPath = null;
  if (introEnabled && introVideoPath && introDuration > 0) {
    const firstSceneMedia = resolveSceneMedia(item, renderScenes[0]);
    introPartPath = path.join(workDir, "part-1-intro.mp4");
    reportProgress("render", "Merender intro", 80, "");console.log("Rendering Part 1 (Category Intro)...");
    await makeIntroSegment({
      bgPath: firstSceneMedia.path,
      bgType: firstSceneMedia.type,
      introPath: introVideoPath,
      outputPath: introPartPath,
      duration: introDuration,
      bgMusicPath: customMusic,
      resolution
    });
  }

  // Render Part 3 (Category Outro) — opsional
  let finalOutroPath = null;
  if (outroEnabled && outroVideoPath && outroDuration > 0) {
    const lastSceneMedia = resolveSceneMedia(item, renderScenes.at(-1));
    const outroRawPath = path.join(workDir, "part-3-outro-raw.mp4");
    reportProgress("render", "Merender outro", 86, "");console.log("Rendering Part 3 Outro Visual & Audio...");
    await makeOutroSegment({
      bgPath: lastSceneMedia.path,
      bgType: lastSceneMedia.type,
      outroPath: outroVideoPath,
      outputPath: outroRawPath,
      duration: outroDuration,
      bgMusicPath: customMusic,
      musicOffset: introDuration + timing.contentDuration,
      resolution
    });
    finalOutroPath = outroRawPath;
  }

  // Transcode Bumper Outro — opsional
  let finalBumperOutroPath = null;
  if (bumperOutroEnabled && bumperOutroDuration > 0) {
    finalBumperOutroPath = path.join(workDir, "part-4-bumper-outro.mp4");
    reportProgress("render", "Menyiapkan bumper outro", 90, "");console.log("Transcoding Bumper Outro...");
    await prepareBumper(bumperOutroRaw, finalBumperOutroPath, resolution);
  }

  // Cold open (hook teaser) opsional — diputar lebih dulu agar penonton langsung
  // ketemu inti yang bikin penasaran di detik-detik awal, bukan bumper/intro.
  // Visual diambil dari media scene-1 (klip Pexels, atau gambar AI bila tak ada).
  let coldOpenPath = null;
  let coldOpenDuration = 0;
  const hookAudioPath = item.assets?.hookAudio?.path || null;
  const hookText = item.plan?.hook || item.assets?.hookAudio?.text || "";
  if (config.automation.coldOpenEnabled && hookText) {
    try {
      coldOpenDuration = layout.coldOpenDuration;
      // Flash-forward: hook menceritakan momen dari pertengahan/akhir cerita, jadi
      // visual cold open harus dari scene yang sama, bukan selalu scene 1. Item
      // lama tanpa flashForwardSceneIndex (misal rerender draft lama) tetap jatuh
      // ke perilaku lama sebagai fallback.
      const flashForwardIndex = Number(item.plan?.flashForwardSceneIndex);
      const coldScene = (Number.isInteger(flashForwardIndex) &&
          renderScenes.find((scene) => scene.index === flashForwardIndex && scene.sceneType !== "reaction"))
        || renderScenes.find((scene) => scene.sceneType !== "reaction")
        || renderScenes[0];
      const coldMedia = resolveSceneMedia(item, coldScene);
      reportProgress("render", "Merender cold open (hook)", 92, "");console.log(`Rendering Cold Open hook (${coldOpenDuration}s, ${coldMedia.type})...`);

      const coldVisualPath = path.join(workDir, "cold-open-visual.mp4");
      await makeColdOpenVisual({ media: coldMedia, outputPath: coldVisualPath, duration: coldOpenDuration, zoomDirection: "in", resolution });

      const coldAssPath = path.join(workDir, "cold-open.ass");
      await writeColdOpenCaptionAss({ outputPath: coldAssPath, hookText, duration: coldOpenDuration });
      const coldSubtitledPath = path.join(workDir, "cold-open-subtitled.mp4");
      await burnSubtitles({ inputPath: coldVisualPath, assPath: coldAssPath, outputPath: coldSubtitledPath });

      const coldAudioPath = path.join(workDir, "cold-open-audio.m4a");
      await makeColdOpenAudio({ hookAudioPath, musicPath: customMusic, outputPath: coldAudioPath, duration: coldOpenDuration });

      coldOpenPath = path.join(workDir, "part-cold-open.mp4");
      await muxVideoAudio({ videoPath: coldSubtitledPath, audioPath: coldAudioPath, outputPath: coldOpenPath });
    } catch (error) {
      if (item.input?.durationLocked) throw error;
      console.warn(`[Cold Open] Gagal, lanjut tanpa cold open: ${error.message}`);
      coldOpenPath = null;
      coldOpenDuration = 0;
    }
  }

  // Urutan pembuka: cold open hook langsung → category intro (bila ada).
  // Bumper intro dihapus agar penonton langsung kena hook tanpa jeda brand opener.
  const opening = [];
  if (coldOpenPath) opening.push(coldOpenPath);
  if (introPartPath) opening.push(introPartPath);

  const coreParts = [
    ...opening,
    finalContentPath,
    ...(finalOutroPath ? [finalOutroPath] : []),
    ...(finalBumperOutroPath ? [finalBumperOutroPath] : [])
  ];

  const durationByPath = new Map([
    ...(coldOpenPath ? [[coldOpenPath, coldOpenDuration]] : []),
    ...(introPartPath ? [[introPartPath, introDuration]] : [])
  ]);
  const frontDuration = opening.reduce((sum, part) => sum + (durationByPath.get(part) || 0), 0);
  const totalDuration = Number((frontDuration + timing.contentDuration + (finalOutroPath ? outroDuration : 0) + (finalBumperOutroPath ? bumperOutroDuration : 0)).toFixed(2));

  const provider = item.assets?.audio?.provider || "local";
  const filename = `${item.id}-${provider}-${safeFilename(item.title)}.mp4`;
  const outputPath = path.join(paths.videoDir, filename);

  reportProgress("render", "Menggabungkan video final", 95, "");console.log(`Concatenating ${coreParts.length} parts into final video${coldOpenPath ? " (with cold open)" : ""}...`);
  await concatSegments(coreParts, outputPath);
  const measuredDuration = await probeDuration(outputPath);
  if (item.input?.durationLocked) assertFinalDuration(measuredDuration, item.input.durationSec);

  // Sidecar .srt + daftar bab. Keduanya memakai timeline final (setelah bagian
  // pembuka), jadi harus dihitung sesudah pola opening dipilih.
  const srtFilename = `${path.parse(filename).name}.srt`;
  const srtPath = await writeSrtFile(
    path.join(paths.videoDir, srtFilename),
    sceneCaptionSegments(renderScenes),
    frontDuration
  );
  const chapters = buildChapterList(renderScenes, frontDuration, totalDuration);

  return {
    path: outputPath,
    url: `/generated/videos/${filename}`,
    srtPath,
    chapters,
    provider,
    durationSec: measuredDuration,
    targetDurationSec: item.input?.durationLocked ? item.input.durationSec : null,
    scenes: renderScenes.length,
    coldOpen: Boolean(coldOpenPath)
  };
}

function buildTiming(item, narrationDuration, introDuration, outroDuration, bumperIntroDuration = 0, bumperOutroDuration = 0) {
  const requestedTotal = clamp(Number(item.input?.durationSec || minLongformDurationSec), minLongformDurationSec, maxLongformDurationSec);
  const fixedDuration = introDuration + outroDuration + bumperIntroDuration + bumperOutroDuration;
  const maxContent = Math.max(180, maxLongformDurationSec - fixedDuration);
  const requestedContent = Math.max(180, requestedTotal - fixedDuration);
  const reactionDuration = (item.plan?.scenes || [])
    .filter((scene) => scene.sceneType === "reaction")
    .reduce((sum, scene) => sum + estimateReactionDuration(scene), 0);
  const maxNarrationDuration = Math.max(60, maxContent - reactionDuration);

  // Tempo 1.0 dipertahankan agar suara dokumenter lebih natural.
  const forcedTempo = narrationDuration > maxNarrationDuration ? narrationDuration / maxNarrationDuration : 1;
  const narrationTempo = clamp(forcedTempo, 1, 1.2);
  const adjustedNarration = narrationDuration ? narrationDuration / narrationTempo : 0;
  const contentDuration = narrationDuration
    ? clamp(adjustedNarration + reactionDuration, 1, maxContent)
    : clamp(requestedContent, 180, maxContent);

  return {
    contentDuration,
    totalDuration: Number((contentDuration + fixedDuration).toFixed(2)),
    narrationTempo,
    adjustedNarrationDuration: adjustedNarration
  };
}

function buildRenderScenes(item, narrationDuration, contentDuration = narrationDuration) {
  const scenes = item.plan.scenes || [];
  const reactionDurations = scenes.map((scene) => scene.sceneType === "reaction" ? estimateReactionDuration(scene) : 0);
  const reactionDurationTotal = reactionDurations.reduce((sum, value) => sum + value, 0);
  const availableNarrationDuration = narrationDuration > 0
    ? narrationDuration
    : Math.max(1, contentDuration - reactionDurationTotal);
  const regularIndexes = scenes.map((scene, index) => scene.sceneType === "reaction" ? -1 : index).filter((index) => index >= 0);
  const regularWeights = regularIndexes.map((index) => Math.max(1, String(scenes[index].narration || "").split(/\s+/).length));
  const regularWeightTotal = regularWeights.reduce((sum, value) => sum + value, 0) || regularIndexes.length || 1;
  let cursor = 0;
  let narrationCursor = 0;
  let regularWeightIndex = 0;

  return scenes.map((scene, index) => {
    const durationSec = scene.sceneType === "reaction"
      ? reactionDurations[index]
      : (regularWeights[regularWeightIndex++] / regularWeightTotal) * availableNarrationDuration;
    const output = {
      ...scene,
      startSec: Number(cursor.toFixed(2)),
      durationSec: Number(durationSec.toFixed(2))
    };
    if (scene.sceneType !== "reaction") {
      output.narrationStartSec = Number(narrationCursor.toFixed(3));
      narrationCursor += durationSec;
      output.narrationEndSec = Number(narrationCursor.toFixed(3));
    }
    cursor += durationSec;
    output.endSec = Number(cursor.toFixed(2));
    return output;
  });
}

function estimateReactionDuration(scene) {
  const words = String(scene.screenText || scene.narration || "").split(/\s+/).filter(Boolean).length;
  return clamp(words / 3.2 + 0.35, 2.8, 4);
}

/**
 * Build timing + render scenes ketika tiap scene punya file audio TTS sendiri.
 * Durasi tiap scene = durasi audio aslinya (plus jeda kecil), sehingga visual,
 * audio, dan subtitle otomatis sinkron. Reaction juga punya suara sendiri.
 */
export async function buildSceneAudioTiming(item, { introDuration = 0, outroDuration = 0, bumperIntroDuration = 0, bumperOutroDuration = 0, coldOpenDuration = 0 } = {}) {
  const scenes = item.plan?.scenes || [];
  const sceneAudio = Array.isArray(item.assets?.sceneAudio) ? item.assets.sceneAudio : [];
  const audioByIndex = new Map(sceneAudio.map((entry) => [Number(entry.sceneIndex), entry]));
  const audioDurations = await Promise.all(scenes.map((scene) => {
    const entry = audioByIndex.get(Number(scene.index));
    return entry?.path ? probeDuration(entry.path) : 0;
  }));
  const fit = item.input?.durationLocked ? fitSceneAudio(scenes, audioDurations,
    item.input.durationSec, introDuration + outroDuration + bumperIntroDuration + bumperOutroDuration + coldOpenDuration) : null;
  if (fit?.status === "enrich") throw new Error("Narasi masih terlalu pendek; tambahkan scene sebelum render.");

  // Jeda minimal di akhir tiap scene: cukup agar audio tidak terpotong,
  // tapi tidak cukup lama untuk terdengar sebagai "jeda diam" yang mengganggu.
  const tailPadByType = { reaction: 0.05, summary: 0.10, image: 0.08 };
  const minDurationByType = { reaction: 2.4, summary: 3.0, image: 1.5 };

  let cursor = 0;
  const renderScenes = [];

  for (const scene of scenes) {
    const entry = audioByIndex.get(Number(scene.index));
    const audioDuration = audioDurations[renderScenes.length];
    const type = scene.sceneType || "image";
    const tailPad = tailPadByType[type] ?? 0.35;
    const minDuration = minDurationByType[type] ?? 1.5;

    const durationSec = fit ? fit.durations[renderScenes.length] : Math.max(minDuration, (audioDuration || estimateReactionDuration(scene)) + tailPad);

    renderScenes.push({
      ...scene,
      sceneAudioPath: entry?.path || null,
      sceneCaptions: scaleCaptionTimes(Array.isArray(entry?.captions) ? entry.captions : [], fit?.tempo || 1),
      narrationTempo: fit?.tempo || 1,
      audioDurationSec: audioDuration / (fit?.tempo || 1),
      startSec: cursor,
      durationSec,
      endSec: cursor + durationSec
    });
    cursor += durationSec;
  }

  const contentDuration = Number(cursor.toFixed(3));
  const fixedDuration = introDuration + outroDuration + bumperIntroDuration + bumperOutroDuration;

  return {
    renderScenes,
    timing: {
      contentDuration,
      totalDuration: Number((contentDuration + fixedDuration).toFixed(2)),
      narrationTempo: fit?.tempo || 1,
      adjustedNarrationDuration: contentDuration
    }
  };
}

/**
 * Bangun audio konten dari potongan audio per scene.
 * Setiap scene (image/summary/reaction) ditempel sesuai durasinya, lalu di-pad
 * dengan silence agar pas dengan durasi visual, dan dicampur musik latar.
 */
export async function makeContentAudioFromScenes({ scenes, musicPath, outputPath, duration, workDir }) {
  const inputs = [];
  const filters = [];
  const partLabels = [];
  let inputIndex = 0;

  scenes.forEach((scene, index) => {
    const label = `part${index}`;
    const sceneDuration = Number(scene.durationSec || 0);
    if (scene.sceneAudioPath) {
      inputs.push("-i", scene.sceneAudioPath);
      const audioInputIdx = inputIndex++;
      // Format ke stereo 44.1k, lalu pad/trim tepat ke durasi scene.
      filters.push(
        `[${audioInputIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,`
        + `atempo=${Number(scene.narrationTempo || 1).toFixed(10)},`
        + `loudnorm=I=-16:TP=-1.5:LRA=9,volume=1.08,`
        + `apad,atrim=duration=${sceneDuration.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`
      );
    } else {
      // Scene tanpa audio (mis. fallback) → silence sepanjang durasinya.
      filters.push(
        `anullsrc=r=44100:cl=stereo,atrim=duration=${sceneDuration.toFixed(3)},asetpts=PTS-STARTPTS[${label}]`
      );
    }
    partLabels.push(`[${label}]`);
  });

  filters.push(`${partLabels.join("")}concat=n=${partLabels.length}:v=0:a=1[timeline]`);

  // Musik latar sebagai input terakhir (looping).
  inputs.push("-stream_loop", "-1", "-t", String(duration), "-i", musicPath);
  const musicInputIdx = inputIndex;
  filters.push(`[${musicInputIdx}:a]volume=${backgroundMusicVolume}[music]`);
  filters.push(`[timeline][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`);

  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[a]",
    "-t", String(duration),
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ], { timeoutMs: 600_000 });
}

// Instrumentasi sinkronisasi visual↔suara. Tanpa angka ini, tidak ada cara tahu
// seberapa sering pencocokan frasa gagal dan render jatuh ke pembagian rata.
const syncStats = { scenes: 0, evenScenes: 0, boundaries: 0, matched: 0 };

/**
 * Cetak satu baris ringkasan hasil pencocokan segmen, lalu reset counter.
 * Dipakai sekali per render supaya rasio fallback terlihat di log CI.
 */
export function logSegmentSyncStats() {
  if (!syncStats.scenes) return null;
  const stats = { ...syncStats };
  const evenPct = Math.round((stats.evenScenes / stats.scenes) * 100);
  const matchPct = stats.boundaries ? Math.round((stats.matched / stats.boundaries) * 100) : 0;
  console.log(`[Sync] ${stats.scenes} scene multi-segmen | fallback rata: ${stats.evenScenes} (${evenPct}%) | batas cocok frasa: ${stats.matched}/${stats.boundaries} (${matchPct}%)`);
  syncStats.scenes = 0;
  syncStats.evenScenes = 0;
  syncStats.boundaries = 0;
  syncStats.matched = 0;
  return stats;
}

/**
 * Hitung durasi tiap sub-segmen visual berdasarkan timestamp kata TTS.
 * Pergantian gambar diselaraskan dengan momen frasa `narrativeContext`
 * segmen itu diucapkan (dari sceneCaptions hasil transkripsi Whisper).
 * Fallback: pembagian rata jika caption/konteks tidak tersedia atau tidak cocok.
 * @returns {number[]} durasi per sub-segmen; totalnya = scene.durationSec.
 */
export function computeSegmentDurations(scene, segmentCount) {
  const total = Number(scene.durationSec || 0);
  if (segmentCount <= 1 || total <= 0) return [Math.max(total, 0)];
  syncStats.scenes += 1;
  const equalSplit = () => {
    syncStats.evenScenes += 1;
    return Array.from({ length: segmentCount }, () => Number((total / segmentCount).toFixed(3)));
  };

  const captions = (Array.isArray(scene.sceneCaptions) ? scene.sceneCaptions : [])
    .filter((cap) => cap && Number(cap.end) > Number(cap.start));
  const segments = Array.isArray(scene.visualSegments) ? scene.visualSegments : [];
  if (!captions.length || segments.length !== segmentCount) return equalSplit();

  const wordTimeline = buildWordTimeline(captions);
  if (wordTimeline.length < segmentCount) return equalSplit();

  // Batas segmen 1..n-1: waktu frasa narrativeContext diucapkan.
  // Segmen pertama selalu mulai di 0; skor < 0.5 dianggap tidak cocok → posisi rata.
  const boundaries = [0];
  for (let i = 1; i < segmentCount; i += 1) {
    const phraseTokens = tokenizeMatchText(segments[i]?.narrativeContext || "");
    let time = (total * i) / segmentCount;
    syncStats.boundaries += 1;
    if (phraseTokens.length) {
      const match = findPhraseTime(wordTimeline, phraseTokens);
      if (match && match.score >= 0.5) {
        time = match.time;
        syncStats.matched += 1;
      }
    }
    boundaries.push(time);
  }
  boundaries.push(total);

  // Jaga urutan monoton + durasi minimum per sub-segmen.
  const minDuration = Math.min(1.2, total / (segmentCount * 2));
  for (let i = 1; i < boundaries.length - 1; i += 1) {
    boundaries[i] = Math.max(boundaries[i], boundaries[i - 1] + minDuration);
  }
  for (let i = boundaries.length - 2; i >= 1; i -= 1) {
    boundaries[i] = Math.min(boundaries[i], boundaries[i + 1] - minDuration);
  }
  for (let i = 1; i < boundaries.length; i += 1) {
    if (boundaries[i] <= boundaries[i - 1]) return equalSplit();
  }

  return boundaries.slice(1).map((bound, i) => Number((bound - boundaries[i]).toFixed(3)));
}

function resolveSceneMedia(item, scene) {
  const sourceIndex = scene.imageSourceSceneIndex || scene.index;

  // Jika scene memiliki overlay device mockup, background WAJIB video (B-roll),
  // BUKAN foto/gambar di atas layar, agar mockup tidak muncul bersamaan dengan gambar di layar.
  const hasMockup = (item.assets?.newsImages || []).some(
    (n) => Number(n.sceneIndex) === Number(sourceIndex) && n.imagePath
  );
  const clip = item.assets?.clips?.find((entry) => Number(entry.sceneIndex) === Number(sourceIndex));

  if (hasMockup) {
    if (clip?.path) {
      return { type: "video", path: clip.path };
    }
    const anyClip = (item.assets?.clips || []).find((c) => c.path);
    if (anyClip?.path) {
      return { type: "video", path: anyClip.path };
    }
  }

  // Aturan Entitas Spesifik: Cek foto riil (Serper / Google Images)
  const realImg = item.assets?.images?.find(
    (entry) => Number(entry.sceneIndex) === Number(sourceIndex)
      && (entry.provider === "google-images" || entry.isRealEntity)
      && isValidImageFileSync(entry.path, { allowMissing: true })
  );

  if (realImg?.path) {
    return {
      type: "image",
      path: realImg.path,
      backgroundVideoPath: clip?.path || null,
      isRealEntity: true
    };
  }

  // Cek jika ada klip video dari Pexels
  if (clip?.path) {
    return { type: "video", path: clip.path };
  }

  // Fallback ke gambar DALL-E
  const image = item.assets?.images?.find((entry) => Number(entry.sceneIndex) === Number(sourceIndex) && isValidImageFileSync(entry.path, { allowMissing: true }));
  if (!image?.path) {
    const anyClip = (item.assets?.clips || []).find((c) => c.path);
    if (anyClip?.path) return { type: "video", path: anyClip.path };
    const anyImage = (item.assets?.images || []).find((img) => isValidImageFileSync(img.path, { allowMissing: true }));
    if (anyImage?.path) return { type: "image", path: anyImage.path };
    throw new Error(`Media (klip video / gambar) untuk scene ${sourceIndex} belum tersedia.`);
  }
  return { type: "image", path: image.path };
}

/**
 * Resolve multi-media per scene berdasarkan visualSegments.
 * Mengembalikan array [{type, path}, ...] — satu per segmen visual.
 * Jika scene tidak punya visualSegments, fallback ke single media.
 */
export function resolveSceneMediaList(item, scene) {
  const sourceIndex = scene.imageSourceSceneIndex || scene.index;
  const rawSegCount = scene.visualSegments?.length || 1;
  const sceneDur = Number(scene.durationSec || 0);
  // Target minimal 2-3 variasi media per scene agar penonton tidak bosan
  const targetCount = sceneDur >= 14 ? Math.max(3, rawSegCount) : (sceneDur >= 7 ? Math.max(2, rawSegCount) : rawSegCount);
  const clips = item.assets?.clips || [];
  const images = item.assets?.images || [];
  const mediaList = [];
  const usedPaths = new Set();

  const hasMockup = (item.assets?.newsImages || []).some(
    (n) => Number(n.sceneIndex) === Number(sourceIndex) && n.imagePath
  );

  // Jika scene memiliki overlay device mockup (phone/tablet), SELURUH segmen scene ini
  // WAJIB menggunakan latar video B-roll (BUKAN foto/gambar), agar mockup tidak pernah
  // saling menimpa dengan gambar latar / hero image card di layar!
  if (hasMockup) {
    for (let i = 0; i < targetCount; i++) {
      const mockupClip = clips.find((c) =>
        Number(c.sceneIndex) === Number(sourceIndex) && c.path && !usedPaths.has(c.path)
      ) || clips.find((c) =>
        Number(c.sceneIndex) === Number(sourceIndex) && c.path
      ) || clips.find((c) =>
        c.path && !usedPaths.has(c.path)
      ) || clips.find((c) => c.path);

      if (mockupClip?.path) {
        mediaList.push({ type: "video", path: mockupClip.path });
        usedPaths.add(mockupClip.path);
      }
    }
    if (mediaList.length > 0) return mediaList;
  }

  for (let i = 0; i < targetCount; i++) {
    // 0. ATURAN ENTITAS SPESIFIK: Cek apakah ada foto riil (Serper / Google Images) untuk scene/segmen ini
    const realImg = images.find((img) =>
      Number(img.sceneIndex) === Number(sourceIndex)
      && (Number(img.segmentIndex || 0) === i || i === 0)
      && img.path
      && (img.isRealEntity || img.provider === "google-images")
      && !usedPaths.has(img.path)
      && isValidImageFileSync(img.path, { allowMissing: true })
    );
    if (realImg?.path) {
      // Cari klip video pendamping sebagai video latar (B-roll)
      const companionClip = clips.find((c) =>
        Number(c.sceneIndex) === Number(sourceIndex) && c.path
      ) || clips.find((c) => c.path && !usedPaths.has(c.path)) || null;

      mediaList.push({
        type: "image",
        path: realImg.path,
        backgroundVideoPath: companionClip?.path || null,
        isRealEntity: true
      });
      usedPaths.add(realImg.path);
      continue;
    }

    // 1. Cari klip yang spesifik untuk segmen ini (dan belum pernah dipakai)
    const clip = clips.find((c) =>
      Number(c.sceneIndex) === Number(sourceIndex) && Number(c.segmentIndex || 0) === i && c.path && !usedPaths.has(c.path)
    );
    if (clip?.path) {
      mediaList.push({ type: "video", path: clip.path });
      usedPaths.add(clip.path);
      continue;
    }

    // 2. Cari gambar untuk segmen ini (dan belum pernah dipakai)
    const image = images.find((img) =>
      Number(img.sceneIndex) === Number(sourceIndex)
      && Number(img.segmentIndex || 0) === i
      && img.path
      && !usedPaths.has(img.path)
      && isValidImageFileSync(img.path, { allowMissing: true })
    );
    if (image?.path) {
      mediaList.push({ type: "image", path: image.path });
      usedPaths.add(image.path);
      continue;
    }

    // 3. Cari klip video lain dari scene ini yang BELUM PERNAH dipakai
    const sceneClips = clips.filter((c) => Number(c.sceneIndex) === Number(sourceIndex) && c.path);
    const unusedSceneClip = sceneClips.find((c) => !usedPaths.has(c.path));
    if (unusedSceneClip?.path) {
      mediaList.push({ type: "video", path: unusedSceneClip.path });
      usedPaths.add(unusedSceneClip.path);
      continue;
    }

    // 4. Cari gambar dari scene ini yang BELUM PERNAH dipakai
    const sceneImages = images.filter((img) => Number(img.sceneIndex) === Number(sourceIndex) && img.path && isValidImageFileSync(img.path, { allowMissing: true }));
    const unusedSceneImg = sceneImages.find((img) => !usedPaths.has(img.path));
    if (unusedSceneImg?.path) {
      mediaList.push({ type: "image", path: unusedSceneImg.path });
      usedPaths.add(unusedSceneImg.path);
      continue;
    }

    // 5. Cari klip video atau gambar dari global assets yang belum pernah dipakai agar visual tetap segar
    const unusedGlobalClip = clips.find((c) => c.path && !usedPaths.has(c.path));
    if (unusedGlobalClip?.path) {
      mediaList.push({ type: "video", path: unusedGlobalClip.path });
      usedPaths.add(unusedGlobalClip.path);
      continue;
    }
    const unusedGlobalImg = images.find((img) => img.path && !usedPaths.has(img.path) && isValidImageFileSync(img.path, { allowMissing: true }));
    if (unusedGlobalImg?.path) {
      mediaList.push({ type: "image", path: unusedGlobalImg.path });
      usedPaths.add(unusedGlobalImg.path);
      continue;
    }

    // 6. JANGAN REUSE KLIP VIDEO YANG SAMA! Gambar dengan zoompan Ken Burns jauh lebih dinamis daripada video berulang.
    const fallbackImg = sceneImages[0] || images.find((img) => isValidImageFileSync(img?.path, { allowMissing: true }));
    if (fallbackImg?.path) {
      mediaList.push({ type: "image", path: fallbackImg.path });
      continue;
    }

    // 7. Terakhir jika hanya ada 1 video dan 0 gambar di seluruh project
    const fallbackClip = sceneClips[0] || clips[0];
    if (fallbackClip?.path) {
      mediaList.push({ type: "video", path: fallbackClip.path });
      continue;
    }
  }

  // Jika mediaList kosong, fallback ke resolveSceneMedia lama
  if (mediaList.length === 0) {
    mediaList.push(resolveSceneMedia(item, scene));
  }

  return mediaList;
}

/**
 * Overlay potret tokoh di atas video selama window spotlight "figure".
 * Portrait diletakkan di sisi kanan kartu Spotlight (koordinat PlayRes 1280x720
 * kemudian di-scale ke resolusi aktual).
 */
async function applyFigureImageOverlays(inputPath, outputPath, figurePlacements, item, resolution) {
  const figureImages = item.assets?.figureImages || {};
  const scale = resolution === "1080p" ? 1.5 : 1;
  // Figure spotlight di tengah layar (PlayRes 1280×720, FIG_X=310, FIG_W=660, FIG_Y=230)
  // Portrait bulat elegan di sisi kiri dalam kartu dengan framing top-bias agar wajah/kepala tidak terpotong
  const portraitSize = Math.round(92 * scale);
  const posX = Math.round((310 + 18) * scale); // FIG_X + 18px margin
  const posY = Math.round((230 + 14) * scale); // FIG_Y + 14px padding

  const overlays = figurePlacements
    .filter((p) => figureImages[p.sceneIndex]?.imagePath && isValidImageFileSync(figureImages[p.sceneIndex].imagePath))
    .map((p) => ({ ...p, imagePath: figureImages[p.sceneIndex].imagePath }));

  if (!overlays.length) {
    // Tidak ada gambar tokoh valid → lewati (copy saja agar pipeline tidak putus)
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  try {
    const args = ["-y", "-i", inputPath];
    overlays.forEach((o) => args.push("-i", o.imagePath));

    const filters = [];
    let prevLabel = "0:v";
    overlays.forEach((o, idx) => {
      const inLabel = `${idx + 1}:v`;
      const outLabel = idx === overlays.length - 1 ? "outv" : `tmp${idx}`;
      const start = o.startSec.toFixed(3);
      const end = o.endSec.toFixed(3);
      filters.push(
        `[${inLabel}]scale=${portraitSize}:${portraitSize}:force_original_aspect_ratio=increase,crop=${portraitSize}:${portraitSize}:(in_w-out_w)/2:if(gt(in_h\\,out_h)\\,(in_h-out_h)*0.12\\,(in_h-out_h)/2),format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),(${portraitSize}/2)*(${portraitSize}/2)),255,0)'[p${idx}]`,
        `[${prevLabel}][p${idx}]overlay=${posX}:${posY}:enable='between(t,${start},${end})'[${outLabel}]`
      );
      prevLabel = outLabel;
    });

    await runFfmpeg([
      ...args,
      "-filter_complex", filters.join(";"),
      "-map", "[outv]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "21",
      "-pix_fmt", "yuv420p",
      outputPath
    ], { timeoutMs: 1_800_000 });
  } catch (err) {
    console.warn(`[FigureOverlay] Gagal menerapkan figure overlay: ${err.message}. Fallback menyalin input visual.`);
    await fs.copyFile(inputPath, outputPath);
  }
}

export async function makeVideoSegment({ videoPath, outputPath, duration, resolution = "720p" }) {
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;
  const targetDuration = Math.max(0.5, Number(duration || 4));
  const overlayPath = config.pexels.overlayEnabled ? config.pexels.overlayPath : "";
  const hasOverlay = overlayPath && await fileExists(overlayPath);

  // Periksa durasi video sumber untuk menghindari looping berulang-ulang
  let sourceDuration = 0;
  try {
    sourceDuration = await probeDuration(videoPath);
  } catch {
    sourceDuration = 0;
  }

  // Jika durasi sumber lebih pendek dari target:
  // JANGAN gunakan -stream_loop!
  // Gunakan setpts (cinematic slow motion) atau tpad clone frame akhir agar video tidak pernah restart/loop dari detik awal.
  let speedPadFilter = "";
  if (sourceDuration > 0 && sourceDuration < targetDuration) {
    const stretch = targetDuration / sourceDuration;
    if (stretch <= 1.75) {
      speedPadFilter = `,setpts=${stretch.toFixed(4)}*PTS`;
    } else {
      const stretchedDur = sourceDuration * 1.35;
      const padSec = Math.max(0.1, targetDuration - stretchedDur);
      speedPadFilter = `,setpts=1.35*PTS,tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}`;
    }
  }

  const baseFilters = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${speedPadFilter},eq=contrast=1.04:saturation=1.06:brightness=0.01,vignette[bg]`,
    `color=c=0xFF8833:s=${width}x${height}:d=1,format=rgba,colorchannelmixer=aa=0.35,fade=t=out:st=0:d=0.7:alpha=1[leak]`,
    "[bg][leak]overlay=format=auto[styled]"
  ];
  const filterComplex = hasOverlay
    ? [
        ...baseFilters,
        `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba,colorkey=0x000000:${config.pexels.blackKeySimilarity.toFixed(3)}:${config.pexels.blackKeyBlend.toFixed(3)},colorchannelmixer=aa=${config.pexels.overlayOpacity.toFixed(3)}[sparks]`,
        "[styled][sparks]overlay=shortest=1:format=auto[outv]"
      ].join(";")
    : [...baseFilters, "[styled]null[outv]"].join(";");

  if (config.pexels.overlayEnabled && !hasOverlay) {
    throw new Error(`Overlay Pexels tidak ditemukan: ${overlayPath}`);
  }

  await runFfmpeg([
    "-y",
    "-i", videoPath,
    ...(hasOverlay ? ["-stream_loop", "-1", "-t", targetDuration.toFixed(3), "-i", overlayPath] : []),
    "-t", targetDuration.toFixed(3),
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-r", String(fps),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    outputPath
  ], { timeoutMs: 60_000 });
}

export async function makeImageSegment({
  imagePath,
  outputPath,
  duration,
  zoomDirection = "in",
  resolution = "720p",
  backgroundVideoPath = null
}) {
  const targetDuration = Math.max(0.5, Number(duration || 4));
  const frames = Math.max(1, Math.round(targetDuration * fps));
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;
  const hasBgVideo = backgroundVideoPath && (await fileExists(backgroundVideoPath));

  // Validasi awal integritas file gambar
  if (!isValidImageFileSync(imagePath)) {
    if (hasBgVideo) {
      console.warn(`[Render] File gambar ${imagePath} tidak valid/rusak. Menggunakan background video sebagai visual.`);
      return makeVideoSegment({ videoPath: backgroundVideoPath, outputPath, duration: targetDuration, resolution });
    }
  }

  // Hero photo memenuhi ~90% kanvas (hampir penuh seukuran video latar)
  const boxW = Math.round(width * 0.90);
  const boxH = Math.round(height * 0.90);

  // Efek bergerak Ken Burns: zoom in atau zoom out halus terdistribusi sepanjang durasi
  const scaleZoom = zoomDirection === "out"
    ? `scale=w='trunc(iw*(1.05-0.05*t/${targetDuration.toFixed(3)})/2)*2':h='trunc(ih*(1.05-0.05*t/${targetDuration.toFixed(3)})/2)*2':eval=frame`
    : `scale=w='trunc(iw*(1.0+0.05*t/${targetDuration.toFixed(3)})/2)*2':h='trunc(ih*(1.0+0.05*t/${targetDuration.toFixed(3)})/2)*2':eval=frame`;

  if (hasBgVideo) {
    const filterComplex = [
      // 1. Background video latar: scale & crop ke canvas, dimmed & blurred
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=brightness=-0.18:contrast=0.95,gblur=sigma=12:steps=1,format=yuv420p[bg]`,
      // 2. Foreground hero photo: fit ke box 90%, preserve aspect ratio, zoom Ken Burns, sleek border
      `[1:v]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[fitted]`,
      `[fitted]${scaleZoom},drawbox=x=0:y=0:w=iw:h=ih:color=white@0.22:t=2,format=yuva420p[fg]`,
      // 3. Overlay foreground di tengah video latar
      `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1[outv]`
    ].join(";");

    try {
      await runFfmpeg([
        "-y",
        "-stream_loop", "-1",
        "-t", targetDuration.toFixed(3),
        "-i", backgroundVideoPath,
        "-loop", "1",
        "-r", String(fps),
        "-t", targetDuration.toFixed(3),
        "-i", imagePath,
        "-filter_complex", filterComplex,
        "-map", "[outv]",
        "-t", targetDuration.toFixed(3),
        "-r", String(fps),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        outputPath
      ], { timeoutMs: 60_000 });
      return;
    } catch (err) {
      console.warn(`[Render] Composite background video gagal (${err.message}).`);
      if (hasBgVideo) {
        console.warn(`[Render] Beralih ke background video sebagai visual segmen.`);
        return makeVideoSegment({ videoPath: backgroundVideoPath, outputPath, duration: targetDuration, resolution });
      }
    }
  }

  // Fallback tanpa background video: Blurred backdrop image + sharp zooming hero card
  const filterComplex = [
    // 1. Latar blurred & darkened dari gambar itu sendiri
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=24:steps=2,eq=brightness=-0.22:contrast=1.05,format=yuv420p[bg]`,
    // 2. Kartu hero foto di depan: preserve aspect ratio, zoom eval=frame, sleek border
    `[0:v]scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[fitted]`,
    `[fitted]${scaleZoom},drawbox=x=0:y=0:w=iw:h=ih:color=white@0.22:t=2,format=yuva420p[fg]`,
    // 3. Overlay di tengah kanvas
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1[outv]`
  ].join(";");

  try {
    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-r", String(fps),
      "-t", targetDuration.toFixed(3),
      "-i", imagePath,
      "-filter_complex", filterComplex,
      "-map", "[outv]",
      "-t", targetDuration.toFixed(3),
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      outputPath
    ], { timeoutMs: 60_000 });
  } catch (error) {
    if (/loop.*not found|option not found/i.test(error.message)) {
      console.warn(`[Render] File ${imagePath} ditolak opsi loop gambar, mencoba render sebagai video: ${error.message}`);
      return makeVideoSegment({ videoPath: imagePath, outputPath, duration: targetDuration, resolution });
    }
    if (hasBgVideo) {
      console.warn(`[Render] Render gambar gagal (${error.message}), fallback ke background video.`);
      return makeVideoSegment({ videoPath: backgroundVideoPath, outputPath, duration: targetDuration, resolution });
    }
    throw error;
  }
}

/**
 * Visual cold open: pakai media scene (klip Pexels atau gambar AI), diberi sedikit
 * gelap supaya teks hook terbaca jelas. Gambar diam tetap di-Ken Burns agar hidup.
 */
async function makeColdOpenVisual({ media, outputPath, duration, zoomDirection, resolution = "720p" }) {
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;
  if (media.type === "video") {
    await runFfmpeg([
      "-y",
      "-stream_loop", "-1",
      "-i", media.path,
      "-t", String(duration),
      "-vf", [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        "eq=contrast=1.05:saturation=1.06:brightness=0.01",
        "vignette",
        "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.30:t=fill",
        "format=yuv420p"
      ].join(","),
      "-r", String(fps),
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      outputPath
    ]);
    return;
  }

  const frames = Math.max(1, Math.round(duration * fps));
  const zoomExpr = zoomDirection === "out"
    ? `if(eq(on,0),1.08,max(1.0,zoom-0.0005))`
    : `min(1.0+on*0.0005,1.08)`;
  try {
    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-i", media.path,
      "-vf", [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        `crop=${width}:${height}`,
        `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`,
        "eq=contrast=1.05:saturation=1.06:brightness=0.01",
        "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.30:t=fill"
      ].join(","),
      "-frames:v", String(frames),
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
      outputPath
    ]);
  } catch (error) {
    if (/loop.*not found|option not found/i.test(error.message)) {
      console.warn(`[ColdOpen] File ${media.path} ditolak opsi loop gambar, mencoba render sebagai video: ${error.message}`);
      return makeColdOpenVisual({ media: { ...media, type: "video" }, outputPath, duration, zoomDirection, resolution });
    }
    throw error;
  }
}

/**
 * Caption hook untuk cold open — teks besar di tengah memakai style "Hook".
 */
async function writeColdOpenCaptionAss({ outputPath, hookText, duration }) {
  // Hook flash-forward sekarang boleh sampai 15-25 kata, jadi budget tetap
  // "26 karakter x 4 baris" bisa kepotong untuk hook yang lebih panjang.
  // fitOverlayText() turun ke font lebih kecil/baris lebih banyak dulu,
  // dan tier terakhirnya menjamin teks tidak pernah hilang atau terpotong.
  const fit = fitOverlayText(normalizeSubtitleText(hookText), HOOK_CAPTION_TIERS);
  const end = Math.max(0.4, duration - 0.15);
  const events = [
    dialogue(0.15, end, "Hook", `{\\fad(240,200)\\fs${fit.fontSize}}${assEscape(fit.text)}`)
  ];
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Hook,${config.render.fontTitle},48,&H00FFFFFF,&H000000FF,&H98232A32,&HBB11171C,-1,0,0,0,100,100,0,0,1,3,1,5,90,90,90,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
  ].join("\n");
  await fs.writeFile(outputPath, ass, "utf8");
}

/**
 * Audio cold open: suara hook (bila ada) dicampur musik latar yang sedikit lebih
 * keras dari biasanya agar pembuka terasa "punya energi". Tanpa suara → musik saja.
 */
async function makeColdOpenAudio({ hookAudioPath, musicPath, outputPath, duration }) {
  if (!hookAudioPath) {
    await makeContentAudioOnlyMusic({ musicPath, outputPath, duration });
    return;
  }
  await runFfmpeg([
    "-y",
    "-i", hookAudioPath,
    "-stream_loop", "-1",
    "-i", musicPath,
    "-filter_complex",
    [
      `[0:a]aformat=sample_rates=44100:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=9,volume=1.1[speech]`,
      `[1:a]volume=${(backgroundMusicVolume * 1.4).toFixed(3)}[music]`,
      // duration=longest (bukan first): [speech] (hook TTS) sering LEBIH PENDEK dari slot
      // coldOpenDuration yang sudah dipesan untuk visualnya. Dengan "first", sisa musik latar
      // ikut terpotong ke panjang speech, lalu -shortest di muxVideoAudio memotong video juga
      // -> durasi final hilang ~1 detik. "longest" membiarkan musik (di-loop -1) mengisi sisa
      // slot; -t di bawah tetap membatasi ke panjang persis yang dipesan.
      `[speech][music]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]`
    ].join(";"),
    "-map", "[a]",
    "-t", String(duration),
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    outputPath
  ]);
}

async function makeReactionSegment({ reactionPath, outputPath, duration, resolution = "720p" }) {
  const width = resolution === "1080p" ? 1920 : 1280;
  const height = resolution === "1080p" ? 1080 : 720;
  const targetDuration = Math.max(0.5, Number(duration || 4));
  let sourceDuration = 0;
  try {
    sourceDuration = await probeDuration(reactionPath);
  } catch {
    sourceDuration = 0;
  }

  // Jika durasi audio narasi reaksi lebih panjang dari klip:
  // JANGAN me-looping video reaksi dari detik 0!
  // Tahan frame reaksi ekspresi terakhir (tpad clone) agar ekspresi tetap natural.
  const reactionFilters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`
  ];
  if (sourceDuration > 0 && sourceDuration < targetDuration) {
    const padSec = (targetDuration - sourceDuration).toFixed(3);
    reactionFilters.push(`tpad=stop_mode=clone:stop_duration=${padSec}`);
  }
  reactionFilters.push(
    "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.16:t=fill",
    "format=yuv420p"
  );

  const maxOffset = sourceDuration > targetDuration ? Math.max(0, sourceDuration - targetDuration - 0.05) : 0;
  const startOffset = maxOffset > 0.5 ? Math.random() * Math.min(maxOffset, 1.5) : 0;

  await runFfmpeg([
    "-y",
    ...(startOffset > 0 ? ["-ss", startOffset.toFixed(2)] : []),
    "-i", reactionPath,
    "-t", targetDuration.toFixed(3),
    "-vf", reactionFilters.join(","),
    "-r", String(fps),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    outputPath
  ], { timeoutMs: 60_000 });
}

async function concatSegments(segmentPaths, outputPath) {
  const listPath = `${outputPath}.txt`;
  const list = segmentPaths.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, `${list}\n`, "utf8");
  await runFfmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    outputPath
  ]);
}

async function burnSubtitles({ inputPath, assPath, outputPath }) {
  const subtitlePath = filterPath(path.relative(paths.rootDir, assPath));
  const fontDir = filterPath(path.relative(paths.rootDir, paths.fontDir));
  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-vf", `ass=filename='${subtitlePath}':fontsdir='${fontDir}'`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    outputPath
  ], { timeoutMs: 1_800_000 });
}

async function addLogoWatermark({ inputPath, outputPath, resolution = "720p" }) {
  const logoPath = path.join(paths.publicDir, "assets", "banyaktau-logo-watermark.png");
  try {
    await fs.access(logoPath);
  } catch {
    await fs.copyFile(inputPath, outputPath);
    return;
  }

  const logoWidth = resolution === "1080p" ? 270 : 180;
  const logoMargin = resolution === "1080p" ? 45 : 30;

  await runFfmpeg([
    "-y",
    "-i", inputPath,
    "-i", logoPath,
    "-filter_complex",
    [
      `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=0.72[wm]`,
      `[0:v][wm]overlay=W-w-${logoMargin}:${logoMargin}:format=auto[v]`
    ].join(";"),
    "-map", "[v]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "21",
    "-pix_fmt", "yuv420p",
    outputPath
  ], { timeoutMs: 1_800_000 });
}

async function findBackgroundMusic() {
  const candidates = [
    path.join(paths.rootDir, "assets", "music", "Marimba Curiosity Case (5 Minute Version).mp3"),
    process.env.BANYAKTAU_MUSIC_PATH,
    path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.m4a"),
    path.join(paths.rootDir, "assets", "music", "eksplorasi-literasi.mp3")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return "";
}

async function muxVideoAudio({ videoPath, audioPath, outputPath }) {
  await runFfmpeg([
    "-y",
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    outputPath
  ], { timeoutMs: 600_000 });
}

export async function writeContentCaptionAss({ outputPath, item, scenes, contentDuration }) {
  const events = [];
  // Pojok kiri atas menampilkan label BAB yang sedang berjalan (bukan judul video
  // statis) — judulnya sendiri sudah tampil di thumbnail/judul YouTube, jadi
  // mengulanginya sepanjang video tidak menambah info. Label berganti otomatis
  // tiap bab berpindah, memberi penonton orientasi "sedang di bagian mana".
  const chapterGroups = groupScenesForChapterOverlay(scenes);
  chapterGroups.forEach((group, i) => {
    const start = i === 0 ? 0.05 : group.startSec + 0.05;
    const end = Math.min(contentDuration - 0.1, group.endSec);
    if (end <= start + 0.3) return;
    const label = chapterOverlayLabel(i + 1, group.label);
    events.push(dialogue(
      start,
      end,
      "SceneTitle",
      `{\\fad(150,150)\\fs${label.fontSize}}${assEscape(label.text)}`
    ));
  });

  for (const scene of scenes) {
    const headline = headlineCardForScene(scene);
    if (headline) {
      const start = scene.startSec + 0.35;
      const end = Math.min(scene.endSec - 0.15, start + 6);
      if (end > start + 0.5) {
        events.push(
          dialogue(start, end, "HeadlineKicker", `{\\fad(140,180)}${assEscape("SUMBER BERITA")}`),
          dialogue(start, end, "HeadlineText", `{\\fad(140,180)}${assEscape(splitLines(headline.headline, 54, 3).join("\\N"))}`),
          dialogue(start, end, "HeadlineSource", `{\\fad(140,180)}${assEscape(headline.outlet)}`)
        );
      }
    }
    if (scene.sceneType === "reaction") {
      let promptText = cleanText(scene.reactionText || scene.screenText || scene.narration || "", 180);
      const isGeneric = !promptText
        || isGenericStoryboardText(promptText)
        || /^(fakta|hal yang berubah|babak|scene|bagian)\b/i.test(promptText);
      if (isGeneric) {
        const fallbacks = [
          "Tapi kenapa tanda penting ini sempat diabaikan?",
          "Lalu, apa yang sebenarnya terjadi setelah itu?",
          "Di sinilah ceritanya mulai berbalik. Apa penyebab utamanya?",
          "Pertanyaannya, apa dampak paling mengejutkan yang terjadi?",
          "Tapi benarkah dampaknya sebesar yang diperkirakan?",
          "Lalu, bagaimana awal mula semua ini bisa terjadi?"
        ];
        const idx = typeof scene.index === "number" ? scene.index - 1 : 0;
        promptText = fallbacks[Math.max(0, idx) % fallbacks.length];
      } else if (!/[?]$/.test(promptText.trim())) {
        promptText = `${promptText.replace(/[.!]+$/g, "")}?`;
      }
      const prompt = splitLines(promptText, 34, 3).join("\\N");
      events.push(dialogue(
        scene.startSec + 0.08,
        Math.max(scene.startSec + 0.3, scene.endSec - 0.08),
        "ReactionPrompt",
        `{\\fad(120,160)}${assEscape(prompt)}`
      ));
    }
    if (scene.sceneType === "summary") {
      const summary = splitLines(outroSummaryText(item).replace(/\\N/g, " "), 48, 4).join("\\N");
      const points = (item.plan?.importantPoints || [])
        .map((point) => normalizeSubtitleText(point))
        .filter(Boolean)
        .slice(0, 3)
        .map((point) => splitLines(`- ${point.replace(/[.]+$/g, "")}`, 54, 2).join("\\N  "))
        .join("\\N");
      events.push(dialogue(
        scene.startSec + 0.08,
        Math.max(scene.startSec + 0.3, scene.endSec - 0.08),
        "SummaryDim",
        "{\\an7\\pos(0,0)\\p1}m 0 0 l 1280 0 l 1280 720 l 0 720"
      ));
      events.push(dialogue(
        scene.startSec + 0.2,
        Math.max(scene.startSec + 0.5, scene.endSec - 0.1),
        "SummaryTitle",
        "{\\fad(150,180)}Ringkasan Inti"
      ));
      events.push(dialogue(
        scene.startSec + 0.55,
        Math.max(scene.startSec + 0.8, scene.endSec - 0.1),
        "SummaryText",
        `{\\fad(150,180)}${assEscape(summary)}`
      ));
      if (points) {
        events.push(dialogue(
          scene.startSec + 1.0,
          Math.max(scene.startSec + 1.3, scene.endSec - 0.1),
          "SummaryPoints",
          `{\\fad(150,180)}${assEscape(points)}`
        ));
      }
    }
  }

  // Kartu Spotlight: hanya muncul di titik yang lolos pencocokan frasa.
  // Kecualikan scene yang memiliki mockup perangkat agar kartu spotlight tidak saling menimpa mockup di tengah layar.
  const mockupSceneIndexes = new Set(
    (item?.assets?.newsImages || [])
      .filter((n) => n.imagePath)
      .map((n) => Number(n.sceneIndex))
  );
  const spotlightPlacements = planSceneSpotlights(scenes, {
    excludedSceneIndexes: mockupSceneIndexes
  });
  events.push(...spotlightDialogueLines(spotlightPlacements, dialogue, assEscape));
  logSpotlightStats();

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Hook,${config.render.fontTitle},42,&H00FFFFFF,&H000000FF,&H98232A32,&HBB11171C,-1,0,0,0,100,100,0,0,1,2.5,0,5,60,60,90,1`,
    `Style: SceneTitle,${config.render.fontTitle},30,&H00F7F2DC,&H000000FF,&H90222A2C,&HAA15191D,-1,0,0,0,100,100,0,0,1,2,0,7,56,220,62,1`,
    `Style: Subtitle,${config.render.fontBody},42,&H00FFFFFF,&H000000FF,&H9A11171B,&HBF11171B,-1,0,0,0,100,100,0,0,1,3,1,2,92,92,58,1`,
    `Style: ReactionPrompt,${config.render.fontBody},46,&H00FFFFFF,&H000000FF,&H9011171B,&HCC11171B,-1,0,0,0,100,100,0,0,3,18,0,2,120,120,72,1`,
    `Style: SummaryDim,${config.render.fontBody},20,&H76000000,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SummaryTitle,${config.render.fontBody},44,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2,0,8,80,80,80,1`,
    `Style: SummaryText,${config.render.fontBody},29,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,8,120,120,170,1`,
    `Style: SummaryPoints,${config.render.fontBody},27,&H00F7F2DC,&H000000FF,&H9011171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,8,140,140,330,1`,
    `Style: Point,${config.render.fontBody},44,&H00FFFFFF,&H000000FF,&H8F11171B,&HCC11171B,-1,0,0,0,100,100,0,0,3,10,0,5,80,80,0,1`,
    `Style: HeadlineKicker,${config.render.fontMono},18,&H004CC8F5,&H000000FF,&H0011171B,&HDA11171B,-1,0,0,0,100,100,1,0,3,12,0,7,220,220,174,1`,
    `Style: HeadlineText,${config.render.fontBody},28,&H00FFFFFF,&H000000FF,&H0011171B,&HDA11171B,-1,0,0,0,100,100,0,0,3,12,0,7,220,220,205,1`,
    `Style: HeadlineSource,${config.render.fontMono},18,&H00F7F2DC,&H000000FF,&H0011171B,&HDA11171B,0,0,0,0,100,100,0,0,3,12,0,7,220,220,315,1`,
    ...spotlightStyles(),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
  ].join("\n");

  await fs.writeFile(outputPath, ass, "utf8");
  return { spotlightPlacements };
}

export function headlineCardForScene(scene) {
  const source = scene?.mediaSource;
  if (scene?.sceneType !== "image" || !source?.outlet || !source?.headline) return null;
  const outlet = String(source.outlet).trim();
  if (!String(scene.narration || "").toLocaleLowerCase("id-ID").includes(outlet.toLocaleLowerCase("id-ID"))) return null;
  return { outlet, headline: String(source.headline).trim() };
}

async function writeOutroCaptionAss({ outputPath, item, duration }) {
  const events = [];
  const fade = "{\\fad(180,220)}";
  const summary = outroSummaryText(item);
  const points = outroPointText(item);

  events.push(
    dialogue(0, duration, "OutroDim", `${fade}{\\an7\\pos(0,0)\\p1}m 0 0 l 1280 0 l 1280 720 l 0 720`),
    dialogue(0.16, duration, "OutroKicker", `${fade}{\\an5\\pos(640,150)}${assEscape("RINGKASAN KUNCI")}`),
    dialogue(0.38, duration, "OutroSummary", `${fade}{\\an5\\pos(640,300)}${assEscape(summary)}`)
  );

  if (points) {
    events.push(dialogue(0.78, duration, "OutroPoint", `${fade}{\\an5\\pos(640,480)}${assEscape(points)}`));
  }

  events.push(dialogue(Math.max(0, duration - 1.15), duration, "OutroBrand", `{\\fad(120,220)}{\\an3\\pos(1220,660)}${assEscape("BanyakTau")}`));

  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1280",
    "PlayResY: 720",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: OutroDim,${config.render.fontBody},20,&H82000000,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: OutroCard,${config.render.fontBody},20,&H1811171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: OutroAccent,${config.render.fontBody},20,&H004CC8F5,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: OutroKicker,${config.render.fontMono},22,&H004CC8F5,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.5,0,5,60,60,540,1`,
    `Style: OutroTitle,${config.render.fontTitle},36,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2,0,7,60,60,570,1`,
    `Style: OutroSummary,${config.render.fontBody},28,&H00FFFFFF,&H000000FF,&H9211171B,&H0011171B,-1,0,0,0,100,100,0,0,1,2,0,5,60,60,350,1`,
    `Style: OutroPoint,${config.render.fontBody},24,&H00F7F2DC,&H000000FF,&H9511171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.8,0,5,60,60,190,1`,
    `Style: OutroBrand,${config.render.fontMono},22,&H004CC8F5,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.5,0,3,60,60,60,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
  ].join("\n");

  await fs.writeFile(outputPath, ass, "utf8");
}

function outroSummaryText(item) {
  const summary = normalizeOutroText(item.plan?.summary);
  const points = (item.plan?.importantPoints || []).map(normalizeOutroText).filter(Boolean);
  const fallback = points.length
    ? points.join(". ")
    : normalizeOutroText(item.plan?.scenes?.at(-1)?.narration || item.plan?.hook || "Simpan inti fakta ini dan cari tahu lebih banyak.");
  const text = compactOutroSummary(summary.length >= 80 ? summary : fallback, points);
  return wrapOutroLines(text, 48, 4, { truncate: false }).join("\\N");
}

function outroPointText(item) {
  const points = (item.plan?.importantPoints || [])
    .map(normalizeOutroText)
    .filter(Boolean)
    .filter((point) => point.length >= 18)
    .slice(0, 2);
  return points.map((point) => splitLines(`- ${point.replace(/[.]+$/g, "")}`, 48, 2).join("\\N  ")).join("\\N");
}

function normalizeOutroText(value) {
  return normalizeSubtitleText(value)
    .replace(/^intinya,\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactOutroSummary(value, points = []) {
  const text = normalizeOutroText(value);
  const completeSentences = sentenceList(text);
  const pointSentences = points
    .map((point) => ensureSentence(point.replace(/[.]+$/g, "")))
    .filter(Boolean);
  const candidates = [
    completeSentences.length >= 2 ? `${completeSentences[0]} ${completeSentences[1]}` : "",
    completeSentences[0] || "",
    ...pointSentences,
    text ? ensureSentence(text.replace(/[.]+$/g, "")) : ""
  ].filter(Boolean);

  for (const candidate of uniqueStrings(candidates)) {
    if (fitsOutroSummary(candidate)) return candidate;
  }

  return shortenOutroSentence(candidates[0] || "Simpan inti faktanya dan cari tahu lebih banyak.");
}

function sentenceList(value) {
  return (normalizeOutroText(value).match(/[^.!?]+[.!?]+/g) || [])
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function ensureSentence(value) {
  const text = normalizeOutroText(value).replace(/[,:;]+$/g, "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeOutroText(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fitsOutroSummary(value) {
  return wrapOutroLines(value, 48, Number.POSITIVE_INFINITY, { truncate: false }).length <= 4;
}

function shortenOutroSentence(value) {
  const words = normalizeOutroText(value).replace(/[.]+$/g, "").split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 48 && line) {
      lines.push(line);
      if (lines.length >= 4) break;
      line = word;
    } else {
      line = next;
    }
  }
  if (lines.length < 4 && line) lines.push(line);
  return ensureSentence(lines.join(" "));
}

function wrapOutroLines(value, maxChars, maxLines, options = {}) {
  const words = normalizeOutroText(value).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  if (options.truncate === false) return lines;
  const limited = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    const last = limited.at(-1) || "";
    if (last.length < 12) limited.pop();
    else limited[limited.length - 1] = last.replace(/[,:;]+$/g, "").trim();
  }
  return limited;
}

function shortenOverlayLine(value) {
  const text = polishOverlayLine(normalizeSubtitleText(value));
  if (text.length <= 44) return text;
  const clipped = text.slice(0, 44);
  const atSpace = clipped.lastIndexOf(" ");
  return clipped.slice(0, atSpace > 28 ? atSpace : clipped.length).trim();
}

function polishOverlayLine(value) {
  const text = String(value || "")
    .replace(/\.$/, "")
    .trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

/**
 * Segmen subtitle untuk seluruh narasi yang terdengar (semua tipe scene).
 * Dipakai untuk sidecar .srt, bukan untuk dibakar ke gambar.
 */
export function sceneCaptionSegments(scenes) {
  return scenes
    .flatMap((scene) => {
      // Gunakan timestamp transkripsi asli per scene bila tersedia (mode TTS per scene).
      const captions = Array.isArray(scene.sceneCaptions) ? scene.sceneCaptions : [];
      const audioDuration = Number(scene.audioDurationSec || 0);

      const reliable = captions.length > 0 && audioDuration > 0 &&
        captions.every((c) =>
          (c.avgLogprob ?? -0.2) > -0.5 &&
          (c.noSpeechProb ?? 0) < 0.6
        );

      if (reliable) {
        return captions
          .filter((entry) => entry.text && Number(entry.end) > Number(entry.start))
          .flatMap((entry) => captionSegments(
            entry.text,
            scene.startSec + Number(entry.start),
            Math.min(scene.endSec - 0.05, scene.startSec + Number(entry.end))
          ));
      }

      // Fallback: pakai naskah sumber yang sudah normalisasi supaya subtitle selalu cocok dengan yang dibaca.
      const sourceText = normalizeTtsText(scene.narration || scene.screenText || "");
      return captionSegments(
        sourceText,
        scene.startSec + 0.05,
        Math.max(scene.startSec + 0.4, scene.endSec - 0.05)
      );
    });
}

function captionSegments(text, start, end) {
  const normalizedText = normalizeSubtitleText(text);
  const words = normalizedText.split(/\s+/).filter(Boolean);
  const duration = Math.max(0.1, end - start);
  if (!words.length || duration <= 0.2) return [];

  // Untuk video panjang horizontal, tampilkan 4-6 kata sekaligus agar subtitle besar tetap lega.
  const chunkSize = 5;
  const chunks = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    chunks.push(words.slice(index, index + chunkSize).join(" "));
  }
  if (chunks.length > 1 && chunks.at(-1).split(/\s+/).filter(Boolean).length < 3) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] = `${chunks.at(-1)} ${tail}`;
  }

  const totalWords = chunks.reduce((sum, chunk) => sum + chunk.split(/\s+/).filter(Boolean).length, 0) || 1;
  let cursor = start;
  return chunks.map((chunk, index) => {
    const weight = chunk.split(/\s+/).filter(Boolean).length / totalWords;
    const isLast = index === chunks.length - 1;
    const next = isLast ? end : Math.min(end, cursor + duration * weight);
    const segment = {
      start: cursor,
      end: Math.max(cursor + 0.35, next - 0.04),
      text: splitLines(normalizeSubtitleText(chunk), 34, 2).join("\\N")
    };
    cursor = next;
    return segment;
  });
}

function normalizeSubtitleText(value) {
  return String(value || "")
    .replace(/\bKesimpulan\s+Singkat\b/gi, "Fakta Utama")
    .replace(/\bkesimpulan\b/gi, "intinya")
    .replace(/\bekstrim\b/gi, "ekstrem")
    .replace(/\brapih\b/gi, "rapi")
    .replace(/\blembab\b/gi, "lembap")
    .replace(/\bnggak\b/gi, "tidak")
    .replace(/\bkayak\b/gi, "seperti")
    .replace(/\bkm\/jam\b/gi, "kilometer per jam")
    .replace(/\bkm\/h\b/gi, "kilometer per jam")
    .replace(/°C/g, "derajat Celcius")
    .replace(/([.!?])\1+/g, "$1")
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// Coba beberapa kombinasi (lebar baris, jumlah baris, ukuran font) berurutan;
// pakai yang pertama yang menampung SELURUH teks tanpa kehilangan kata. Kalau
// tidak ada satu pun yang cukup, tier terakhir dipaksa tanpa batas baris — teks
// tidak boleh pernah terpotong diam-diam (splitLines() sendiri MEMBUANG baris
// yang melebihi maxLines, jadi dipanggil naif itu bisa memotong teks).
function fitOverlayText(text, tiers) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const totalWords = clean.split(/\s+/).filter(Boolean).length;
  for (const tier of tiers) {
    const lines = splitLines(clean, tier.maxChars, tier.maxLines);
    const coveredWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
    if (coveredWords >= totalWords) return { text: lines.join("\\N"), fontSize: tier.fontSize };
  }
  const last = tiers[tiers.length - 1];
  return { text: splitLines(clean, last.maxChars, 99).join("\\N"), fontSize: last.fontSize };
}

// Hook cold-open (flash-forward) 15-25 kata. Coba tampilan besar dulu, turun
// ke font lebih kecil/baris lebih banyak kalau perlu, tapi jangan pernah
// membuang isinya.
const HOOK_CAPTION_TIERS = [
  { maxChars: 24, maxLines: 3, fontSize: 52 },
  { maxChars: 30, maxLines: 4, fontSize: 44 },
  { maxChars: 36, maxLines: 5, fontSize: 38 },
  { maxChars: 44, maxLines: 6, fontSize: 32 }
];

// Kartu judul/bab kadang panjang (hook flash-forward 15-25 kata, nama bab dari
// AI sampai 80 karakter). Coba muat di tampilan ringkas dulu, turun ke font
// lebih kecil kalau perlu, tapi jangan pernah membuang isinya.
const CHAPTER_LABEL_TIERS = [
  { maxChars: 20, maxLines: 4, fontSize: 22 },
  { maxChars: 26, maxLines: 6, fontSize: 18 }
];

function chapterOverlayLabel(number, name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().toUpperCase();
  return fitOverlayText(`BAB ${number} · ${clean}`, CHAPTER_LABEL_TIERS);
}

// Kelompokkan scene render (sudah punya startSec/endSec) jadi rentang waktu per
// bab yang berurutan, untuk dipakai label overlay yang berganti otomatis.
// Beda dari buildChapterList (dipakai untuk daftar bab di deskripsi YouTube):
// fungsi ini butuh endSec per kelompok juga, bukan cuma startSec.
function groupScenesForChapterOverlay(scenes) {
  const groups = [];
  for (const scene of scenes || []) {
    const label = polishOverlayLine(scene.chapter || "");
    if (!label) continue;
    const last = groups.at(-1);
    if (last && last.label === label) {
      last.endSec = Number(scene.endSec ?? last.endSec);
      continue;
    }
    groups.push({ label, startSec: Number(scene.startSec || 0), endSec: Number(scene.endSec ?? scene.startSec ?? 0) });
  }
  // Gabungkan bab yang mulainya terlalu rapat (<10s) supaya label tidak berkedip cepat.
  const merged = [];
  for (const group of groups) {
    const previous = merged.at(-1);
    if (previous && group.startSec - previous.startSec < 10) {
      previous.endSec = group.endSec;
      continue;
    }
    merged.push({ ...group });
  }
  return merged;
}

function dialogue(start, end, style, text) {
  return `Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`;
}

/**
 * Sidecar .srt berisi narasi bahasa sumber. Dengan satu track ini YouTube bisa
 * menerjemahkan subtitle otomatis ke semua bahasa, jadi penonton luar tidak
 * lagi menonton tanpa teks. Timing memakai hasil transkripsi Whisper; kalau
 * transkripsi tidak andal, teks tetap benar dengan timing perkiraan.
 *
 * ponytail: hanya mencakup scene konten. Hook cold-open sudah punya teks
 * terbakar di layar, dan intro/outro presenter tidak punya naskah di pipeline
 * sehingga tidak bisa dijadikan caption. Upgrade: transkripsi kedua aset itu
 * sekali lalu simpan naskahnya di samping filenya.
 */
async function writeSrtFile(outputPath, segments, offsetSec) {
  const body = buildSrtBody(segments, offsetSec);
  if (!body) return "";
  await fs.writeFile(outputPath, body, "utf8");
  return outputPath;
}

export function buildSrtBody(segments, offsetSec = 0) {
  const usable = segments.filter((segment) => segment.text && segment.end > segment.start);
  return usable
    .map((segment, index) => {
      // Cue yang tumpang tindih bisa membuat YouTube menolak seluruh track,
      // jadi akhir cue dipotong tepat sebelum cue berikutnya mulai.
      const next = usable[index + 1];
      const end = next ? Math.min(segment.end, next.start) : segment.end;
      return [
        String(index + 1),
        `${srtTime(offsetSec + segment.start)} --> ${srtTime(offsetSec + Math.max(segment.start + 0.05, end))}`,
        segment.text.replace(/\\N/g, "\n"),
        ""
      ].join("\n");
    })
    .join("\n");
}

export function srtTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  const ms = Math.floor((value - Math.floor(value)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Daftar bab untuk deskripsi YouTube. Aturan YouTube: bab pertama wajib 00:00,
 * minimal 3 bab, dan tiap bab minimal 10 detik. Kalau tidak lolos → kosong
 * supaya deskripsi tidak berisi timestamp yang diabaikan YouTube.
 */
export function buildChapterList(scenes, frontDuration, totalDuration) {
  const groups = [];
  for (const scene of scenes) {
    const label = polishOverlayLine(scene.chapter || "");
    if (!label || groups.at(-1)?.label === label) continue;
    groups.push({ label, startSec: Number(frontDuration || 0) + Number(scene.startSec || 0) });
  }
  if (!groups.length) return [];
  groups[0].startSec = 0;

  const merged = [];
  for (const group of groups) {
    const previous = merged.at(-1);
    if (previous && group.startSec - previous.startSec < 10) continue;
    merged.push(group);
  }
  if (merged.length < 3 || Number(totalDuration || 0) - merged.at(-1).startSec < 10) return [];
  return merged.map((group) => ({ time: chapterTimecode(group.startSec), label: group.label }));
}

function chapterTimecode(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  const cs = Math.floor((value - Math.floor(value)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(value) {
  return String(value || "")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function filterPath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/'/g, "\\'")
    .replace(/^([A-Za-z]):/, "$1\\\\:");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function atempoFilters(tempo) {
  const value = clamp(Number(tempo || 1), 0.5, 2);
  if (Math.abs(value - 1) < 0.01) return [];
  return [`atempo=${value.toFixed(3)}`];
}

export async function probeDuration(filePath) {
  const output = await runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { timeoutMs: 30_000 });
  return Number.parseFloat(output.trim()) || 0;
}

async function runFfmpeg(args, options = {}) {
  await runCommand("ffmpeg", args, options);
}

export function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 300_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd: paths.rootDir });
    const MAX_BUFFER = 64 * 1024;
    let stdout = "";
    let stderr = "";
    let timer = null;
    let settled = false;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        const lastErr = stderr.slice(-1000).trim();
        reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s${lastErr ? `: ${lastErr}` : ""}`));
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-MAX_BUFFER);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_BUFFER);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        if (code === 0) resolve(stdout || stderr);
        else {
          const detail = stderr.slice(-2000).trim() || signal || `${command} gagal (${code})`;
          reject(new Error(detail));
        }
      }
    });
  });
}
