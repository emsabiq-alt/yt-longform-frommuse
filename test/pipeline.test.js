// Unit test gerbang kesiapan render di src/pipeline.js.
// assertReadyToRender mencegah render jalan saat aset belum lengkap (gagal 409).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertReadyToRender,
  buildPexelsClipJobs,
  ensureImages,
  ensurePexelsClips,
  ensureWikimediaMedia,
  ensureVisualAssets,
  pexelsIntentHash
} from "../src/pipeline.js";
import { config } from "../src/config.js";
import { PEXELS_SELECTOR_VERSION } from "../src/pexels.js";

// Bangun item minimal untuk diuji.
function makeItem({ scenes, clips = [], images = [], sceneAudio = [] }) {
  return {
    id: "pipeline-test",
    input: { topic: "clean energy", imageQuality: "low" },
    plan: { scenes },
    assets: { clips, images, sceneAudio }
  };
}

test("config: thumbnail otomatis aktif dan memakai gambar storyboard (tanpa biaya API)", () => {
  // Sejak thumbnail.js ditulis ulang (rankStoryboardImages + ffmpeg), pembuatan
  // thumbnail tidak lagi memanggil API gambar, jadi default-nya aktif.
  assert.equal(config.thumbnail.enabled, true);
});

test("assertReadyToRender: lolos saat tiap scene punya gambar + ada audio", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [{ sceneIndex: 0, path: "/img-0.png" }],
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.doesNotThrow(() => assertReadyToRender(item));
});

test("assertReadyToRender: klip video memenuhi syarat media (tanpa gambar)", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    clips: [{ sceneIndex: 0, path: "/clip-0.mp4" }],
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.doesNotThrow(() => assertReadyToRender(item));
});

test("assertReadyToRender: scene 'reaction' tidak butuh media sendiri", () => {
  const item = makeItem({
    scenes: [
      { index: 0, sceneType: "image" },
      { index: 1, sceneType: "reaction" } // tanpa klip/gambar, tetap boleh
    ],
    images: [{ sceneIndex: 0, path: "/img-0.png" }],
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.doesNotThrow(() => assertReadyToRender(item));
});

test("assertReadyToRender: gagal 409 jika scene wajib tak punya media", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [], // tidak ada media untuk scene 0
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.throws(() => assertReadyToRender(item), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test("assertReadyToRender: entri media dengan path kosong dianggap belum ada → 409", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [{ sceneIndex: 0, path: null }], // path null = belum siap
    sceneAudio: [{ sceneIndex: 0, path: "/audio-0.mp3" }]
  });
  assert.throws(() => assertReadyToRender(item), (err) => err.status === 409);
});

test("assertReadyToRender: gagal 409 jika tidak ada audio TTS sama sekali", () => {
  const item = makeItem({
    scenes: [{ index: 0, sceneType: "image" }],
    images: [{ sceneIndex: 0, path: "/img-0.png" }],
    sceneAudio: [] // belum ada audio
  });
  assert.throws(() => assertReadyToRender(item), (err) => {
    assert.equal(err.status, 409);
    return true;
  });
});

test("buildPexelsClipJobs: lima segmen mendapat maksimal tiga job (rasio 70%)", () => {
  const item = makeItem({
    scenes: [
      {
        index: 0,
        sceneType: "image",
        visualSegments: [
          { pexelsQuery: "solar panel technician", mustMatchTerms: ["solar", "panel"], visualKeywords: "solar panel technician" },
          { pexelsQuery: "wind turbine maintenance", mustMatchTerms: ["wind", "turbine"], visualKeywords: "wind turbine maintenance" },
          { pexelsQuery: "", mustMatchTerms: [], visualKeywords: "abstract energy transition" }
        ]
      },
      {
        index: 1,
        sceneType: "summary",
        visualSegments: [
          { pexelsQuery: "electric bus city", mustMatchTerms: ["electric", "bus"], visualKeywords: "electric bus city" },
          { pexelsQuery: "battery factory workers", mustMatchTerms: ["battery", "factory"], visualKeywords: "battery factory workers" }
        ]
      },
      {
        index: 2,
        sceneType: "reaction",
        visualSegments: [{ pexelsQuery: "reaction presenter" }]
      }
    ]
  });

  // 5 slot pencarian (reaction dikecualikan): kuota = floor(5 * 0.7) = 3.
  const jobs = buildPexelsClipJobs(item, { semanticSelection: true });
  assert.equal(jobs.length, 3);
  assert.ok(jobs.every((job) => job.scene.sceneType !== "reaction"));
  assert.ok(jobs.every((job) => job.segScene.pexelsQuery));
  assert.equal(new Set(jobs.map((job) => job.slot)).size, 3);

  // Rasio dapat dikendalikan per pemanggilan (perilaku lama 50% tetap bisa dipilih).
  const halfJobs = buildPexelsClipJobs(item, { semanticSelection: true, clipRatio: 0.5 });
  assert.equal(halfJobs.length, 2);
});

test("buildPexelsClipJobs: satu segmen konkret tetap mendapat satu kesempatan", () => {
  const item = makeItem({
    scenes: [{
      index: 0,
      sceneType: "image",
      visualSegments: [{
        pexelsQuery: "electric bus depot",
        mustMatchTerms: ["electric", "bus"],
        visualKeywords: "electric bus depot"
      }]
    }]
  });

  const jobs = buildPexelsClipJobs(item, { semanticSelection: true });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].query, "electric bus depot");
});

