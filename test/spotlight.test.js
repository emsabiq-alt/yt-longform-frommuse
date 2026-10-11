import { test } from "node:test";
import assert from "node:assert/strict";
import { planSceneSpotlights, normalizeSpotlight, extractAutoSpotlight, spotlightDialogueLines } from "../src/spotlight.js";
import { buildWordTimeline, findPhraseTime, tokenizeMatchText } from "../src/word-timeline.js";
import { polishPlanForLayAudience } from "../src/story-language.js";

function words(list, start = 0, step = 0.5) {
  return list.map((word, i) => ({ word, start: start + i * step, end: start + (i + 1) * step }));
}

function scene(overrides = {}) {
  return {
    index: 1,
    sceneType: "image",
    startSec: 0,
    durationSec: 20,
    sceneCaptions: [{
      start: 0,
      end: 5,
      text: "kecepatan suara mencapai seribu dua ratus kilometer per jam di udara",
      words: words(["kecepatan", "suara", "mencapai", "seribu", "dua", "ratus", "kilometer", "per", "jam", "di", "udara"])
    }],
    spotlight: { type: "keypoint", label: "1.200 km/jam", sublabel: "kecepatan suara", phrase: "seribu dua ratus kilometer" },
    ...overrides
  };
}

test("buildWordTimeline memakai timestamp kata asli bila tersedia", () => {
  const timeline = buildWordTimeline([{
    start: 0,
    end: 10,
    text: "satu dua tiga",
    words: [{ word: "satu", start: 0.2, end: 0.4 }, { word: "dua", start: 4.0, end: 4.3 }, { word: "tiga", start: 9.1, end: 9.4 }]
  }]);
  assert.deepEqual(timeline.map((entry) => entry.token), ["satu", "dua", "tiga"]);
  // Interpolasi rata akan menaruh "dua" di detik 3.33; timestamp asli 4.0.
  assert.equal(timeline[1].time, 4.0);
});

test("buildWordTimeline jatuh ke interpolasi saat tidak ada timestamp kata", () => {
  const timeline = buildWordTimeline([{ start: 0, end: 3, text: "satu dua tiga" }]);
  assert.equal(timeline.length, 3);
  assert.equal(timeline[1].time, 1);
});

test("spotlight ditempatkan pada waktu frasa benar-benar diucapkan", () => {
  const placed = planSceneSpotlights([scene()]);
  assert.equal(placed.length, 1);
  // "seribu" mulai di detik 1.5 (kata ke-4), dikurangi lead-in 0.12.
  assert.ok(Math.abs(placed[0].startSec - 1.38) < 0.01, `startSec=${placed[0].startSec}`);
  assert.ok(placed[0].score >= 0.6);
});

test("spotlight dibatalkan saat frasa tidak ada di audio", () => {
  const placed = planSceneSpotlights([scene({
    spotlight: { type: "keypoint", label: "X", phrase: "gravitasi bulan menarik lautan" }
  })]);
  assert.deepEqual(placed, []);
});

test("kuota per video dan jarak minimum ditegakkan", () => {
  const many = Array.from({ length: 10 }, (_, i) => scene({
    index: i + 1,
    startSec: i * 30,
    durationSec: 30
  }));
  const placed = planSceneSpotlights(many);
  assert.ok(placed.length <= 14, `terlalu banyak kartu: ${placed.length}`);
  for (let i = 1; i < placed.length; i += 1) {
    assert.ok(placed[i].startSec - placed[i - 1].startSec >= 8);
  }
});

test("scene reaction dan summary tidak pernah dapat kartu", () => {
  assert.deepEqual(planSceneSpotlights([scene({ sceneType: "reaction" }), scene({ sceneType: "summary" })]), []);
});

