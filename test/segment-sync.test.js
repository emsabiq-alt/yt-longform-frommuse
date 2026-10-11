import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentDurations, resolveSceneMediaList } from "../src/longform-render.js";

// Helper: scene 20 detik dengan 4 visualSegments dan caption Whisper per bagian.
// Narasi: pembuka (0-5s), inti a (5-10s), inti b (10-15s), penutup (15-20s).
function makeSyncedScene() {
  return {
    durationSec: 20,
    visualSegments: [
      { narrativeContext: "kapal besi pertama diluncurkan" },
      { narrativeContext: "hukum archimedes menjelaskan gaya angkat" },
      { narrativeContext: "rongga udara di dalam lambung" },
      { narrativeContext: "kapal modern mengangkut ribuan kontainer" }
    ],
    sceneCaptions: [
      { start: 0, end: 5, text: "Saat kapal besi pertama diluncurkan banyak orang yakin benda itu pasti tenggelam" },
      { start: 5, end: 10, text: "Namun hukum Archimedes menjelaskan gaya angkat yang bekerja pada benda di air" },
      { start: 10, end: 15, text: "Kuncinya ada pada rongga udara di dalam lambung yang membuat kepadatan turun" },
      { start: 15, end: 20, text: "Berkat prinsip itu kapal modern mengangkut ribuan kontainer melintasi samudra" }
    ]
  };
}

test("computeSegmentDurations menyelaraskan batas segmen dengan waktu frasa diucapkan", () => {
  const durations = computeSegmentDurations(makeSyncedScene(), 4);
  assert.equal(durations.length, 4);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05, `total harus ~20, dapat ${total}`);
  // Frasa segmen 2 ("hukum archimedes...") mulai ~5.35s (kata ke-2 caption kedua),
  // jadi durasi segmen 1 harus mendekati 5, bukan pembagian rata biasa yang kebetulan sama.
  assert.ok(durations[0] > 4 && durations[0] < 6.5, `durasi segmen 1: ${durations[0]}`);
  assert.ok(durations.every((d) => d > 1), "tiap segmen minimal > 1 detik");
});

test("computeSegmentDurations mengikuti frasa yang tidak di posisi rata", () => {
  const scene = makeSyncedScene();
  // Geser frasa segmen 2 ke caption pertama (awal audio) → segmen 1 jadi pendek.
  scene.visualSegments[1].narrativeContext = "banyak orang yakin";
  const durations = computeSegmentDurations(scene, 4);
  assert.ok(durations[0] < 4, `segmen 1 harus lebih pendek dari pembagian rata, dapat ${durations[0]}`);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05);
});

test("computeSegmentDurations fallback ke pembagian rata tanpa captions", () => {
  const scene = makeSyncedScene();
  scene.sceneCaptions = [];
  const durations = computeSegmentDurations(scene, 4);
  assert.deepEqual(durations, [5, 5, 5, 5]);
});

test("computeSegmentDurations fallback rata saat narrativeContext tidak cocok", () => {
  const scene = makeSyncedScene();
  scene.visualSegments = scene.visualSegments.map(() => ({ narrativeContext: "frasa fiktif zeppelin quantum" }));
  const durations = computeSegmentDurations(scene, 4);
  // Tidak ada frasa yang cocok → semua batas memakai posisi rata.
  assert.deepEqual(durations, [5, 5, 5, 5]);
});

test("computeSegmentDurations menjaga urutan monoton saat frasa tumpang tindih", () => {
  const scene = makeSyncedScene();
  // Segmen 3 memakai frasa yang lebih awal dari segmen 2 → harus dikoreksi monoton.
  scene.visualSegments[2].narrativeContext = "kapal besi pertama diluncurkan";
  const durations = computeSegmentDurations(scene, 4);
  assert.equal(durations.length, 4);
  assert.ok(durations.every((d) => d > 0.5), `semua durasi positif dan wajar: ${durations}`);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05);
});

test("computeSegmentDurations aman untuk 1 segmen dan durasi nol", () => {
  assert.deepEqual(computeSegmentDurations({ durationSec: 12 }, 1), [12]);
  assert.deepEqual(computeSegmentDurations({ durationSec: 0, visualSegments: [] }, 4), [0]);
});

test("resolveSceneMediaList: tidak menduplikasi klip video yang sama pada segmen berbeda", () => {
  const item = {
    assets: {
      clips: [
        { sceneIndex: 1, segmentIndex: 0, path: "/tmp/clip-1.mp4" },
        { sceneIndex: 1, segmentIndex: 1, path: "/tmp/clip-2.mp4" }
      ],
      images: [
        { sceneIndex: 1, segmentIndex: 2, path: "/tmp/image-3.jpg" },
        { sceneIndex: 1, segmentIndex: 3, path: "/tmp/image-4.jpg" }
      ]
    }
  };
  const scene = {
    index: 1,
    durationSec: 16,
    visualSegments: [{}, {}, {}, {}]
  };

  const list = resolveSceneMediaList(item, scene);
  assert.equal(list.length, 4);
  const paths = list.map((m) => m.path);
  const uniquePaths = new Set(paths);
  assert.equal(uniquePaths.size, 4, "Setiap segmen harus memiliki media unik tanpa duplikasi");
  assert.equal(list[0].type, "video");
  assert.equal(list[1].type, "video");
  assert.equal(list[2].type, "image");
  assert.equal(list[3].type, "image");
});

test("resolveSceneMediaList: menargetkan minimal 2-3 media unik pada scene panjang tanpa looping video", () => {
  const item = {
    assets: {
      clips: [
        { sceneIndex: 2, segmentIndex: 0, path: "/tmp/volcano-1.mp4" },
        { sceneIndex: 3, segmentIndex: 0, path: "/tmp/volcano-2.mp4" }
      ],
      images: [
        { sceneIndex: 2, segmentIndex: 0, path: "/tmp/photo-1.jpg" }
      ]
    }
  };
  const scene = {
    index: 2,
    durationSec: 18,
    visualSegments: [{}]
  };

  const list = resolveSceneMediaList(item, scene);
  assert.ok(list.length >= 3, "Scene 18s harus menghasilkan minimal 3 variasi media");
  const videoClips = list.filter((m) => m.type === "video");
  const videoPaths = videoClips.map((v) => v.path);
  const uniqueVideoPaths = new Set(videoPaths);
  assert.equal(videoPaths.length, uniqueVideoPaths.size, "Klip video tidak boleh berulang dalam satu scene");
});