test("buildPexelsClipJobs: index scene duplikat tidak menghasilkan slot duplikat", () => {
  const item = makeItem({
    scenes: [
      {
        index: 1,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "wheelchair elevator",
          mustMatchTerms: ["wheelchair", "elevator"],
          visualKeywords: "wheelchair elevator"
        }]
      },
      {
        index: 1,
        sceneType: "summary",
        visualSegments: [{
          pexelsQuery: "oil refinery",
          mustMatchTerms: ["oil", "refinery"],
          visualKeywords: "oil refinery"
        }]
      }
    ]
  });

  const jobs = buildPexelsClipJobs(item, { semanticSelection: true });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].slot, "1:0");
  assert.equal(jobs[0].query, "wheelchair elevator");
});

test("ensureVisualAssets: urutan Pexels lalu Wikimedia lalu fallback gambar", async () => {
  const calls = [];
  const warnings = [];
  const item = makeItem({ scenes: [] });

  await ensureVisualAssets(item, {
    warnings,
    strict: true,
    pexelsRunner: async (receivedItem, options) => {
      calls.push("pexels");
      assert.equal(receivedItem, item);
      assert.equal(options.warnings, warnings);
    },
    wikimediaRunner: async (receivedItem, options) => {
      calls.push("wikimedia");
      assert.equal(receivedItem, item);
      assert.equal(options.warnings, warnings);
    },
    imageRunner: async (receivedItem, options) => {
      calls.push("images");
      assert.equal(receivedItem, item);
      assert.equal(options.warnings, warnings);
      assert.equal(options.strict, true);
    }
  });

  assert.deepEqual(calls, ["pexels", "wikimedia", "images"]);
});

test("ensureWikimediaMedia: hanya mengisi slot kosong dan menyimpan atribusi", async () => {
  const originalEnabled = config.wikimedia.enabled;
  config.wikimedia.enabled = true;
  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [
          {
            pexelsQuery: "Apollo 11 moon landing",
            mustMatchTerms: ["apollo", "moon"],
            visualKeywords: "Apollo 11 moon landing"
          },
          {
            pexelsQuery: "Saturn V launch",
            mustMatchTerms: ["saturn", "launch"],
            visualKeywords: "Saturn V rocket launch"
          }
        ]
      }],
      clips: [{
        sceneIndex: 0,
        segmentIndex: 0,
        provider: "pexels",
        pexelsId: 7,
        path: "/existing-pexels.mp4"
      }]
    });
    const requestedSegments = [];

    await ensureWikimediaMedia(item, {
      delayMs: 0,
      maxAssets: 8,
      persistItem: async () => {},
      fileExists: async (filePath) => (
        filePath === "/existing-pexels.mp4" || filePath === "/wikimedia-saturn.jpg"
      ),
      fetchMedia: async ({ scene, usedPageIds }) => {
        requestedSegments.push(scene.segmentIndex);
        assert.equal(usedPageIds.size, 0);
        return {
          mediaType: "image",
          wikimediaPageId: 12345,
          title: "Saturn V launch",
          creator: "NASA",
          license: "Public domain",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Saturn_V_launch.jpg",
          query: "Saturn V launch",
          path: "/wikimedia-saturn.jpg",
          url: "/generated/images/wikimedia-saturn.jpg"
        };
      }
    });

    assert.deepEqual(requestedSegments, [1]);
    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.images.length, 1);
    assert.equal(item.assets.images[0].provider, "wikimedia");
    assert.equal(item.assets.images[0].creator, "NASA");
    assert.equal(item.assets.wikimediaAudit[0].status, "selected");
  } finally {
    config.wikimedia.enabled = originalEnabled;
  }
});