test("scene yang memiliki mockup atau masuk excludedSceneIndexes tidak pernah dapat kartu spotlight", () => {
  const sc1 = scene({ index: 1 });
  const sc2 = scene({ index: 2, hasMockup: true });
  const sc3 = scene({ index: 3 });

  // sc2 punya hasMockup -> harus dilewati
  const placed1 = planSceneSpotlights([sc1, sc2]);
  assert.equal(placed1.some((p) => p.sceneIndex === 2), false);

  // sc3 diexclude lewat excludedSceneIndexes (Set atau Array)
  const placed2 = planSceneSpotlights([sc1, sc3], { excludedSceneIndexes: new Set([3]) });
  assert.equal(placed2.some((p) => p.sceneIndex === 3), false);

  const placed3 = planSceneSpotlights([sc1, sc3], { excludedSceneIndexes: [3] });
  assert.equal(placed3.some((p) => p.sceneIndex === 3), false);
});

test("kuota spotlight tersebar sampai bab terakhir dari 48 scene", () => {
  const scenes = Array.from({ length: 48 }, (_, i) => scene({ index: i + 1, startSec: i * 25, durationSec: 25 }));
  const cards = planSceneSpotlights(scenes);
  assert.equal(cards.length, 22);
  assert.equal(cards[0].sceneIndex, 1);
  assert.equal(cards.at(-1).sceneIndex, 48);
  for (let quarter = 0; quarter < 4; quarter++) {
    assert.ok(cards.filter((card) => card.startSec >= quarter * 300 && card.startSec < (quarter + 1) * 300).length >= 5);
  }
  assert.deepEqual(planSceneSpotlights(scenes, { maxPerVideo: 0 }), []);
  assert.equal(planSceneSpotlights(scenes, { maxPerVideo: 1 }).length, 1);
});

test("kartu dipotong di akhir scene, bukan menyeberang", () => {
  const placed = planSceneSpotlights([scene({ durationSec: 4 })]);
  assert.equal(placed.length, 1);
  assert.ok(placed[0].endSec <= 4 + 1e-6, `endSec=${placed[0].endSec}`);
});

test("kartu dibatalkan bila sisa scene terlalu pendek untuk dibaca", () => {
  assert.deepEqual(planSceneSpotlights([scene({ durationSec: 2.6 })]), []);
});

test("normalizeSpotlight menolak data tanpa label atau frasa", () => {
  assert.equal(normalizeSpotlight({ label: "A" }), null);
  assert.equal(normalizeSpotlight({ phrase: "satu dua tiga" }), null);
  assert.equal(normalizeSpotlight({ label: "A", phrase: "satu dua", type: "aneh" }).type, "keypoint");
});

test("normalizeSpotlight menerima compare yang lengkap dan valid", () => {
  const result = normalizeSpotlight({
    type: "compare", label: "Tambora", value: 150, compareLabel: "Krakatau", compareValue: 25,
    unit: "km³", phrase: "150 kilometer kubik material"
  });
  assert.deepEqual(result, {
    type: "compare", label: "Tambora", compareLabel: "Krakatau", value: 150, compareValue: 25,
    unit: "km³", phrase: "150 kilometer kubik material"
  });
});

test("normalizeSpotlight menolak compare yang datanya tidak lengkap/tidak valid", () => {
  const base = { type: "compare", label: "A", value: 10, compareLabel: "B", compareValue: 5, phrase: "sepuluh vs lima" };
  assert.equal(normalizeSpotlight({ ...base, compareLabel: "" }), null);
  assert.equal(normalizeSpotlight({ ...base, value: 0 }), null);
  assert.equal(normalizeSpotlight({ ...base, compareValue: -1 }), null);
  assert.equal(normalizeSpotlight({ ...base, value: "sepuluh" }), null);
  assert.ok(normalizeSpotlight(base));
});

test("baris ASS memakai style Spotlight dan waktu kartu", () => {
  const lines = spotlightDialogueLines(
    [{ startSec: 1, endSec: 4, label: "Label", sublabel: "Sub", type: "keypoint" }],
    (start, end, style, text) => `${style}|${start}|${end}|${text}`,
    (value) => value
  );
  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => line.startsWith("Spotlight")));
  assert.ok(lines.some((line) => line.includes("Label")));
});

