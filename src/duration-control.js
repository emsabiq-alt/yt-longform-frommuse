// Duration fitting never removes narration. Large shortfalls require more story.
export const MIN_FIT_TEMPO = 0.98;
export const MAX_FIT_TEMPO = 1.12;
export const DURATION_TOLERANCE_SEC = Number(process.env.YT_DURATION_TOLERANCE_SEC || 4);
export const MAX_ENRICHED_SCENES = 60;
export const MAX_ENRICHMENT_ATTEMPTS = 4;

export function sceneTailPad(type) {
  return ({ reaction: 0.05, summary: 0.10, image: 0.08 })[type] ?? 0.08;
}

export function quantizeDurations(durations, fps = 30) {
  const exact = durations.map((value) => Number(value) * fps);
  const frames = exact.map(Math.floor);
  const total = Math.round(exact.reduce((sum, value) => sum + value, 0));
  const order = exact.map((value, index) => ({ index, fraction: value - frames[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  const remaining = total - frames.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i++) frames[order[i].index]++;
  return frames.map((value) => value / fps);
}

export function fitSceneAudio(scenes, audioDurations, targetSec, fixedSec = 0) {
  if (!scenes.length || scenes.length !== audioDurations.length ||
      audioDurations.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Penguncian durasi memerlukan audio valid untuk setiap scene.");
  }
  const contentTarget = Math.round((targetSec - fixedSec) * 30) / 30;
  if (!(contentTarget > 0)) throw new Error("Durasi pembuka/penutup melebihi target video.");
  const pads = scenes.map((scene) => sceneTailPad(scene.sceneType));
  const atTempo = (tempo) => audioDurations.map((duration, i) => duration / tempo + pads[i]);
  const totalAt = (tempo) => atTempo(tempo).reduce((sum, value) => sum + value, 0);
  const rawAudioSec = audioDurations.reduce((sum, value) => sum + value, 0);
  if (totalAt(MIN_FIT_TEMPO) < contentTarget) {
    return { status: "enrich", rawAudioSec, contentTarget,
      missingSec: Math.max(0, contentTarget * 1.02 - totalAt(1)) };
  }
  if (totalAt(MAX_FIT_TEMPO) > contentTarget) {
    throw new Error(`Narasi terlalu panjang untuk target ${targetSec}s dengan koreksi tempo maksimal ${MAX_FIT_TEMPO}x. Storyboard tetap utuh; render dihentikan sebelum publikasi.`);
  }
  let low = MIN_FIT_TEMPO;
  let high = MAX_FIT_TEMPO;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (totalAt(mid) > contentTarget) low = mid;
    else high = mid;
  }
  const tempo = (low + high) / 2;
  return { status: "ready", tempo, rawAudioSec, contentTarget,
    durations: quantizeDurations(atTempo(tempo)), targetSec, fixedSec };
}

export function scaleCaptionTimes(captions, tempo) {
  return (captions || []).map((entry) => ({
    ...entry,
    start: Number(entry.start) / tempo,
    end: Number(entry.end) / tempo,
    ...(Array.isArray(entry.words) ? { words: scaleCaptionTimes(entry.words, tempo) } : {})
  }));
}

export function assertFinalDuration(actualSec, targetSec) {
  if (!Number.isFinite(actualSec) || !Number.isFinite(targetSec) || targetSec <= 0 || Math.abs(actualSec - targetSec) > DURATION_TOLERANCE_SEC) {
    throw new Error(`Durasi final ${actualSec}s tidak sesuai target ${targetSec}s (toleransi ${DURATION_TOLERANCE_SEC}s). Video tidak boleh dipublikasikan.`);
  }
}