test("buildPexelsClipJobs: fallback legacy abstrak tidak menjadi job atau request API", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualKeywords: "future policy, economic uncertainty"
      }]
    });
    assert.deepEqual(buildPexelsClipJobs(item), []);
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 0);
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "video-quota");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("buildPexelsClipJobs: explicit pexelsQuery kosong tidak pernah menjadi job", () => {
  const item = makeItem({
    scenes: [{
      index: 0,
      sceneType: "image",
      visualSegments: [
        { pexelsQuery: "", visualKeywords: "solar panels on roof" },
        { pexelsQuery: "electric train station", visualKeywords: "electric train station" }
      ]
    }]
  });

  const jobs = buildPexelsClipJobs(item, { semanticSelection: true });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].segmentIndex, 1);
  assert.equal(jobs[0].segScene.pexelsQuery, "electric train station");
});

test("ensurePexelsClips: meneruskan intent segmen dan menambah used ID antar job", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 3,
        sceneType: "image",
        visualSegments: [
          {
            pexelsQuery: "oil refinery pipes",
            mustMatchTerms: ["oil", "refinery"],
            visualKeywords: "industrial oil refinery",
            narrativeContext: "kilang mengolah minyak mentah"
          },
          { pexelsQuery: "unused odd segment", visualKeywords: "unused odd segment" },
          {
            pexelsQuery: "cargo ship containers",
            mustMatchTerms: ["cargo", "ship"],
            visualKeywords: "container ship at port",
            narrativeContext: "kapal membawa kontainer"
          },
          { pexelsQuery: "second unused odd segment", visualKeywords: "unused odd segment" }
        ]
      }]
    });
    const calls = [];

    await ensurePexelsClips(item, {
      semanticSelection: false,
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => true,
      fetchClip: async (params) => {
        calls.push({
          scene: params.scene,
          usedIds: [...params.usedPexelsIds]
        });
        const id = calls.length === 1 ? 101 : 102;
        return {
          provider: "upstream-value-is-normalized",
          selectorVersion: PEXELS_SELECTOR_VERSION,
          pexelsId: id,
          query: params.scene.pexelsQuery,
          path: `/clip-${id}.mp4`
        };
      }
    });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.scene.segmentIndex), [0, 2]);
    assert.equal(calls[0].scene.pexelsQuery, "oil refinery pipes");
    assert.deepEqual(calls[0].scene.mustMatchTerms, ["oil", "refinery"]);
    assert.equal(calls[0].scene.visualKeywords, "industrial oil refinery");
    assert.equal(calls[0].scene.narrativeContext, "kilang mengolah minyak mentah");
    assert.deepEqual(calls[0].usedIds, []);
    assert.deepEqual(calls[1].usedIds, ["101"]);
    assert.equal(item.assets.clips.length, 2);
    assert.ok(item.assets.clips.every((clip) => clip.provider === "pexels"));
    assert.ok(item.assets.clips.every((clip) => clip.intentHash === pexelsIntentHash(calls.find(
      (call) => call.scene.segmentIndex === clip.segmentIndex
    ).scene)));
    assert.equal(item.assets.pexelsAudit.filter((audit) => audit.status === "selected").length, 2);
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: klip selector v2 dengan intent sama direuse", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [
          { pexelsQuery: "electric bus street", mustMatchTerms: ["electric", "bus"], visualKeywords: "electric bus street" },
          { pexelsQuery: "pedestrians crossing road", visualKeywords: "pedestrians crossing road" }
        ]
      }]
    });
    const [job] = buildPexelsClipJobs(item, { semanticSelection: false });
    item.assets.clips = [{
      sceneIndex: 0,
      segmentIndex: 0,
      provider: "pexels",
      selectorVersion: PEXELS_SELECTOR_VERSION,
      intentHash: pexelsIntentHash(job.segScene),
      pexelsId: 700,
      query: "electric bus street",
      path: "/existing-current.mp4"
    }];
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      semanticSelection: false,
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => true,
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 0);
    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.clips[0].path, "/existing-current.mp4");
    const audit = item.assets.pexelsAudit.find((entry) => entry.segmentIndex === 0);
    assert.equal(audit.status, "selected");
    assert.equal(audit.source, "reused");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: ID klip yang direuse diteruskan ke pencarian berikutnya", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [
          { pexelsQuery: "electric bus street", visualKeywords: "electric bus street" },
          { pexelsQuery: "odd slot one", visualKeywords: "odd slot one" },
          { pexelsQuery: "cargo ship port", visualKeywords: "cargo ship port" },
          { pexelsQuery: "odd slot two", visualKeywords: "odd slot two" }
        ]
      }]
    });
    const jobs = buildPexelsClipJobs(item, { semanticSelection: false });
    item.assets.clips = [{
      sceneIndex: 0,
      segmentIndex: 0,
      provider: "pexels",
      selectorVersion: PEXELS_SELECTOR_VERSION,
      intentHash: pexelsIntentHash(jobs[0].segScene),
      pexelsId: 700,
      path: "/existing-current.mp4"
    }];
    const usedIdSnapshots = [];

    await ensurePexelsClips(item, {
      semanticSelection: false,
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => true,
      fetchClip: async ({ usedPexelsIds }) => {
        usedIdSnapshots.push([...usedPexelsIds]);
        return null;
      }
    });

    assert.deepEqual(usedIdSnapshots, [["700"]]);
    assert.equal(item.assets.clips.length, 1);
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: selector/hash stale tidak direuse dan fallback melepas metadata lama", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  const originalOpenAiKey = config.openai.apiKey;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "hydroelectric dam spillway",
          mustMatchTerms: ["dam", "spillway"],
          visualKeywords: "hydroelectric dam spillway",
          imagePrompt: "A hydroelectric dam spillway"
        }]
      }],
      clips: [{
        sceneIndex: 0,
        segmentIndex: 0,
        provider: "pexels",
        selectorVersion: 1,
        intentHash: "stale-intent",
        pexelsId: 404,
        path: "/stale.mp4"
      }]
    });
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 1);
    assert.deepEqual(item.assets.clips, []);
    assert.deepEqual(item.assets.pexelsAudit[0], {
      sceneIndex: 0,
      segmentIndex: 0,
      status: "image-fallback",
      intentHash: pexelsIntentHash(buildPexelsClipJobs(item)[0].segScene),
      query: "hydroelectric dam spillway",
      fallbackReason: "no-relevant-candidate"
    });

    config.openai.apiKey = "test-key";
    const imageCalls = [];
    await ensureImages(item, {
      persistItem: async () => {},
      generateImage: async ({ scene }) => {
        imageCalls.push(scene);
        return { sceneIndex: scene.index, path: "/fallback.png" };
      }
    });
    assert.equal(imageCalls.length, 1);
    assert.equal(imageCalls[0].segmentIndex, 0);
    assert.equal(item.assets.images[0].path, "/fallback.png");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
    config.openai.apiKey = originalOpenAiKey;
  }
});

