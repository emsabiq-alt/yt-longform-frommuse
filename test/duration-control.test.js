import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fitSceneAudio, quantizeDurations, scaleCaptionTimes, assertFinalDuration } from "../src/duration-control.js";
import { insertEnrichmentScenes, enrichLongformDraft, buildLongformStoryboard } from "../src/longform-story-engine.js";
import { buildSceneAudioTiming, makeContentAudioFromScenes, probeDuration } from "../src/longform-render.js";
import { planSceneSpotlights } from "../src/spotlight.js";
import { polishPlanForLayAudience } from "../src/story-language.js";
import { paths } from "../src/config.js";

test("20 minutes includes opening/closing and preserves every complete scene's audio", () => {
  const scenes = Array.from({ length: 36 }, (_, i) => ({ sceneType: i === 35 ? "summary" : i % 4 === 3 ? "reaction" : "image" }));
  const audio = scenes.map((scene) => scene.sceneType === "reaction" ? 5.123 : 44.876);
  const fit = fitSceneAudio(scenes, audio, 1200, 20.4);
  assert.equal(fit.status, "ready");
  assert.ok(Math.abs(fit.durations.reduce((a, b) => a + b, 0) + 20.4 - 1200) < 1e-6);
  fit.durations.forEach((duration, i) => {
    assert.ok(duration >= audio[i] / fit.tempo, `scene ${i} must fit all speech`);
    assert.ok(duration - audio[i] / fit.tempo < 0.14, "no long silent padding");
    assert.ok(Math.abs(duration * 30 - Math.round(duration * 30)) < 1e-6);
  });
});

test("short narration requests enrichment; too much narration fails before any truncation", () => {
  const scenes = Array.from({ length: 36 }, () => ({ sceneType: "image" }));
  const short = fitSceneAudio(scenes, scenes.map(() => 20), 1200, 12);
  assert.equal(short.status, "enrich");
  assert.ok(short.missingSec > 450);
  assert.equal(short.durations, undefined);
  assert.throws(() => fitSceneAudio(scenes, scenes.map(() => 45), 1200, 12), /Storyboard tetap utuh/);
  assert.throws(() => fitSceneAudio(scenes, [3], 1200), /audio valid/);
  assert.throws(() => fitSceneAudio([{}], [0], 1200), /audio valid/);
  assert.throws(() => fitSceneAudio([{}], [30], 1200, 1201), /pembuka/);
});

test("frame rounding across 144 visual segments does not accumulate duration drift", () => {
  const durations = Array.from({ length: 144 }, (_, i) => 5.111 + (i % 7) / 17);
  const quantized = quantizeDurations(durations);
  const total = (values) => values.reduce((sum, n) => sum + n, 0);
  assert.ok(Math.abs(total(quantized) - total(durations)) <= 1 / 60 + 1e-9);
  quantized.forEach((value, i) => assert.ok(Math.abs(value - durations[i]) < 1 / 30));
});

test("tempo retimes captions and word triggers without modifying source timestamps", () => {
  const original = [{ start: 0, end: 8, text: "bukti baru ditemukan", words: [
    { word: "bukti", start: 2, end: 3 }, { word: "baru", start: 3, end: 4 }, { word: "ditemukan", start: 4, end: 5 }
  ] }];
  const copy = structuredClone(original);
  const captions = scaleCaptionTimes(original, 1.1);
  assert.equal(captions[0].end, 8 / 1.1);
  assert.equal(captions[0].words[0].start, 2 / 1.1);
  const cards = planSceneSpotlights([{ index: 1, startSec: 30, durationSec: 10,
    sceneCaptions: captions, spotlight: { label: "Bukti baru", phrase: "bukti baru ditemukan" } }]);
  assert.equal(cards.length, 1);
  assert.ok(Math.abs(cards[0].startSec - (30 + 2 / 1.1 - 0.12)) < 0.001);
  assert.deepEqual(original, copy);
});

test("final publishing gate accepts only valid duration within tolerance of target", () => {
  for (const actual of [1196.5, 1198.8, 1200, 1200.8, 1203.5]) assert.doesNotThrow(() => assertFinalDuration(actual, 1200));
  for (const actual of [720, 1195, 1205, NaN, Infinity]) assert.throws(() => assertFinalDuration(actual, 1200));
  assert.throws(() => assertFinalDuration(1200, NaN));
});