test("baris ASS kartu compare menghasilkan 2 bar animasi dan 2 label per sisi", () => {
  const lines = spotlightDialogueLines(
    [{ startSec: 1, endSec: 6, type: "compare", label: "Tambora", value: 150, compareLabel: "Krakatau", compareValue: 25, unit: "km³" }],
    (start, end, style, text) => `${style}|${start}|${end}|${text}`,
    (value) => value
  );
  const styles = lines.map((line) => line.split("|")[0]);
  assert.deepEqual(styles, ["ComparePanel", "CompareBar", "CompareBar", "CompareBarMuted", "CompareValue", "CompareValue", "CompareName", "CompareName"]);
  assert.ok(lines.some((line) => line.includes("Tambora")));
  assert.ok(lines.some((line) => line.includes("Krakatau")));
  assert.ok(lines.some((line) => line.includes("150 km³")));
  assert.ok(lines.some((line) => line.includes("25 km³")));
  // Bar yang lebih besar (Tambora=150) harus lebih tinggi (angka setelah "l W 0 l W " lebih besar) dari Krakatau=25.
  const barLine = lines.find((line) => line.includes("CompareBar|") && line.includes("\\fscy12"));
  const mutedLine = lines.find((line) => line.startsWith("CompareBarMuted"));
  const heightOf = (line) => Number(line.match(/l 100 (\d+) l 0 \1/)[1]);
  assert.ok(heightOf(barLine) > heightOf(mutedLine));
});

test("spotlight dibuang bila narasi final tidak lagi memuat frasanya", () => {
  const polished = polishPlanForLayAudience({
    title: "T",
    scenes: [{
      sceneType: "image",
      narration: "Air laut menutupi sebagian besar permukaan bumi.",
      screenText: "Lautan",
      spotlight: { type: "keypoint", label: "X", phrase: "kecepatan cahaya di ruang hampa" }
    }]
  }, { topic: "bumi" });
  assert.equal(polished.scenes[0].spotlight, null);
});

test("findPhraseTime memberi skor penuh untuk frasa yang cocok persis", () => {
  const timeline = buildWordTimeline([{ start: 0, end: 3, text: "alpha beta gamma delta" }]);
  const match = findPhraseTime(timeline, tokenizeMatchText("beta gamma"));
  assert.equal(match.score, 1);
});

test("extractAutoSpotlight mengekstrak statistik dan frasa narasi saat spotlight kosong", () => {
  const sc = {
    index: 2,
    sceneType: "image",
    screenText: "Letusan Purba Toba",
    narration: "Letusan purba ini mengeluarkan lebih dari dua ribu delapan ratus kilometer kubik magma ke atmosfer."
  };
  const extracted = extractAutoSpotlight(sc);
  assert.ok(extracted, "harus menghasilkan spotlight");
  assert.equal(extracted.type, "keypoint");
  assert.equal(extracted.label, "Letusan Purba Toba");
  assert.ok(extracted.sublabel.includes("kilometer"));
  assert.ok(extracted.phrase.length > 0);
});

test("extractAutoSpotlight fallback ke screenText dan awal narasi bila tidak ada angka", () => {
  const sc = {
    index: 3,
    sceneType: "image",
    screenText: "Teknologi Fusi Nuklir",
    narration: "Reaktor fusi masa depan menggunakan plasma hidrogen bersuhu ekstrem untuk menghasilkan listrik bersih."
  };
  const extracted = extractAutoSpotlight(sc);
  assert.ok(extracted, "harus menghasilkan spotlight");
  assert.equal(extracted.label, "Teknologi Fusi Nuklir");
  assert.equal(extracted.sublabel, "Poin Utama");
  assert.ok(extracted.phrase.includes("Reaktor"));
});

test("planSceneSpotlights memakai extractAutoSpotlight bila scene.spotlight tidak diisi AI", () => {
  const sc = {
    index: 1,
    sceneType: "image",
    startSec: 0,
    durationSec: 15,
    screenText: "Teknologi Fusi",
    narration: "Reaktor fusi masa depan menggunakan plasma hidrogen.",
    sceneCaptions: [{
      start: 0,
      end: 5,
      text: "Reaktor fusi masa depan menggunakan plasma hidrogen.",
      words: words(["reaktor", "fusi", "masa", "depan", "menggunakan", "plasma", "hidrogen"])
    }],
    spotlight: null
  };
  const placed = planSceneSpotlights([sc]);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].label, "Teknologi Fusi");
  assert.equal(placed[0].sublabel, "Poin Utama");
});