test("ensurePexelsClips: intent kosong membuang klip slot lama tanpa request", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{ pexelsQuery: "", visualKeywords: "abstract policy concept" }]
      }],
      clips: [{
        sceneIndex: 0,
        segmentIndex: 0,
        provider: "pexels",
        selectorVersion: PEXELS_SELECTOR_VERSION,
        intentHash: "old-hash",
        pexelsId: 88,
        path: "/old.mp4"
      }]
    });
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 0);
    assert.deepEqual(item.assets.clips, []);
    assert.equal(item.assets.pexelsAudit[0].status, "image-fallback");
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "explicit-image-fallback");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: gambar valid mempertahankan slot dan mencegah fetch atau reuse Pexels", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "electric bus depot",
          visualKeywords: "electric bus depot"
        }]
      }],
      images: [{ sceneIndex: 0, segmentIndex: 0, path: "/existing-image.png" }],
      clips: [{
        sceneIndex: 0,
        segmentIndex: 0,
        provider: "pexels",
        selectorVersion: PEXELS_SELECTOR_VERSION,
        pexelsId: 44,
        intentHash: pexelsIntentHash({
          pexelsQuery: "electric bus depot",
          visualKeywords: "electric bus depot",
          mustMatchTerms: [],
          segmentIndex: 0
        }),
        path: "/otherwise-reusable.mp4"
      }]
    });
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async (filePath) => filePath === "/existing-image.png",
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 0);
    assert.deepEqual(item.assets.images, [
      { sceneIndex: 0, segmentIndex: 0, path: "/existing-image.png" }
    ]);
    assert.deepEqual(item.assets.clips, []);
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "existing-image");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: klip non-Pexels valid menang bila coexist dengan Pexels reusable", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const scene = {
      index: 0,
      sceneType: "image",
      visualSegments: [{
        pexelsQuery: "cargo ship port",
        visualKeywords: "cargo ship port"
      }]
    };
    const item = makeItem({
      scenes: [scene],
      clips: [
        {
          sceneIndex: 0,
          segmentIndex: 0,
          provider: "manual-upload",
          path: "/manual.mp4"
        },
        {
          sceneIndex: 0,
          segmentIndex: 0,
          provider: "pexels",
          selectorVersion: PEXELS_SELECTOR_VERSION,
          pexelsId: 700,
          intentHash: pexelsIntentHash(buildPexelsClipJobs(makeItem({ scenes: [scene] }))[0].segScene),
          path: "/pexels.mp4"
        }
      ]
    });
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => true,
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 0);
    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.clips[0].provider, "manual-upload");
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "existing-media");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: metadata reusable dengan file hilang harus dicari ulang", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "wind turbine technician",
          visualKeywords: "wind turbine technician"
        }]
      }]
    });
    const [job] = buildPexelsClipJobs(item);
    item.assets.clips = [{
      sceneIndex: 0,
      segmentIndex: 0,
      provider: "pexels",
      selectorVersion: PEXELS_SELECTOR_VERSION,
      intentHash: pexelsIntentHash(job.segScene),
      pexelsId: 10,
      path: "/missing.mp4"
    }];
    let fetchCount = 0;
    let existenceChecks = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async (filePath) => {
        if (filePath !== "/missing.mp4") return false;
        existenceChecks += 1;
        return existenceChecks > 1;
      },
      fetchClip: async () => {
        fetchCount += 1;
        return { pexelsId: 11, path: "/missing.mp4" };
      }
    });

    assert.equal(fetchCount, 1);
    assert.equal(existenceChecks, 2);
    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.clips[0].pexelsId, 11);
    assert.equal(item.assets.pexelsAudit[0].source, "fetched");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: ID Pexels retained di luar storyboard ikut deduplikasi", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "solar panel installer",
          visualKeywords: "solar panel installer"
        }]
      }],
      clips: [{
        sceneIndex: 99,
        segmentIndex: 0,
        provider: "pexels",
        pexelsId: 321,
        path: "/outside-storyboard-missing.mp4"
      }]
    });
    const usedSnapshots = [];

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => false,
      fetchClip: async ({ usedPexelsIds }) => {
        usedSnapshots.push([...usedPexelsIds]);
        return null;
      }
    });

    assert.deepEqual(usedSnapshots, [["321"]]);
    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.clips[0].sceneIndex, 99);
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: object hasil fetch tanpa path atau ID ditolak sebagai invalid-clip", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "hydroelectric dam",
          visualKeywords: "hydroelectric dam"
        }]
      }]
    });

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fetchClip: async () => ({ path: "/truthy-but-no-id.mp4" })
    });

    assert.deepEqual(item.assets.clips, []);
    assert.equal(item.assets.pexelsAudit[0].status, "image-fallback");
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "invalid-clip");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensurePexelsClips: file hasil fetch nol byte dianggap hilang dan fallback gambar", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-zero-clip-"));
  const zeroBytePath = path.join(tempDir, "zero.mp4");
  await fs.writeFile(zeroBytePath, "");
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "wind turbine technician",
          visualKeywords: "wind turbine technician"
        }]
      }]
    });

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fetchClip: async () => ({ pexelsId: 812, path: zeroBytePath })
    });

    assert.deepEqual(item.assets.clips, []);
    assert.equal(item.assets.pexelsAudit[0].status, "image-fallback");
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "missing-fetched-file");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("ensurePexelsClips: gambar stale dipangkas agar fallback gambar dapat dibuat", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  const originalOpenAiKey = config.openai.apiKey;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;
  config.openai.apiKey = "test-key";

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "solar panel technician",
          visualKeywords: "solar panel technician",
          imagePrompt: "A technician inspecting solar panels"
        }]
      }],
      images: [{ sceneIndex: 0, segmentIndex: 0, path: "/missing-image.png" }]
    });
    let fetchCount = 0;

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => false,
      fetchClip: async () => {
        fetchCount += 1;
        return null;
      }
    });

    assert.equal(fetchCount, 1);
    assert.deepEqual(item.assets.images, []);
    const generated = [];
    await ensureImages(item, {
      persistItem: async () => {},
      fileExists: async () => false,
      generateImage: async ({ scene }) => {
        generated.push(scene.segmentIndex);
        return { sceneIndex: scene.index, path: "/fresh-image.png" };
      }
    });
    assert.deepEqual(generated, [0]);
    assert.equal(item.assets.images[0].path, "/fresh-image.png");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
    config.openai.apiKey = originalOpenAiKey;
  }
});