function originalItem() {
  return {
    input: { topic: "Eksplorasi laut", durationSec: 1200, sceneCount: 3, formatType: "dokumenter_klasik" },
    plan: { title: "Laut dalam", scenes: [
      { index: 1, sceneType: "image", chapter: "Tekanan laut", narration: "Tekanan meningkat seiring kedalaman.",
        mediaSource: { outlet: "Sumber asli", headline: "Eksplorasi laut", url: "https://example.com/ocean" },
        spotlight: { label: "Tekanan", phrase: "Tekanan meningkat seiring kedalaman" },
        visualSegments: [{ imagePrompt: "Original user's mockup direction", narrativeContext: "Tekanan meningkat" }] },
      { index: 2, sceneType: "image", chapter: "Kehidupan", narration: "Organisme laut menyesuaikan diri terhadap lingkungan." },
      { index: 3, sceneType: "summary", chapter: "Kesimpulan", narration: "Inilah penutup lengkap yang tetap dipertahankan." }
    ] },
    assets: { sceneAudio: [1, 2, 3].map((i) => ({ sceneIndex: i, path: `original-${i}.mp3`, textHash: `hash-${i}` })) }
  };
}

function newScene() {
  return { afterSceneIndex: 1, screenText: "Kapal penelitian", beatPurpose: "Bagaimana kapal mengukur kedalaman laut?",
    narration: "Kapal penelitian membawa alat pengukur kedalaman yang mengirimkan gelombang suara menuju dasar laut. Pantulan yang kembali membantu peneliti menghitung jaraknya. Pengukuran tersebut dilakukan sepanjang lintasan kapal untuk menyusun peta bentuk dasar perairan. Peta ini menjadi dasar perencanaan penyelaman berikutnya.",
    imagePrompt: "research ship surveys ocean", visualKeywords: "ocean research ship",
    visualSegments: Array.from({ length: 4 }, () => ({ imagePrompt: "ocean research ship sonar", visualKeywords: "ocean sonar", narrativeContext: "Kapal penelitian membawa alat" })),
    spotlight: { label: "Peta dasar laut", phrase: "menyusun peta bentuk dasar perairan" }
  };
}

test("enrichment inserts new content while preserving all original narration, chapters, mockups, and audio", () => {
  const item = originalItem();
  const before = structuredClone(item);
  insertEnrichmentScenes(item, [newScene()]);
  assert.equal(item.plan.scenes.length, 4);
  [0, 2, 3].forEach((newIndex, i) => {
    assert.deepEqual(item.plan.scenes[newIndex], { ...before.plan.scenes[i], index: newIndex + 1 });
  });
  assert.equal(item.plan.scenes[1].chapter, before.plan.scenes[0].chapter);
  assert.equal(item.plan.scenes[1].sceneType, "image");
  assert.equal(item.plan.scenes[1].visualSegments.length, 4);
  assert.deepEqual(item.assets.sceneAudio.map((a) => a.sceneIndex), [1, 3, 4]);
  assert.deepEqual(item.assets.sceneAudio.map((a) => a.path), before.assets.sceneAudio.map((a) => a.path));
  assert.equal(item.plan.longformStoryboard[0].narration, before.plan.scenes[0].narration);
  assert.deepEqual(item.plan.longformStoryboard[0].mediaSource, before.plan.scenes[0].mediaSource);
});

test("invalid additions are rejected before changing the existing storyboard", () => {
  for (const additions of [[], [{ ...newScene(), afterSceneIndex: 3 }], [{ ...newScene(), narration: "Terlalu singkat." }], [newScene(), newScene()]]) {
    const item = originalItem();
    const copy = structuredClone(item);
    assert.throws(() => insertEnrichmentScenes(item, additions));
    assert.deepEqual(item, copy);
  }
});

test("a 48-scene storyboard can still be enriched when measured audio is short", () => {
  const item = originalItem();
  const first = item.plan.scenes[0];
  const closing = item.plan.scenes.at(-1);
  item.plan.scenes = [
    ...Array.from({ length: 47 }, (_, index) => ({
      ...first,
      index: index + 1,
      narration: `Narasi asli scene ${index + 1} tetap dipertahankan lengkap.`
    })),
    { ...closing, index: 48 }
  ];
  item.input.sceneCount = 48;
  item.assets.sceneAudio = item.plan.scenes.map((scene) => ({
    sceneIndex: scene.index,
    path: `original-${scene.index}.mp3`,
    textHash: `hash-${scene.index}`
  }));

  insertEnrichmentScenes(item, [newScene()]);

  assert.equal(item.plan.scenes.length, 49);
  assert.equal(item.plan.scenes[1].narration, newScene().narration);
  assert.equal(item.plan.scenes.at(-1).narration, closing.narration);
  assert.deepEqual(item.assets.sceneAudio.map((audio) => audio.sceneIndex), [
    1,
    ...Array.from({ length: 47 }, (_, index) => index + 3)
  ]);
});

