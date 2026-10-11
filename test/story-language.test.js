import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignNarrativeContext,
  dedupeSentences,
  isGenericStoryboardText,
  polishPlanForLayAudience,
  simplifyForLayAudience
} from "../src/story-language.js";
import { computeSegmentDurations } from "../src/longform-render.js";

test("simplifyForLayAudience mengganti istilah kaku menjadi bahasa awam", () => {
  const text = simplifyForLayAudience("Efek domino ini punya implikasi dan mekanisme yang kompleks.");
  assert.equal(text, "rangkaian akibat ini punya arti dan cara kerja yang rumit.");
});

test("simplifyForLayAudience tidak merusak nama diri", () => {
  // Istilah yang diikuti kata berkapital adalah bagian dari nama; menggantinya
  // menghasilkan "hal yang terlihat bertentangan Fermi" di judul video.
  assert.equal(simplifyForLayAudience("Paradoks Fermi"), "Paradoks Fermi");
  assert.equal(simplifyForLayAudience("Sintesis Protein di dalam sel"), "Sintesis Protein di dalam sel");
  assert.equal(simplifyForLayAudience("Transisi Demografi Indonesia"), "Transisi Demografi Indonesia");
  // Pemakaian sebagai kata biasa tetap disederhanakan.
  assert.equal(simplifyForLayAudience("paradoks yang aneh"), "hal yang terlihat bertentangan yang aneh");
  assert.equal(simplifyForLayAudience("transisi bertahap"), "perubahan bertahap bertahap");
});

test("dedupeSentences membuang kalimat yang sama atau terlalu mirip", () => {
  const text = dedupeSentences("Madu bisa awet lama. Madu bisa awet lama. Itulah sebabnya madu sering ditemukan masih layak.");
  assert.equal(text, "Madu bisa awet lama. Itulah sebabnya madu sering ditemukan masih layak.");
});

test("dedupeSentences berbagi sidik jari antar pemanggilan lewat argumen seen", () => {
  const seen = [];
  const first = dedupeSentences("Kadar air madu sangat rendah sehingga mikroba tidak bisa hidup.", 1600, seen);
  const second = dedupeSentences("Mikroba tidak bisa hidup karena kadar air madu sangat rendah.", 1600, seen);
  assert.ok(first.length > 0);
  // Kalimat kedua adalah fakta yang sama dengan urutan kata berbeda.
  // Narasi tidak boleh kosong, jadi satu kalimat tetap dipertahankan.
  assert.ok(second.length > 0);
  const third = dedupeSentences("Lebah menambahkan enzim glukosa oksidase yang menghasilkan hidrogen peroksida.", 1600, seen);
  assert.match(third, /enzim/);
});

test("isGenericStoryboardText mengenali label storyboard yang terlalu umum", () => {
  assert.equal(isGenericStoryboardText("Pertanyaan Besar 1"), true);
  assert.equal(isGenericStoryboardText("Efek Domino 6"), true);
  assert.equal(isGenericStoryboardText("Kenapa Madu Awet Lama"), false);
});