test("ensurePexelsClips: klip non-Pexels stale diturunkan menjadi fallback gambar", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  const originalOpenAiKey = config.openai.apiKey;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;
  config.openai.apiKey = "test-key";

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "cargo ship port",
          visualKeywords: "cargo ship port",
          imagePrompt: "A cargo ship entering a container port"
        }]
      }],
      clips: [{
        sceneIndex: 0,
        segmentIndex: 0,
        provider: "manual-upload",
        path: "/missing-manual.mp4"
      }]
    });

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => false,
      fetchClip: async () => null
    });

    assert.deepEqual(item.assets.clips, []);
    const generated = [];
    await ensureImages(item, {
      persistItem: async () => {},
      fileExists: async () => false,
      generateImage: async ({ scene }) => {
        generated.push(scene.segmentIndex);
        return { sceneIndex: scene.index, path: "/cargo-fallback.png" };
      }
    });
    assert.deepEqual(generated, [0]);
    assert.equal(item.assets.images[0].path, "/cargo-fallback.png");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
    config.openai.apiKey = originalOpenAiKey;
  }
});

test("ensurePexelsClips: hasil fetch dengan file hilang ditolak sebagai missing-fetched-file", async () => {
  const originalApiKey = config.pexels.apiKey;
  const originalPreferVideo = config.pexels.preferVideo;
  config.pexels.apiKey = "test-key";
  config.pexels.preferVideo = true;

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [{
          pexelsQuery: "wind turbine technician",
          visualKeywords: "wind turbine technician"
        }]
      }]
    });

    await ensurePexelsClips(item, {
      delayMs: 0,
      persistItem: async () => {},
      fileExists: async () => false,
      fetchClip: async () => ({ pexelsId: 811, path: "/download-never-created.mp4" })
    });

    assert.deepEqual(item.assets.clips, []);
    assert.equal(item.assets.pexelsAudit[0].status, "image-fallback");
    assert.equal(item.assets.pexelsAudit[0].fallbackReason, "missing-fetched-file");
  } finally {
    config.pexels.apiKey = originalApiKey;
    config.pexels.preferVideo = originalPreferVideo;
  }
});

