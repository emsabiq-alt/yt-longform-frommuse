import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChapterList, buildSrtBody, sceneCaptionSegments, srtTime } from "../src/longform-render.js";
import { buildDescription, buildChapters } from "../src/youtube-meta.js";

test("srtTime memakai format jam:menit:detik,milidetik", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(3661.5), "01:01:01,500");
  // Nilai negatif dijepit ke nol supaya file .srt tetap sah.
  assert.equal(srtTime(-3), "00:00:00,000");
});

test("buildSrtBody: nomor urut, offset pembuka, dan pemisah baris ASS jadi baris asli", () => {
  const body = buildSrtBody([
    { start: 0, end: 2, text: "Baris satu\\Nbaris dua" },
    { start: 2, end: 4, text: "Berikutnya" },
    { start: 5, end: 5, text: "Durasi nol dibuang" },
    { start: 6, end: 8, text: "" }
  ], 25);
  assert.equal(body, [
    "1",
    "00:00:25,000 --> 00:00:27,000",
    "Baris satu\nbaris dua",
    "",
    "2",
    "00:00:27,000 --> 00:00:29,000",
    "Berikutnya",
    ""
  ].join("\n"));
});

test("buildSrtBody: cue yang tumpang tindih dipotong supaya track diterima YouTube", () => {
  const body = buildSrtBody([
    { start: 0, end: 3, text: "Satu" },
    { start: 2, end: 4, text: "Dua" }
  ]);
  assert.match(body, /00:00:00,000 --> 00:00:02,000/);
  assert.match(body, /00:00:02,000 --> 00:00:04,000/);
});

test("sceneCaptionSegments: scene reaction dan summary ikut masuk subtitle", () => {
  const segments = sceneCaptionSegments([
    {
      sceneType: "image",
      startSec: 0,
      endSec: 6,
      audioDurationSec: 6,
      narration: "Kapal besi pertama diluncurkan dan banyak orang yakin akan tenggelam",
      sceneCaptions: []
    },
    {
      sceneType: "reaction",
      startSec: 6,
      endSec: 9,
      narration: "Coba tebak kenapa bisa terapung",
      sceneCaptions: []
    },
    {
      sceneType: "summary",
      startSec: 9,
      endSec: 13,
      narration: "Ringkasan inti dari pembahasan tadi",
      sceneCaptions: []
    }
  ]);
  assert.ok(segments.length >= 3, `harus ada segmen dari tiap scene, dapat ${segments.length}`);
  const joined = segments.map((segment) => segment.text).join(" ").toLowerCase();
  assert.match(joined, /coba tebak/);
  assert.match(joined, /ringkasan inti/);
  // Timeline harus naik dan tidak melewati akhir scene terakhir.
  assert.ok(segments.every((segment, i) => i === 0 || segment.start >= segments[i - 1].start));
  assert.ok(segments.at(-1).end <= 13);
});

// Scene 30 detik per bab; frontDuration meniru bumper+intro di depan konten.
function makeScenes(chapters) {
  return chapters.map((chapter, index) => ({ chapter, startSec: index * 30 }));
}

test("buildChapterList: bab pertama 00:00 dan label berulang digabung", () => {
  const scenes = makeScenes(["Pembuka", "Pembuka", "Awal Masalah", "Bukti Baru", "Penutup"]);
  const chapters = buildChapterList(scenes, 25, 175);
  assert.deepEqual(chapters, [
    { time: "0:00", label: "Pembuka" },
    { time: "1:25", label: "Awal Masalah" },
    { time: "1:55", label: "Bukti Baru" },
    { time: "2:25", label: "Penutup" }
  ]);
});

test("buildChapterList: kosong bila bab kurang dari tiga (aturan YouTube)", () => {
  assert.deepEqual(buildChapterList(makeScenes(["Pembuka", "Penutup"]), 0, 60), []);
});