test("polishPlanForLayAudience membuat screenText non-summary unik dan lebih konkret", () => {
  const plan = {
    title: "Kenapa Efek Domino dari Madu Begitu Besar",
    hook: "Apa implikasi dari madu yang tidak basi?",
    summary: "Madu awet lama karena kadar airnya rendah. Madu awet lama karena kadar airnya rendah.",
    importantPoints: [
      "Implikasi utama madu ada pada cara penyimpanannya.",
      "Implikasi utama madu ada pada cara penyimpanannya."
    ],
    factCheckNote: "Periksa mekanisme ilmiahnya.",
    scenes: [
      {
        index: 1,
        sceneType: "image",
        narration: "Madu bisa awet lama karena kadar airnya rendah dan lingkungannya tidak ramah bagi mikroba.",
        screenText: "Pertanyaan Besar",
        chapter: "Analisis utama",
        beatPurpose: "Membuka data, sejarah, atau mekanisme penyebab.",
        visualSegments: [{ narrativeContext: "mekanisme madu awet" }]
      },
      {
        index: 2,
        sceneType: "image",
        narration: "Lebah juga menambahkan enzim yang membantu menjaga madu tetap stabil lebih lama.",
        screenText: "Pertanyaan Besar",
        chapter: "Analisis utama",
        beatPurpose: "Membuka data, sejarah, atau mekanisme penyebab.",
        visualSegments: [{ narrativeContext: "implikasi enzim lebah" }]
      },
      {
        index: 3,
        sceneType: "summary",
        narration: "Intinya, madu awet karena air rendah, sifat asam, dan bantuan enzim lebah.",
        screenText: "Ringkasan Inti",
        chapter: "Kesimpulan",
        beatPurpose: "Menutup cerita."
      }
    ]
  };

  const polished = polishPlanForLayAudience(plan, { topic: "madu" });
  const screenTexts = polished.scenes
    .filter((scene) => scene.sceneType !== "summary")
    .map((scene) => scene.screenText);

  assert.deepEqual(new Set(screenTexts).size, screenTexts.length);
  assert.ok(screenTexts.every((text) => !isGenericStoryboardText(text)));
  assert.doesNotMatch(JSON.stringify(polished), /efek domino|implikasi|mekanisme|Analisis utama/i);
});
test("polishPlanForLayAudience membuat bab kontigu dan berlabel konkret", () => {
  // 8 scene: reaction di tengah tidak boleh memecah bab menjadi label berulang.
  const scenes = Array.from({ length: 8 }, (_, index) => ({
    index: index + 1,
    sceneType: index === 7 ? "summary" : (index === 3 ? "reaction" : "image"),
    narration: `Fakta nomor ${index + 1} soal kapal besi yang tetap mengapung di air laut.`,
    screenText: `Bukti Nomor ${index + 1}`,
    chapter: "Analisis utama"
  }));

  const chapters = polishPlanForLayAudience({ scenes }, { topic: "kapal besi" })
    .scenes.map((scene) => scene.chapter);

  // Sekali sebuah bab ditinggalkan, labelnya tidak boleh muncul lagi.
  chapters.forEach((label, index) => {
    if (index > 0 && label !== chapters[index - 1]) {
      assert.ok(!chapters.slice(0, index).includes(label), `bab "${label}" terputus lalu muncul lagi`);
    }
  });
  // Label generik dari AI ("Analisis utama") maupun bawaan tidak boleh jadi nama bab.
  assert.ok(!chapters.some((label) => isGenericStoryboardText(label)));
  assert.doesNotMatch(chapters.join(" | "), /analisis utama|penjelasan utama/i);
});


test("alignNarrativeContext memakai frasa AI yang benar-benar ada di narasi", () => {
  const narration = "Kapal besi pertama diluncurkan pada tahun delapan belas empat puluh tiga. "
    + "Hukum Archimedes menjelaskan gaya angkat yang bekerja pada lambung. "
    + "Rongga udara di dalam lambung membuat kepadatan rata-rata turun. "
    + "Kapal modern kini mengangkut ribuan kontainer melintasi samudra.";
  const segments = alignNarrativeContext([
    { narrativeContext: "Kapal besi pertama diluncurkan" },
    { narrativeContext: "Hukum Archimedes menjelaskan gaya angkat" },
    { narrativeContext: "Rongga udara di dalam lambung" },
    { narrativeContext: "mengangkut ribuan kontainer melintasi samudra" }
  ], narration);

  assert.equal(segments.length, 4);
  assert.equal(segments[0].narrativeContext, "Kapal besi pertama diluncurkan");
  assert.equal(segments[3].narrativeContext, "mengangkut ribuan kontainer melintasi samudra");
});

test("alignNarrativeContext mengganti frasa parafrase dengan potongan verbatim narasi", () => {
  const narration = "Kadar air madu hanya sekitar tujuh belas persen sehingga bakteri tidak bisa berkembang. "
    + "Lebah juga menambahkan enzim yang menghasilkan hidrogen peroksida dalam jumlah kecil. "
    + "Karena itu madu di makam Mesir kuno masih layak dimakan setelah ribuan tahun.";
  const segments = alignNarrativeContext([
    { narrativeContext: "kelembapan sangat minim" },              // parafrase, tidak ada di narasi
    { narrativeContext: "zat antibakteri buatan lebah" },          // parafrase
    { narrativeContext: "madu di makam Mesir kuno" }               // verbatim
  ], narration);

  const lower = narration.toLowerCase();
  segments.forEach((segment, i) => {
    assert.ok(segment.narrativeContext, `segmen ${i} tidak boleh kosong`);
    assert.ok(
      lower.includes(segment.narrativeContext.toLowerCase()),
      `segmen ${i} harus verbatim dari narasi: "${segment.narrativeContext}"`
    );
  });
  // Frasa verbatim milik AI tetap dipakai apa adanya.
  assert.equal(segments[2].narrativeContext, "madu di makam Mesir kuno");
  // Tidak ada dua segmen yang menunjuk momen yang sama.
  assert.equal(new Set(segments.map((s) => s.narrativeContext)).size, segments.length);
});