test("enrichment receives research evidence and saves full original plus new narration", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "longform-enrichment-"));
  const previousDir = paths.generatedDir;
  paths.generatedDir = dir;
  t.after(async () => { paths.generatedDir = previousDir; await fs.rm(dir, { recursive: true, force: true }); });
  const item = originalItem();
  item.id = "enrichment-test";
  item.plan.researchFacts = "Sonar mengukur selang waktu pantulan suara.";
  const original = item.plan.scenes.map((s) => s.narration);
  await enrichLongformDraft(item, { missingSec: 100, rawAudioSec: 100,
    request: async (prompt) => {
      assert.ok(prompt.includes(item.plan.researchFacts));
      assert.ok(prompt.includes("Tambahkan tepat 1 scene"));
      original.forEach((narration) => assert.ok(prompt.includes(narration)));
      return { scenes: [newScene()] };
    }
  });
  const saved = JSON.parse(await fs.readFile(item.assets.storyboard.path, "utf8"));
  assert.equal(saved.sceneCount, 4);
  original.forEach((narration) => assert.ok(saved.storyboard.some((s) => s.narration === narration)));
  assert.ok(saved.storyboard[1].narration.includes("Kapal penelitian"));
});

test("enrichment accepts fewer scenes than requested and leaves remeasurement to the pipeline", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "longform-partial-enrichment-"));
  const previousDir = paths.generatedDir;
  paths.generatedDir = dir;
  t.after(async () => { paths.generatedDir = previousDir; await fs.rm(dir, { recursive: true, force: true }); });
  const item = originalItem();
  item.id = "partial-enrichment-test";

  await enrichLongformDraft(item, {
    missingSec: 4000,
    rawAudioSec: 100,
    request: async (prompt) => {
      assert.ok(prompt.includes("Tambahkan tepat 6 scene"));
      return { scenes: [newScene()] };
    }
  });

  assert.equal(item.plan.scenes.length, 4);
  assert.equal(item.plan.scenes[1].narration, newScene().narration);
});

test("long detailed narration survives polishing and storyboard export in full", () => {
  const narration = Array.from({ length: 220 }, (_, i) => `penjelasan${i}`).join(" ") + ".";
  assert.ok(narration.length > 1600 && narration.length < 4000);
  const plan = polishPlanForLayAudience({ scenes: [{ index: 1, sceneType: "image", narration }] });
  assert.equal(plan.scenes[0].narration, narration);
  assert.equal(buildLongformStoryboard(plan)[0].narration, narration);
});

let hasFfmpeg = false;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); hasFfmpeg = true; } catch {}

test("FFmpeg audio assembly fits measured scenes and captions to the requested timeline", { skip: !hasFfmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "longform-duration-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const tone = path.join(dir, "tone.wav");
  const music = path.join(dir, "music.wav");
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5.5", tone], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", music], { stdio: "ignore" });
  const item = { input: { durationSec: 20, durationLocked: true },
    plan: { scenes: [1, 2, 3, 4].map((i) => ({ index: i, sceneType: i === 4 ? "summary" : "image" })) },
    assets: { sceneAudio: [1, 2, 3, 4].map((i) => ({ sceneIndex: i, path: tone,
      captions: [{ start: 0, end: 5.5, text: "Narasi lengkap." }] })) }
  };
  const built = await buildSceneAudioTiming(item);
  assert.equal(built.timing.contentDuration, 20);
  for (const scene of built.renderScenes) {
    assert.ok(scene.sceneCaptions[0].end < scene.durationSec);
    assert.ok(scene.audioDurationSec < scene.durationSec);
  }
  const outputPath = path.join(dir, "fitted.m4a");
  await makeContentAudioFromScenes({ scenes: built.renderScenes, musicPath: music, outputPath, duration: 20, workDir: dir });
  assert.ok(Math.abs(await probeDuration(outputPath) - 20) < 0.05);
});
