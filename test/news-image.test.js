import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  ensureNewsImages,
  scrapeOgImage,
  applyNewsImageOverlays,
  extractSceneRealEntityQuery,
  isNewsItemRelevantToScene,
  fetchWikipediaImage,
  isValidImageBuffer,
  createHeaderCardImage
} from "../src/news-image.js";

test("ensureNewsImages: memakai fallback gambar scene saat imageUrl tidak ada (Tab Buat)", async () => {
  const origSerper = process.env.SERPER_API_KEY;
  const origSerpers = process.env.SERPER_API_KEYS;
  const origCseKey = process.env.GOOGLE_CSE_KEY;
  const origCseCx = process.env.GOOGLE_CSE_CX;
  const origSerpApi = process.env.SERPAPI_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.SERPER_API_KEYS;
  delete process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_CX;
  delete process.env.SERPAPI_API_KEY;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-test-"));
  const fakeImgPath = path.join(tmpDir, "scene-2.jpg");
  await fs.writeFile(fakeImgPath, "fake image data");

  const item = {
    plan: {
      scenes: [
        { index: 1, sceneType: "image", screenText: "Hook" },
        { index: 2, sceneType: "image", screenText: "Pembahasan utama", mediaSource: { outlet: "Jurnal Sains", headline: "Temuan Baru" } },
        { index: 3, sceneType: "image", screenText: "Penutup" }
      ]
    },
    input: { topic: "Eksplorasi Luar Angkasa" },
    assets: {
      images: [
        { sceneIndex: 2, path: fakeImgPath }
      ]
    }
  };

  try {
    await ensureNewsImages(item);
    assert.equal(item.assets.newsImages.length, 1);
    assert.equal(item.assets.newsImages[0].sceneIndex, 2);
    assert.equal(item.assets.newsImages[0].imagePath, fakeImgPath);
    assert.equal(item.assets.newsImages[0].outlet, "Jurnal Sains");
  } finally {
    if (origSerper) process.env.SERPER_API_KEY = origSerper;
    if (origSerpers) process.env.SERPER_API_KEYS = origSerpers;
    if (origCseKey) process.env.GOOGLE_CSE_KEY = origCseKey;
    if (origCseCx) process.env.GOOGLE_CSE_CX = origCseCx;
    if (origSerpApi) process.env.SERPAPI_API_KEY = origSerpApi;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("ensureNewsImages: memilih kandidat scene otomatis jika mediaSource tidak disertakan", async () => {
  const origSerper = process.env.SERPER_API_KEY;
  const origSerpers = process.env.SERPER_API_KEYS;
  const origCseKey = process.env.GOOGLE_CSE_KEY;
  const origCseCx = process.env.GOOGLE_CSE_CX;
  const origSerpApi = process.env.SERPAPI_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.SERPER_API_KEYS;
  delete process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_CX;
  delete process.env.SERPAPI_API_KEY;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-auto-"));
  const fakeImg1 = path.join(tmpDir, "scene-1.jpg");
  const fakeImg2 = path.join(tmpDir, "scene-2.jpg");
  await fs.writeFile(fakeImg1, "fake image 1");
  await fs.writeFile(fakeImg2, "fake image 2");

  const item = {
    plan: {
      scenes: [
        { index: 1, sceneType: "image", screenText: "Intro" },
        { index: 2, sceneType: "image", screenText: "Fakta 1" },
        { index: 3, sceneType: "image", screenText: "Fakta 2" }
      ]
    },
    input: { topic: "Teknologi AI" },
    assets: {
      images: [
        { sceneIndex: 1, path: fakeImg1 },
        { sceneIndex: 2, path: fakeImg2 }
      ]
    }
  };

  try {
    await ensureNewsImages(item);
    assert.ok(item.assets.newsImages.length >= 1, "Harus memilih minimal 1 scene kandidat");
    assert.ok(item.assets.newsImages[0].imagePath, "imagePath harus terisi dengan fallback");
  } finally {
    if (origSerper) process.env.SERPER_API_KEY = origSerper;
    if (origSerpers) process.env.SERPER_API_KEYS = origSerpers;
    if (origCseKey) process.env.GOOGLE_CSE_KEY = origCseKey;
    if (origCseCx) process.env.GOOGLE_CSE_CX = origCseCx;
    if (origSerpApi) process.env.SERPAPI_API_KEY = origSerpApi;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("applyNewsImageOverlays: animasi slide masuk dari bawah, rapat ke batas bawah, dan slide keluar ke bawah", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-anim-"));
  const fakeImg = path.join(tmpDir, "news-pic.jpg");
  const inVideo = path.join(tmpDir, "input.mp4");
  const outVideo = path.join(tmpDir, "output.mp4");
  await fs.writeFile(fakeImg, "dummy image");
  await fs.writeFile(inVideo, "dummy video");

  const item = {
    assets: {
      newsImages: [
        { sceneIndex: 1, outlet: "CNN", headline: "Berita", imagePath: fakeImg }
      ]
    }
  };

  const renderScenes = [
    { index: 1, startSec: 0, endSec: 10 }
  ];

  const capturedCalls = [];
  const mockRunFfmpeg = async (args) => {
    capturedCalls.push(args);
  };

  try {
    await applyNewsImageOverlays(inVideo, outVideo, item, renderScenes, "1080p", mockRunFfmpeg);
    assert.equal(capturedCalls.length, 2, "Harus membuat clip mockup MOV lalu overlay ke MP4");

    // 1. Periksa pembuatan clip mockup:
    // - chromakey diaplikasikan pada template [1:v] TERLEBIH DAHULU sebelum overlay konten
    // - tidak ada filter fade in / fade out
    const clipCall = capturedCalls[0];
    const clipFilter = clipCall[clipCall.indexOf("-filter_complex") + 1];
    assert.ok(clipFilter.includes("chromakey=color="), "Harus memuat chromakey");
    assert.ok(clipFilter.includes("despill=green"), "Harus memuat despill");
    assert.ok(clipFilter.includes("[tmpl_keyed][content]overlay="), "Harus meng-overlay konten ke template yang sudah di-key");
    assert.ok(!clipFilter.includes("fade=t=in"), "TIDAK BOLEH memuat fade in pada mockup");
    assert.ok(!clipFilter.includes("fade=t=out"), "TIDAK BOLEH memuat fade out pada mockup");

    // 2. Periksa overlay ke video utama:
    // - Y position rapat ke batas layar bawah (H - overlay_h)
    // - Menggunakan ekspresi animasi slide masuk dan slide keluar
    const overlayCall = capturedCalls[1];
    const overlayFilter = overlayCall[overlayCall.indexOf("-filter_complex") + 1];
    assert.ok(overlayFilter.includes("H-overlay_h"), "Mockup harus rapat ke batas layar bawah");
    assert.ok(overlayFilter.includes("cos(PI*"), "Animasi harus menggunakan cosine slide easing");
    assert.ok(overlayFilter.includes("overlay=x='(W-overlay_w)/2':y='if(lte(t,"), "Overlay harus menggunakan ekspresi slide dinamis");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("mockup otomatis tersebar di empat bagian dokumenter panjang dan memakai gambar scene terkait", async (t) => {
  const names = ["SERPER_API_KEY", "SERPER_API_KEYS", "GOOGLE_CSE_KEY", "GOOGLE_CSE_CX", "SERPAPI_API_KEY"];
  const previous = names.map((name) => process.env[name]);
  names.forEach((name) => { delete process.env[name]; });
  t.after(() => names.forEach((name, i) => {
    if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
  }));
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 404 }));
  const scenes = Array.from({ length: 32 }, (_, i) => ({ index: i + 1, sceneType: "image", screenText: `Bagian ${i + 1}` }));
  const item = { input: {}, plan: { scenes }, assets: {
    images: scenes.map((scene) => ({ sceneIndex: scene.index, path: `scene-${scene.index}.jpg` }))
  } };
  await ensureNewsImages(item);
  assert.equal(item.assets.newsImages.length, 8);
  for (let quarter = 0; quarter < 4; quarter++) {
    assert.equal(item.assets.newsImages.filter((n) => n.sceneIndex > quarter * 8 && n.sceneIndex <= (quarter + 1) * 8).length, 2);
  }
  item.assets.newsImages.forEach((n) => assert.equal(n.imagePath, `scene-${n.sceneIndex}.jpg`));
});

test("ensureNewsImages: subjek yang sama tidak muncul lebih dari 1 kali sebagai mockup", async (t) => {
  const names = ["SERPER_API_KEY", "SERPER_API_KEYS", "GOOGLE_CSE_KEY", "GOOGLE_CSE_CX", "SERPAPI_API_KEY"];
  const previous = names.map((name) => process.env[name]);
  names.forEach((name) => { delete process.env[name]; });
  t.after(() => names.forEach((name, i) => {
    if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
  }));
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 404 }));
  // 16 scene, semua screenText SAMA ("Anak Krakatau") -- topik dominan tunggal yang
  // gampang terpilih berulang di banyak scene sekaligus (kasus nyata: video 1 topik).
  const scenes = Array.from({ length: 16 }, (_, i) => ({ index: i + 1, sceneType: "image", screenText: "Anak Krakatau" }));
  const item = { input: { topic: "Anak Krakatau" }, plan: { scenes }, assets: {
    images: scenes.map((scene) => ({ sceneIndex: scene.index, path: `scene-${scene.index}.jpg` }))
  } };
  await ensureNewsImages(item);
  // Tanpa dedup, count = min(8, ceil(16/4)) = 4 kandidat -- semuanya headline sama.
  // Dengan dedup, hanya kandidat PERTAMA yang lolos.
  assert.equal(item.assets.newsImages.length, 1, "subjek sama harus di-dedup jadi 1 mockup saja");
});

test("extractSceneRealEntityQuery: mengekstrak nama tempat dan entitas konkret dari narasi", () => {
  const scene1 = {
    screenText: "Fakta 1",
    narration: "Letusan purba Gunung Toba melahirkan Danau Toba yang sekarang menjadi danau vulkanik terbesar."
  };
  const q1 = extractSceneRealEntityQuery(scene1, "Anak Kratau vs Gunung Toba");
  assert.equal(q1, "Gunung Toba");

  const scene2 = {
    screenText: "Fakta 2",
    narration: "Sementara itu, letusan dahsyat melahirkan Danau Toba di Sumatera Utara."
  };
  const q2 = extractSceneRealEntityQuery(scene2, "Erupsi Vulkanik");
  assert.equal(q2, "Danau Toba");

  const scene3 = {
    screenText: "Fakta 3",
    spotlight: { label: "BJ Habibie", type: "figure" },
    narration: "Presiden memimpin pengembangan teknologi nasional."
  };
  const q3 = extractSceneRealEntityQuery(scene3, "Teknologi");
  assert.equal(q3, "BJ Habibie");

  const sceneIndonesia = {
    screenText: "Peran Global",
    narration: "Indonesia sebagai salah satu kekuatan dunia memiliki peran strategis di kancah global."
  };
  const qIndo = extractSceneRealEntityQuery(sceneIndonesia, "BRICS dan Pengaruh Global");
  assert.equal(qIndo, "peta indonesia");

  const sceneFigure = {
    screenText: "Lahirnya Konsep",
    narration: "Pada tahun 2001, ekonom Jim O'Neill merumuskan potensi besar empat negara berkembang."
  };
  const qFig = extractSceneRealEntityQuery(sceneFigure, "Sejarah BRICS");
  assert.equal(qFig, "Jim O'Neill");

  const sceneSummit = {
    screenText: "Pertemuan Puncak",
    narration: "Konferensi Tingkat Tinggi KTT BRICS menjadi panggung perundingan mata uang dan perdagangan."
  };
  const qSummit = extractSceneRealEntityQuery(sceneSummit, "Ekonomi Global");
  assert.equal(qSummit, "KTT BRICS");
});

test("extractSceneRealEntityQuery: menangani visualKeywords string dan visualSegments tanpa error", () => {
  const sceneStr = {
    screenText: "Scene 1",
    visualKeywords: "krakatau caldera eruption, volcanic ash",
    visualSegments: [
      { visualKeywords: "danau toba supervolcano" }
    ]
  };
  const q = extractSceneRealEntityQuery(sceneStr, "Gunung Purba");
  assert.equal(q, "krakatau caldera eruption");

  const sceneSegStr = {
    screenText: "Scene 2",
    visualSegments: [
      { visualKeywords: "candi borobudur megah" }
    ]
  };
  const q2 = extractSceneRealEntityQuery(sceneSegStr, "Sejarah");
  assert.equal(q2, "candi borobudur megah");
});

test("isNewsItemRelevantToScene: menolak berita tidak relevan dan menerima berita yang cocok", () => {
  const sceneToba = {
    screenText: "Letusan Danau Toba",
    narration: "Danau Toba terbentuk akibat letusan supervolcano purba sekitar 74 ribu tahun yang lalu."
  };

  const unrelatedNews = {
    headline: "Jejak Ulta Levenia, Deputi Bakom RI, dan Teori Konspirasinya HAARP",
    excerpt: "Viral konspirasi HAARP mengendalikan cuaca dan bencana di Batam."
  };
  assert.equal(isNewsItemRelevantToScene(unrelatedNews, sceneToba), false, "Berita konspirasi HAARP tidak boleh cocok dengan Danau Toba");

  const relevantNews = {
    headline: "Penelitian Terbaru Endapan Vulkanik Danau Toba Mengungkap Bukti Zaman Es",
    excerpt: "Letusan dahsyat gunung purba di Toba meninggalkan jejak sulfur tebal di atmosfer."
  };
  assert.equal(isNewsItemRelevantToScene(relevantNews, sceneToba), true, "Berita riset Toba harus cocok dengan Danau Toba");
});

test("isValidImageBuffer: memvalidasi magic header gambar dan menolak HTML redirect", () => {
  const htmlBuf = Buffer.from("<html><head><script>location.href='https://facebook.com';</script></head></html>");
  assert.equal(isValidImageBuffer(htmlBuf), false);

  const tinyBuf = Buffer.from([0xFF, 0xD8, 0xFF]);
  assert.equal(isValidImageBuffer(tinyBuf), false, "File terlalu kecil harus ditolak");

  const validJpg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(1500)]);
  assert.equal(isValidImageBuffer(validJpg), true);

  const validPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), Buffer.alloc(1500)]);
  assert.equal(isValidImageBuffer(validPng), true);
});