test("buildChapterList: bab terakhir yang lebih pendek dari 10 detik membatalkan daftar", () => {
  const scenes = makeScenes(["Pembuka", "Awal Masalah", "Bukti Baru", "Penutup"]);
  // Total 95s sementara bab terakhir mulai di 90s → sisa 5s, di bawah batas YouTube.
  assert.deepEqual(buildChapterList(scenes, 0, 95), []);
});

test("buildChapterList: bab berdurasi di bawah 10 detik dilewati", () => {
  const scenes = [
    { chapter: "Pembuka", startSec: 0 },
    { chapter: "Kilat", startSec: 4 },
    { chapter: "Bukti Baru", startSec: 40 },
    { chapter: "Penutup", startSec: 80 }
  ];
  assert.deepEqual(buildChapterList(scenes, 0, 120), [
    { time: "0:00", label: "Pembuka" },
    { time: "0:40", label: "Bukti Baru" },
    { time: "1:20", label: "Penutup" }
  ]);
});

test("buildDescription: daftar bab (Bab: 0:00 ...) selalu dipertahankan dan tidak terpotong meski banyak aset media", () => {
  // Simulasikan 30 aset media (seperti pada video 26 scene) yang sebelumnya memicu pemotongan deskripsi
  const manyClips = Array.from({ length: 30 }, (_, i) => ({
    provider: "pixabay",
    pixabayId: 1000 + i,
    title: `video tag sample number ${i} with long description and tags`,
    creator: `Creator_${i}`,
    license: "Pixabay Content License",
    licenseUrl: "https://pixabay.com/service/license-summary/",
    sourceUrl: `https://pixabay.com/videos/id-${1000 + i}/`
  }));

  const item = {
    title: "Dua Puluh Empat Tahun BRICS",
    plan: {
      hook: "Apa penyebab kecil di balik lahirnya kekuatan besar BRICS sebenarnya?",
      summary: "Ringkasan cerita BRICS yang sangat panjang ".repeat(20),
      importantPoints: ["Poin satu", "Poin dua", "Poin tiga"],
      scenes: [
        { index: 1, chapter: "Pembuka", durationSec: 30 },
        { index: 2, chapter: "Awal Masalah", durationSec: 40 },
        { index: 3, chapter: "Bukti Baru", durationSec: 50 }
      ]
    },
    assets: {
      video: {
        chapters: [
          { time: "0:00", label: "Awal Kisah BRICS" },
          { time: "1:15", label: "Rintangan dan Perkembangan" },
          { time: "3:40", label: "Indonesia dan Masa Depan" }
        ]
      },
      clips: manyClips,
      images: []
    }
  };

  const desc = buildDescription(item);
  assert.ok(desc.length <= 4900, `Deskripsi tidak boleh melebihi batas 4900 YouTube, panjang: ${desc.length}`);
  assert.match(desc, /Bab:/, "Deskripsi WAJIB memuat bagian Bab:");
  assert.match(desc, /0:00 Awal Kisah BRICS/, "Timestamp 0:00 bab pertama harus ada");
  assert.match(desc, /1:15 Rintangan dan Perkembangan/, "Timestamp bab kedua harus ada");
  assert.match(desc, /3:40 Indonesia dan Masa Depan/, "Timestamp bab ketiga harus ada");
});

test("buildChapters: fallback ke estimasi storyboard jika item belum memiliki assets.video.chapters", () => {
  const item = {
    plan: {
      scenes: [
        { index: 1, chapter: "Pembuka", durationSec: 30 },
        { index: 2, chapter: "Awal Masalah", durationSec: 35 },
        { index: 3, chapter: "Bukti Baru", durationSec: 40 },
        { index: 4, chapter: "Penutup", durationSec: 40 }
      ]
    },
    assets: {}
  };

  const ch = buildChapters(item);
  assert.ok(ch.length > 0, "Harus menghasilkan bab dari estimasi storyboard");
  assert.match(ch, /0:00 Pembuka/);
  assert.match(ch, /0:30 Awal Masalah/);
  assert.match(ch, /1:05 Bukti Baru/);
});
