import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureImages } from "../src/pipeline.js";
import { buildGridPrompt, generateSceneGridImage } from "../src/openai.js";
import { normalizeVisualSegments, VISUAL_SEGMENT_COUNT } from "../src/longform-story-engine.js";
import { config } from "../src/config.js";

// Bangun item minimal dengan 1 scene ber-4 segmen (pola grid 2x2).
function makeGridItem({ clips = [], images = [] } = {}) {
  return {
    id: "grid-test",
    input: { topic: "clean energy", imageQuality: "low" },
    plan: {
      scenes: [{
        index: 0,
        sceneType: "image",
        screenText: "Energi Bersih",
        imagePrompt: "solar farm overview",
        visualSegments: [
          { imagePrompt: "solar farm aerial wide shot", visualKeywords: "solar farm aerial" },
          { imagePrompt: "engineer inspecting solar panel close up", visualKeywords: "solar panel engineer" },
          { imagePrompt: "solar panel rows at golden hour", visualKeywords: "solar panels sunset" },
          { imagePrompt: "power lines leaving solar farm", visualKeywords: "power lines energy" }
        ]
      }]
    },
    assets: { clips, images, sceneAudio: [] }
  };
}

function makePanels(sceneIndex = 0) {
  return [0, 1, 2, 3].map((segIdx) => ({
    sceneIndex,
    segmentIndex: segIdx,
    provider: "openai",
    gridSource: true,
    path: `/grid-panel-${segIdx}.jpg`,
    url: `/generated/images/grid-panel-${segIdx}.jpg`,
    prompt: "grid prompt"
  }));
}

test("buildGridPrompt: memuat 4 panel sesuai urutan segmen + blok konsistensi", () => {
  const segments = makeGridItem().plan.scenes[0].visualSegments;
  const prompt = buildGridPrompt(segments);

  assert.match(prompt, /strict 2x2 grid/);
  assert.match(prompt, /Panel 1 \(top-left\): solar farm aerial wide shot/);
  assert.match(prompt, /Panel 2 \(top-right\): engineer inspecting solar panel close up/);
  assert.match(prompt, /Panel 3 \(bottom-left\): solar panel rows at golden hour/);
  assert.match(prompt, /Panel 4 \(bottom-right\): power lines leaving solar farm/);
  assert.match(prompt, /Consistency: all four panels share the exact same photorealistic style/);
  assert.match(prompt, /no written text inside the image/);
});

test("generateSceneGridImage: menolak jumlah segmen selain 4", async () => {
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  try {
    await assert.rejects(
      () => generateSceneGridImage({
        itemId: "x",
        scene: { index: 0, screenText: "t" },
        segments: [{ imagePrompt: "a" }, { imagePrompt: "b" }],
        size: "1536x1024",
        quality: "medium"
      }),
      /tepat 4 segmen/
    );
  } finally {
    config.openai.apiKey = originalKey;
  }
});

test("ensureImages: mode grid memakai 1 panggilan untuk 4 segmen", async () => {
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  try {
    const item = makeGridItem();
    let gridCalls = 0;
    let singleCalls = 0;

    await ensureImages(item, {
      gridMode: true,
      persistItem: async () => {},
      fileExists: async () => false,
      generateGridImages: async ({ scene, segments }) => {
        gridCalls += 1;
        assert.equal(segments.length, 4);
        return makePanels(scene.index);
      },
      generateImage: async () => {
        singleCalls += 1;
        return { sceneIndex: 0, path: "/single.png" };
      }
    });

    assert.equal(gridCalls, 1);
    assert.equal(singleCalls, 0);
    assert.equal(item.assets.images.length, 4);
    assert.deepEqual(item.assets.images.map((img) => img.segmentIndex), [0, 1, 2, 3]);
    assert.ok(item.assets.images.every((img) => img.gridSource));
  } finally {
    config.openai.apiKey = originalKey;
  }
});

test("ensureImages: panel milik segmen ber-klip Pexels dibuang, klip tidak ditimpa", async () => {
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  try {
    const clip = { sceneIndex: 0, segmentIndex: 1, provider: "pexels", path: "/clip-1.mp4" };
    const item = makeGridItem({ clips: [clip] });

    await ensureImages(item, {
      gridMode: true,
      persistItem: async () => {},
      fileExists: async () => true,
      generateGridImages: async ({ scene }) => makePanels(scene.index),
      generateImage: async () => {
        throw new Error("single image tidak boleh dipanggil");
      }
    });

    assert.equal(item.assets.images.length, 3);
    assert.deepEqual(item.assets.images.map((img) => img.segmentIndex), [0, 2, 3]);
    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.clips[0].path, "/clip-1.mp4");
  } finally {
    config.openai.apiKey = originalKey;
  }
});