test("ensureImages: direct call memvalidasi slot aktif tanpa membuang media di luar rencana", async () => {
  const originalOpenAiKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";

  try {
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [
          { imagePrompt: "Segment zero" },
          { imagePrompt: "Segment one" },
          { imagePrompt: "Segment two" }
        ]
      }],
      images: [
        { sceneIndex: 0, segmentIndex: 0, path: "/valid-existing.png" },
        { sceneIndex: 0, segmentIndex: 2, path: "/stale-existing.png" },
        { sceneIndex: 0, segmentIndex: 2, path: null },
        { sceneIndex: 99, segmentIndex: 0, path: "/outside-missing.png" }
      ],
      clips: [
        { sceneIndex: 0, segmentIndex: 1, provider: "manual-upload", path: "/valid-manual.mp4" },
        { sceneIndex: 0, segmentIndex: 2, provider: "manual-upload", path: "" },
        { sceneIndex: 98, segmentIndex: 0, provider: "manual-upload", path: "/outside-missing.mp4" }
      ]
    });
    const checkedPaths = [];
    const generated = [];

    await ensureImages(item, {
      persistItem: async () => {},
      fileExists: async (filePath) => {
        checkedPaths.push(filePath);
        return filePath === "/valid-existing.png" || filePath === "/valid-manual.mp4";
      },
      generateImage: async ({ scene }) => {
        generated.push(scene.segmentIndex);
        return { sceneIndex: scene.index, path: "/regenerated-segment-two.png" };
      }
    });

    assert.deepEqual(generated, [2]);
    assert.equal(checkedPaths.filter((path) => path === "/valid-existing.png").length, 1);
    assert.equal(checkedPaths.filter((path) => path === "/valid-manual.mp4").length, 1);
    assert.ok(item.assets.images.some((image) => image.path === "/valid-existing.png"));
    assert.ok(item.assets.images.some((image) => image.path === "/regenerated-segment-two.png"));
    assert.ok(item.assets.images.some((image) => image.path === "/outside-missing.png"));
    assert.ok(!item.assets.images.some((image) => image.path === "/stale-existing.png"));
    assert.ok(!item.assets.images.some((image) => !image.path && image.sceneIndex === 0));
    assert.ok(item.assets.clips.some((clip) => clip.path === "/valid-manual.mp4"));
    assert.ok(item.assets.clips.some((clip) => clip.path === "/outside-missing.mp4"));
    assert.ok(!item.assets.clips.some((clip) => !clip.path && clip.sceneIndex === 0));
  } finally {
    config.openai.apiKey = originalOpenAiKey;
  }
});