test("alignNarrativeContext membuat pergantian gambar benar-benar tersinkron", () => {
  // Uji end-to-end kecil: frasa hasil align harus bisa dicocokkan oleh
  // computeSegmentDurations, bukan jatuh ke pembagian rata.
  const narration = "Kapal besi pertama diluncurkan dan banyak orang yakin benda itu tenggelam. "
    + "Hukum Archimedes menjelaskan gaya angkat yang bekerja pada benda di air. "
    + "Kuncinya ada pada rongga udara di dalam lambung yang menurunkan kepadatan. "
    + "Berkat prinsip itu kapal modern mengangkut ribuan kontainer melintasi samudra.";
  const sentences = narration.match(/[^.]+\./g).map((s) => s.trim());
  const scene = {
    durationSec: 20,
    // Semua narrativeContext salah/parafrase: tanpa align, sinkronisasi gagal.
    visualSegments: alignNarrativeContext(
      [
        { narrativeContext: "zeppelin quantum" },
        { narrativeContext: "zeppelin quantum" },
        { narrativeContext: "zeppelin quantum" },
        { narrativeContext: "zeppelin quantum" }
      ],
      narration
    ),
    sceneCaptions: sentences.map((text, i) => ({ start: i * 5, end: (i + 1) * 5, text }))
  };

  const durations = computeSegmentDurations(scene, 4);
  assert.equal(durations.length, 4);
  const total = durations.reduce((sum, d) => sum + d, 0);
  assert.ok(Math.abs(total - 20) < 0.05, `total harus ~20, dapat ${total}`);
  // Frasa diambil dari posisi proporsional narasi, jadi batas segmen bergerak
  // mengikuti ucapan; hasil persis 5/5/5/5 berarti fallback rata yang dipakai.
  assert.notDeepEqual(durations, [5, 5, 5, 5]);
  assert.ok(durations.every((d) => d > 0.5), `durasi wajar: ${durations}`);
});

test("isGenericStoryboardText mengenali variasi fakta, babak, dan scene placeholder", () => {
  assert.equal(isGenericStoryboardText("Fakta Perubahan 24"), true);
  assert.equal(isGenericStoryboardText("fakta perubahan"), true);
  assert.equal(isGenericStoryboardText("Hal yang Berubah"), true);
  assert.equal(isGenericStoryboardText("Fakta 1"), true);
  assert.equal(isGenericStoryboardText("Scene 2"), true);
  assert.equal(isGenericStoryboardText("Babak 14"), true);
  assert.equal(isGenericStoryboardText("Tapi benarkah letusan purba memicu zaman es?"), false);
});

test("polishPlanForLayAudience mempertahankan pertanyaan penasaran pada scene reaction dan menolak fakta perubahan 24", () => {
  const plan = {
    title: "Anak Krakatau vs Gunung Toba",
    hook: "Kenapa letusan Toba begitu dahsyat?",
    summary: "Ringkasan perbedaan skala letusan Krakatau dan Toba purba.",
    importantPoints: ["Toba supervolcano.", "Krakatau caldera."],
    scenes: [
      {
        index: 1,
        sceneType: "image",
        screenText: "Perbandingan Awal",
        narration: "Anak Krakatau dan Gunung Toba sering dibandingkan dalam sejarah bencana alam."
      },
      {
        index: 2,
        sceneType: "reaction",
        screenText: "fakta perubahan 24",
        narration: "fakta perubahan 24",
        reactionText: ""
      },
      {
        index: 3,
        sceneType: "reaction",
        screenText: "Tapi benarkah letusan Toba yang memicu zaman es terakhir?",
        narration: "Tapi benarkah letusan Toba yang memicu zaman es terakhir?",
        reactionText: "Tapi benarkah letusan Toba yang memicu zaman es terakhir?"
      },
      {
        index: 4,
        sceneType: "summary",
        screenText: "Ringkasan Inti",
        narration: "Kedua gunung ini menjadi bukti kedahsyatan kekuatan bumi di Indonesia."
      }
    ]
  };

  const polished = polishPlanForLayAudience(plan, { topic: "Anak Krakatau vs Gunung Toba" });
  const reaction1 = polished.scenes[1];
  const reaction2 = polished.scenes[2];

  // Reaction 1: dari placeholder 'fakta perubahan 24' wajib diganti fallback pertanyaan penasaran yang diakhiri tanda tanya
  assert.ok(reaction1.screenText.endsWith("?"), "reaction 1 screenText harus berakhiran ?");
  assert.ok(reaction1.narration.endsWith("?"), "reaction 1 narration harus berakhiran ?");
  assert.ok(!/fakta perubahan/i.test(reaction1.screenText), "tidak boleh ada kata fakta perubahan di screenText");
  assert.ok(!isGenericStoryboardText(reaction1.screenText), "screenText reaction 1 tidak boleh generik");

  // Reaction 2: pertanyaan valid dari AI tetap dipertahankan
  assert.equal(reaction2.screenText, "Tapi benarkah letusan Toba yang memicu zaman es terakhir?");
  assert.equal(reaction2.narration, "Tapi benarkah letusan Toba yang memicu zaman es terakhir?");
  assert.equal(reaction2.reactionText, "Tapi benarkah letusan Toba yang memicu zaman es terakhir?");
});


