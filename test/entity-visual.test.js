import { test } from "node:test";
import assert from "node:assert/strict";
import { isSpecificEntityScene, extractSceneRealEntityQuery } from "../src/news-image.js";
import { resolveSceneMediaList } from "../src/longform-render.js";

test("isSpecificEntityScene: mendeteksi tokoh nyata dalam narasi", () => {
  const scene1 = {
    index: 1,
    narration: "Jim O'Neill dari Goldman Sachs pertama kali mencetuskan akronim BRIC pada tahun 2001."
  };
  assert.equal(isSpecificEntityScene(scene1), true);
  assert.equal(extractSceneRealEntityQuery(scene1), "Jim O'Neill");

  const scene2 = {
    index: 2,
    narration: "Presiden Prabowo Subianto menegaskan posisi politik luar negeri Indonesia yang bebas aktif."
  };
  assert.equal(isSpecificEntityScene(scene2), true);
  assert.match(extractSceneRealEntityQuery(scene2), /Prabowo/i);
});

test("isSpecificEntityScene: mendeteksi peta negara dan geopolitik", () => {
  const scene1 = {
    index: 3,
    narration: "Indonesia dipandang sebagai salah satu kekuatan maritim dunia dengan posisi kepulauan yang sangat strategis."
  };
  assert.equal(isSpecificEntityScene(scene1), true);
  assert.equal(extractSceneRealEntityQuery(scene1), "peta indonesia");

  const scene2 = {
    index: 4,
    narration: "Perubahan tatanan geopolitik global mempengaruhi dinamika aliansi di berbagai belahan bumi."
  };
  assert.equal(isSpecificEntityScene(scene2), true);
  assert.equal(extractSceneRealEntityQuery(scene2), "peta dunia");
});

test("isSpecificEntityScene: mendeteksi KTT, organisasi dunia, dan landmark bersejarah", () => {
  const scene1 = {
    index: 5,
    narration: "Dalam pertemuan KTT BRICS di Kazan, sejumlah negara baru resmi mengajukan keanggotaan."
  };
  assert.equal(isSpecificEntityScene(scene1), true);
  assert.match(extractSceneRealEntityQuery(scene1), /BRICS/i);

  const scene2 = {
    index: 6,
    narration: "Letusan dahsyat Gunung Krakatau pada tahun 1883 mengubah iklim global selama bertahun-tahun."
  };
  assert.equal(isSpecificEntityScene(scene2), true);
  assert.match(extractSceneRealEntityQuery(scene2), /Krakatau/i);
});

test("isSpecificEntityScene: menolak scene umum tanpa entitas konkret atau reaction/summary", () => {
  const sceneGeneric = {
    index: 7,
    narration: "Namun pertanyaannya, bagaimana semua proses ini sebenarnya dimulai?"
  };
  assert.equal(isSpecificEntityScene(sceneGeneric), false);

  const sceneReaction = {
    index: 8,
    sceneType: "reaction",
    narration: "Tapi benarkah dampaknya sebesar itu?"
  };
  assert.equal(isSpecificEntityScene(sceneReaction), false);

  const sceneSummary = {
    index: 9,
    sceneType: "summary",
    narration: "Itulah ringkasan penting yang perlu kita pahami bersama."
  };
  assert.equal(isSpecificEntityScene(sceneSummary), false);
});

test("resolveSceneMediaList: memprioritaskan foto nyata Serper sebagai hero image dengan companion background video", () => {
  const item = {
    assets: {
      clips: [
        { sceneIndex: 1, segmentIndex: 0, path: "/tmp/pexels-conference-broll.mp4" }
      ],
      images: [
        {
          sceneIndex: 1,
          segmentIndex: 0,
          path: "/tmp/real-jim-oneill.jpg",
          provider: "google-images",
          isRealEntity: true,
          query: "Jim O'Neill"
        }
      ]
    }
  };

  const scene = {
    index: 1,
    durationSec: 8,
    narration: "Jim O'Neill dari Goldman Sachs pertama kali mencetuskan akronim BRIC.",
    visualSegments: [{}]
  };

  const mediaList = resolveSceneMediaList(item, scene);
  assert.ok(mediaList.length >= 1);
  assert.equal(mediaList[0].type, "image", "Foto nyata Serper harus menjadi tipe visual utama (hero image)");
  assert.equal(mediaList[0].path, "/tmp/real-jim-oneill.jpg");
  assert.equal(
    mediaList[0].backgroundVideoPath,
    "/tmp/pexels-conference-broll.mp4",
    "Klip video Pexels harus dipasangkan sebagai backgroundVideoPath"
  );
  assert.equal(mediaList[0].isRealEntity, true);
});

test("resolveSceneMediaList: tetap memakai video biasa jika scene bukan entitas riil", () => {
  const item = {
    assets: {
      clips: [
        { sceneIndex: 2, segmentIndex: 0, path: "/tmp/pexels-timelapse.mp4" }
      ],
      images: [
        {
          sceneIndex: 2,
          segmentIndex: 0,
          path: "/tmp/ai-generated.jpg",
          provider: "openai"
        }
      ]
    }
  };

  const scene = {
    index: 2,
    durationSec: 8,
    narration: "Waktu terus bergulir dan perkembangan teknologi berjalan sangat cepat.",
    visualSegments: [{}]
  };

  const mediaList = resolveSceneMediaList(item, scene);
  assert.ok(mediaList.length >= 1);
  assert.equal(mediaList[0].type, "video", "Klip Pexels tetap diutamakan untuk scene umum non-entitas");
  assert.equal(mediaList[0].path, "/tmp/pexels-timelapse.mp4");
});

test("resolveSceneMediaList: scene dengan mockup beralih ke video background agar tidak tampil bersamaan dengan gambar", () => {
  const item = {
    assets: {
      clips: [
        { sceneIndex: 3, segmentIndex: 0, path: "/tmp/pexels-broll-bg.mp4" }
      ],
      images: [
        {
          sceneIndex: 3,
          segmentIndex: 0,
          path: "/tmp/real-photo.jpg",
          provider: "google-images",
          isRealEntity: true
        }
      ],
      newsImages: [
        {
          sceneIndex: 3,
          imagePath: "/tmp/unique-mockup-doc.jpg"
        }
      ]
    }
  };

  const scene = {
    index: 3,
    durationSec: 8,
    narration: "Dokumen ini menunjukkan bukti kuat.",
    visualSegments: [{}]
  };

  const mediaList = resolveSceneMediaList(item, scene);
  assert.ok(mediaList.length >= 1);
  assert.equal(mediaList[0].type, "video", "Scene dengan mockup harus memakai latar video, bukan foto");
  assert.equal(mediaList[0].path, "/tmp/pexels-broll-bg.mp4");
});