test("ensureImages: cache keberadaan media membedakan spasi internal pada path", async () => {
  const originalOpenAiKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";

  try {
    const doubleSpacePath = "C:\\media\\clip  one.png";
    const singleSpacePath = "C:\\media\\clip one.png";
    const checkedPaths = [];
    const generated = [];
    const item = makeItem({
      scenes: [{
        index: 0,
        sceneType: "image",
        visualSegments: [
          { imagePrompt: "Segment double space" },
          { imagePrompt: "Segment single space" }
        ]
      }],
      images: [
        { sceneIndex: 0, segmentIndex: 0, path: doubleSpacePath },
        { sceneIndex: 0, segmentIndex: 1, path: singleSpacePath }
      ]
    });

    await ensureImages(item, {
      persistItem: async () => {},
      fileExists: async (filePath) => {
        checkedPaths.push(filePath);
        return filePath === doubleSpacePath;
      },
      generateImage: async ({ scene }) => {
        generated.push(scene.segmentIndex);
        return { sceneIndex: scene.index, path: "C:\\media\\generated.png" };
      }
    });

    assert.deepEqual(checkedPaths, [doubleSpacePath, singleSpacePath]);
    assert.deepEqual(generated, [1]);
    assert.ok(item.assets.images.some((image) => image.path === doubleSpacePath));
    assert.ok(!item.assets.images.some((image) => image.path === singleSpacePath));
  } finally {
    config.openai.apiKey = originalOpenAiKey;
  }
});