test("ensureImages: grid gagal fallback otomatis ke single-image per segmen", async () => {
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  try {
    const item = makeGridItem();
    const warnings = [];
    const singleSegments = [];

    await ensureImages(item, {
      gridMode: true,
      warnings,
      persistItem: async () => {},
      fileExists: async () => false,
      generateGridImages: async () => {
        throw new Error("grid rusak");
      },
      generateImage: async ({ scene }) => {
        singleSegments.push(scene.segmentIndex);
        return { sceneIndex: scene.index, path: `/single-${scene.segmentIndex}.png` };
      }
    });

    assert.deepEqual(singleSegments, [0, 1, 2, 3]);
    assert.equal(item.assets.images.length, 4);
    assert.ok(warnings.some((warning) => /Grid gambar scene 0 gagal/.test(warning)));
  } finally {
    config.openai.apiKey = originalKey;
  }
});

test("ensureImages: gridMode off memakai perilaku lama sepenuhnya", async () => {
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  try {
    const item = makeGridItem();
    let gridCalls = 0;
    const singleSegments = [];

    await ensureImages(item, {
      gridMode: false,
      persistItem: async () => {},
      fileExists: async () => false,
      generateGridImages: async () => {
        gridCalls += 1;
        return makePanels(0);
      },
      generateImage: async ({ scene }) => {
        singleSegments.push(scene.segmentIndex);
        return { sceneIndex: scene.index, path: `/single-${scene.segmentIndex}.png` };
      }
    });

    assert.equal(gridCalls, 0);
    assert.deepEqual(singleSegments, [0, 1, 2, 3]);
  } finally {
    config.openai.apiKey = originalKey;
  }
});

test("ensureImages: hanya 1 segmen kurang memakai single-image, bukan grid", async () => {
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  try {
    const images = [0, 1, 2].map((segIdx) => ({
      sceneIndex: 0,
      segmentIndex: segIdx,
      path: `/existing-${segIdx}.jpg`
    }));
    const item = makeGridItem({ images });
    let gridCalls = 0;
    const singleSegments = [];

    await ensureImages(item, {
      gridMode: true,
      persistItem: async () => {},
      fileExists: async () => true,
      generateGridImages: async () => {
        gridCalls += 1;
        return makePanels(0);
      },
      generateImage: async ({ scene }) => {
        singleSegments.push(scene.segmentIndex);
        return { sceneIndex: scene.index, segmentIndex: scene.segmentIndex, path: "/single-3.png" };
      }
    });

    assert.equal(gridCalls, 0);
    assert.deepEqual(singleSegments, [3]);
    assert.equal(item.assets.images.length, 4);
  } finally {
    config.openai.apiKey = originalKey;
  }
});

test("normalizeVisualSegments: hasil AI 2 segmen dipad menjadi 4 untuk grid", () => {
  const segments = normalizeVisualSegments(
    [
      { imagePrompt: "old lighthouse on cliff", visualKeywords: "lighthouse cliff", pexelsQuery: "lighthouse cliff coast", mustMatchTerms: ["lighthouse"], narrativeContext: "pembuka" },
      { imagePrompt: "lighthouse lamp mechanism close up", visualKeywords: "lighthouse lamp", pexelsQuery: "lighthouse lamp lens", mustMatchTerms: ["lighthouse", "lamp"], narrativeContext: "inti" }
    ],
    "lighthouse scene",
    "lighthouse coast",
    "sejarah mercusuar",
    0
  );

  assert.equal(segments.length, VISUAL_SEGMENT_COUNT);
  // Segmen padding diturunkan dari segmen terakhir + variasi angle.
  assert.match(segments[2].imagePrompt, /lighthouse lamp mechanism close up/);
  assert.notEqual(segments[2].imagePrompt, segments[1].imagePrompt);
  assert.notEqual(segments[3].imagePrompt, segments[2].imagePrompt);
  assert.deepEqual(segments[2].mustMatchTerms, segments[1].mustMatchTerms);
});

test("normalizeVisualSegments: segmen padding tidak mewarisi narrativeContext", () => {
  const segments = normalizeVisualSegments(
    [
      { imagePrompt: "a", narrativeContext: "pembuka cerita" },
      { imagePrompt: "b", narrativeContext: "inti cerita" }
    ],
    "scene prompt",
    "",
    "topik",
    0
  );
  assert.equal(segments.length, VISUAL_SEGMENT_COUNT);
  // Frasa duplikat membuat batas waktu computeSegmentDurations() identik →
  // non-monoton → seluruh scene jatuh ke pembagian rata.
  assert.equal(segments[2].narrativeContext, "");
  assert.equal(segments[3].narrativeContext, "");
  const phrases = segments.map((seg) => seg.narrativeContext).filter(Boolean);
  assert.equal(new Set(phrases).size, phrases.length);
});

test("normalizeVisualSegments: hasil AI 4 segmen dipertahankan apa adanya", () => {
  const raw = [1, 2, 3, 4].map((n) => ({
    imagePrompt: `panel ${n} prompt`,
    visualKeywords: `keyword ${n}`,
    pexelsQuery: `solar panel step${n}`,
    mustMatchTerms: ["solar"],
    narrativeContext: `bagian ${n}`
  }));
  const segments = normalizeVisualSegments(raw, "scene prompt", "scene keywords", "topik", 0);

  assert.equal(segments.length, 4);
  assert.deepEqual(segments.map((seg) => seg.imagePrompt), [
    "panel 1 prompt", "panel 2 prompt", "panel 3 prompt", "panel 4 prompt"
  ]);
});