test("fetchWikipediaImage: mengembalikan gambar ensiklopedis nyata untuk Danau Toba", async () => {
  const res = await fetchWikipediaImage("Danau Toba");
  assert.ok(res, "Harus menemukan artikel Danau Toba");
  assert.ok(res.imageUrl.startsWith("http"), "Harus memiliki URL gambar");
  assert.equal(res.outlet, "Wikipedia Indonesia");
  assert.equal(res.title, "Danau Toba");
});

test("createHeaderCardImage: berhasil membuat kartu header PNG", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-card-"));
  const cardPath = path.join(tmpDir, "card.png");
  try {
    await createHeaderCardImage({
      outlet: "Wikipedia Indonesia",
      headline: "Danau Toba",
      width: 780,
      isPhone: false,
      destPath: cardPath
    });
    const stat = await fs.stat(cardPath);
    assert.ok(stat.size > 1000, "Ukuran kartu header harus lebih besar dari 1KB");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("ensureNewsImages: menolak gambar duplikat sehingga setiap mockup memiliki gambar unik", async (t) => {
  const names = ["SERPER_API_KEY", "SERPER_API_KEYS", "GOOGLE_CSE_KEY", "GOOGLE_CSE_CX", "SERPAPI_API_KEY"];
  const previous = names.map((name) => process.env[name]);
  names.forEach((name) => { delete process.env[name]; });
  t.after(() => names.forEach((name, i) => {
    if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
  }));
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 404 }));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-dedup-img-"));
  const imgA = path.join(tmpDir, "img-a.jpg");
  const imgB = path.join(tmpDir, "img-b.jpg");
  const imgDupA = path.join(tmpDir, "img-dup-a.jpg"); // Same content as imgA
  await fs.writeFile(imgA, "identical image content A");
  await fs.writeFile(imgDupA, "identical image content A");
  await fs.writeFile(imgB, "different image content B");

  try {
    const scenes = [
      { index: 1, sceneType: "image", screenText: "Bagian 1", mediaSource: { outlet: "Media 1", headline: "Berita 1" } },
      { index: 2, sceneType: "image", screenText: "Bagian 2", mediaSource: { outlet: "Media 2", headline: "Berita 2" } },
      { index: 3, sceneType: "image", screenText: "Bagian 3", mediaSource: { outlet: "Media 3", headline: "Berita 3" } }
    ];
    const item = {
      plan: { scenes },
      input: { topic: "Uji Duplikasi" },
      assets: {
        images: [
          { sceneIndex: 1, path: imgA },
          { sceneIndex: 2, path: imgDupA }, // duplikat dari imgA
          { sceneIndex: 3, path: imgB }
        ]
      }
    };

    await ensureNewsImages(item);
    const usedPaths = item.assets.newsImages.map((n) => n.imagePath);
    const uniquePaths = new Set(usedPaths);
    assert.equal(usedPaths.length, uniquePaths.size, "Setiap mockup harus memiliki file path unik");

    // Pastikan tidak ada 2 mockup dengan konten hash yang sama
    const hashes = usedPaths.map((p) => crypto.createHash("md5").update(readFileSync(p)).digest("hex"));
    const uniqueHashes = new Set(hashes);
    assert.equal(hashes.length, uniqueHashes.size, "Setiap mockup harus memiliki konten gambar unik (tidak ada duplikat hash)");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("applyNewsImageOverlays: melewati scene yang sedang menampilkan gambar di layar", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-skip-image-"));
  const inVideo = path.join(tmpDir, "in.mp4");
  const outVideo = path.join(tmpDir, "out.mp4");
  const fakeImg = path.join(tmpDir, "mockup.jpg");
  await fs.writeFile(fakeImg, "fake image");
  await fs.writeFile(inVideo, "dummy video");

  const item = {
    assets: {
      newsImages: [
        { sceneIndex: 1, outlet: "CNN", headline: "Berita", imagePath: fakeImg }
      ]
    }
  };

  // Scene 1 sedang menampilkan media bertipe "image" di layar
  const renderScenes = [
    {
      index: 1,
      startSec: 0,
      endSec: 10,
      mediaList: [
        { type: "image", path: "/tmp/screen-photo.jpg" }
      ]
    }
  ];

  const capturedCalls = [];
  const mockRunFfmpeg = async (args) => {
    capturedCalls.push(args);
  };

  try {
    await applyNewsImageOverlays(inVideo, outVideo, item, renderScenes, "1080p", mockRunFfmpeg);
    // Karena scene 1 menampilkan gambar di layar, mockup dilewati sehingga runFfmpeg TIDAK dipanggil untuk overlay
    assert.equal(capturedCalls.length, 0, "Mockup tidak boleh di-overlay ketika scene menampilkan gambar di layar");
    const outStat = await fs.stat(outVideo);
    assert.ok(outStat.size > 0, "Video keluaran tetap tersalin dengan aman");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("applyNewsImageOverlays: melewati scene yang memiliki kartu spotlight atau terdaftar di spotlightPlacements", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-skip-spotlight-"));
  const inVideo = path.join(tmpDir, "in.mp4");
  const outVideo = path.join(tmpDir, "out.mp4");
  const fakeImg = path.join(tmpDir, "mockup.jpg");
  await fs.writeFile(fakeImg, "fake image");
  await fs.writeFile(inVideo, "dummy video");

  const item = {
    assets: {
      newsImages: [
        { sceneIndex: 1, outlet: "CNN", headline: "Berita", imagePath: fakeImg }
      ]
    }
  };

  const renderScenes = [
    {
      index: 1,
      startSec: 0,
      endSec: 10,
      mediaList: [{ type: "video", path: "/tmp/broll.mp4" }]
    }
  ];

  const capturedCalls = [];
  const mockRunFfmpeg = async (args) => {
    capturedCalls.push(args);
  };

  try {
    // 1. Lewat options.spotlightPlacements
    await applyNewsImageOverlays(inVideo, outVideo, item, renderScenes, "1080p", mockRunFfmpeg, {
      spotlightPlacements: [{ sceneIndex: 1, type: "figure" }]
    });
    assert.equal(capturedCalls.length, 0, "Mockup tidak boleh di-overlay ketika scene memiliki spotlightPlacements");

    // 2. Lewat scene.spotlight langsung
    renderScenes[0].spotlight = { type: "figure", label: "Tokoh", phrase: "kata kunci" };
    await applyNewsImageOverlays(inVideo, outVideo, item, renderScenes, "1080p", mockRunFfmpeg);
    assert.equal(capturedCalls.length, 0, "Mockup tidak boleh di-overlay ketika scene memiliki spotlight");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("applyNewsImageOverlays: melewati scene jika salah satu segmennya (misal segmen 2) menampilkan gambar", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "news-skip-multiseg-"));
  const inVideo = path.join(tmpDir, "in.mp4");
  const outVideo = path.join(tmpDir, "out.mp4");
  const fakeImg = path.join(tmpDir, "mockup.jpg");
  await fs.writeFile(fakeImg, "fake image");
  await fs.writeFile(inVideo, "dummy video");

  const item = {
    assets: {
      newsImages: [
        { sceneIndex: 1, outlet: "CNN", headline: "Berita", imagePath: fakeImg }
      ]
    }
  };

  // Segmen 1 video, tapi segmen 2 gambar
  const renderScenes = [
    {
      index: 1,
      startSec: 0,
      endSec: 10,
      mediaList: [
        { type: "video", path: "/tmp/broll.mp4" },
        { type: "image", path: "/tmp/photo.jpg" }
      ]
    }
  ];

  const capturedCalls = [];
  const mockRunFfmpeg = async (args) => {
    capturedCalls.push(args);
  };

  try {
    await applyNewsImageOverlays(inVideo, outVideo, item, renderScenes, "1080p", mockRunFfmpeg);
    assert.equal(capturedCalls.length, 0, "Mockup tidak boleh di-overlay jika salah satu segmen menampilkan gambar di layar");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});


