import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { parseDeepSeekJson } from "../src/deepseek.js";
import { fallbackTitle, generateViralTitle, pickBestTitle, titleBonus, detectComparison, DEFAULT_TITLE_PATTERNS } from "../src/title-engine.js";
import { createTrendFallbackIdeas, isSpaceQuotaDue } from "../src/topic-engine.js";
import { fetchSustainedNewsTopics, findSustainedNewsTopics, parseGoogleNewsRss } from "../src/google-news-trends.js";
import { checkFreshness } from "../src/continuity-engine.js";

const space = () => ({ category: "luar angkasa" });
const other = () => ({ category: "teknologi" });

test("isSpaceQuotaDue: memprioritaskan space saat arsip masih kosong", () => {
  assert.equal(isSpaceQuotaDue([]), true);
});

test("Google News RSS: hanya memilih isu yang bertahan beberapa hari dan media", () => {
  const articles = [
    ["Pembayaran QR lintas negara makin luas", "Media A", "Mon, 07 Sep 2026 01:00:00 GMT"],
    ["Bank menguji pembayaran QR lintas negara", "Media B", "Mon, 07 Sep 2026 05:00:00 GMT"],
    ["Biaya pembayaran QR lintas negara disorot", "Media C", "Tue, 08 Sep 2026 01:00:00 GMT"],
    ["Keamanan pembayaran QR lintas negara diperkuat", "Media D", "Tue, 08 Sep 2026 05:00:00 GMT"],
    ["Pembayaran QR lintas negara menjangkau pasar baru", "Media E", "Wed, 09 Sep 2026 01:00:00 GMT"],
    ["Skor pertandingan sesaat", "Media A", "Wed, 09 Sep 2026 02:00:00 GMT"]
  ];
  const rss = `<rss><channel>${articles.map(([title, source, date]) =>
    `<item><title>${title} - ${source}</title><source>${source}</source><pubDate>${date}</pubDate><link>https://example.com</link></item>`
  ).join("")}</channel></rss>`;
  const topics = findSustainedNewsTopics(parseGoogleNewsRss(rss));
  assert.equal(topics[0].title, "Pembayaran QR Lintas Negara");
  assert.equal(topics[0].days, 3);
  assert.equal(topics[0].sources, 5);
  assert.ok(!topics.some((topic) => topic.title.includes("Media")));
  assert.ok(!topics.some((topic) => topic.title.includes("Pertandingan")));
});

test("Google News RSS: mengambil berita tujuh hari dari media Indonesia terkemuka", async () => {
  const urls = [];
  await fetchSustainedNewsTopics(async (url) => {
    urls.push(url);
    return { ok: true, text: async () => `<rss><channel><item><title>Topik netral</title><source>Media</source><pubDate>Mon, 07 Sep 2026 01:00:00 GMT</pubDate><link>https://example.com</link></item></channel></rss>` };
  });
  assert.equal(urls.length, 6);
  assert.ok(urls.every((url) => new URL(url).searchParams.get("q").includes("when:7d")));
  for (const domain of ["kompas.com", "detik.com", "cnnindonesia.com", "tempo.co", "antaranews.com", "liputan6.com"]) {
    assert.ok(urls.some((url) => new URL(url).searchParams.get("q").includes(`site:${domain}`)));
  }
});

test("Google News RSS: menerima topik olahraga hanya jika bertahan lintas hari", () => {
  const items = [
    ["Piala Asia memasuki babak baru", "Media A", "Mon, 07 Sep 2026 01:00:00 GMT"],
    ["Jadwal Piala Asia diumumkan", "Media B", "Mon, 07 Sep 2026 05:00:00 GMT"],
    ["Piala Asia menjadi sorotan", "Media C", "Tue, 08 Sep 2026 01:00:00 GMT"],
    ["Tim bersiap menghadapi Piala Asia", "Media D", "Tue, 08 Sep 2026 05:00:00 GMT"],
    ["Piala Asia berlanjut pekan ini", "Media E", "Wed, 09 Sep 2026 01:00:00 GMT"]
  ].map(([title, source, publishedAt]) => ({ title, source, publishedAt, day: new Date(publishedAt).toISOString().slice(0, 10) }));
  assert.equal(findSustainedNewsTopics(items)[0].title, "Piala Asia");
  assert.equal(findSustainedNewsTopics(items)[0].days, 3);
  assert.deepEqual(findSustainedNewsTopics(items.map((item) => ({ ...item, day: "2026-09-09" }))), []);
});

test("Google News RSS: frasa headline generik bukan topik berita", () => {
  const items = [
    ["Pelatih buka suara tentang pemain", "Media A", "Mon, 07 Sep 2026 01:00:00 GMT"],
    ["Perusahaan buka suara soal transaksi", "Media B", "Mon, 07 Sep 2026 05:00:00 GMT"],
    ["Sekolah buka suara setelah insiden", "Media C", "Tue, 08 Sep 2026 01:00:00 GMT"],
    ["Pemerintah buka suara terkait aturan", "Media D", "Tue, 08 Sep 2026 05:00:00 GMT"],
    ["Artis buka suara mengenai kabar", "Media E", "Wed, 09 Sep 2026 01:00:00 GMT"]
  ].map(([title, source, publishedAt]) => ({ title, source, publishedAt, day: new Date(publishedAt).toISOString().slice(0, 10) }));
  assert.ok(!findSustainedNewsTopics(items).some((topic) => topic.title === "Buka Suara"));
});

test("continuity: tren sama boleh memakai angle baru tetapi bukan judul identik", () => {
  const history = [{ topic: "Sejarah AEK Athena yang Jarang Diketahui", title: "Sejarah AEK Athena yang Jarang Diketahui" }];
  assert.equal(checkFreshness({
    topic: "Mengapa Strategi AEK Athena Sulit Ditebak Lawan",
    title: "Mengapa Strategi AEK Athena Sulit Ditebak Lawan"
  }, history, { allowRepeatedSubject: true }).isFresh, true);
  assert.equal(checkFreshness({
    topic: history[0].topic,
    title: history[0].title
  }, history, { allowRepeatedSubject: true }).isFresh, false);
});

test("fallback tren: tetap membuat beberapa angle terkait tanpa provider AI", () => {
  const ideas = createTrendFallbackIdeas({ title: "AEK Athena F.C.", newsTitle: "Laga Liga Champions" });
  assert.equal(ideas.length, 8);
  assert.ok(ideas.every((idea) => idea.topic.includes("AEK Athena F.C.")));
  assert.equal(new Set(ideas.map((idea) => idea.topic)).size, 8);
  assert.ok(ideas.every((idea) => !/hari ini|viral|mendadak/i.test(idea.topic)));
});

test("isSpaceQuotaDue: mengejar target 70 persen pada rolling window", () => {
  const previousRatio = config.topic.spaceTargetRatio;
  const previousWindow = config.topic.categoryHistoryWindow;
  config.topic.spaceTargetRatio = 0.7;
  config.topic.categoryHistoryWindow = 10;
  try {
    assert.equal(isSpaceQuotaDue([
      space(), space(), space(), space(), space(), space(), space(), other(), other(), other()
    ]), true);
    assert.equal(isSpaceQuotaDue([
      space(), space(), space(), space(), space(), space(), space(), space(), other(), other()
    ]), false);
  } finally {
    config.topic.spaceTargetRatio = previousRatio;
    config.topic.categoryHistoryWindow = previousWindow;
  }
});

test("parseDeepSeekJson: menerima JSON fenced dan teks pembungkus", () => {
  assert.deepEqual(parseDeepSeekJson("Berikut hasilnya:\n```json\n{\"titles\":[\"Kenapa Bintang Bersinar?\"]}\n```"), {
    titles: ["Kenapa Bintang Bersinar?"]
  });
});

test("fallbackTitle: selalu menghasilkan judul saat input dan plan kosong", () => {
  assert.equal(fallbackTitle({}, { category: "luar angkasa" }), "Kenapa Luar Angkasa Masih Menyimpan Banyak Misteri");
  assert.match(fallbackTitle({}, {}), /Fakta Menarik/);
});

test("generateViralTitle: fallback lokal tetap tersedia tanpa provider AI", async () => {
  const previousOpenAiKey = config.openai.apiKey;
  const previousDeepSeekKey = config.deepseek.apiKey;
  config.openai.apiKey = "";
  config.deepseek.apiKey = "";
  try {
    const title = await generateViralTitle({}, { category: "luar angkasa" });
    assert.equal(title, "Kenapa Luar Angkasa Masih Menyimpan Banyak Misteri");
  } finally {
    config.openai.apiKey = previousOpenAiKey;
    config.deepseek.apiKey = previousDeepSeekKey;
  }
});

test("pickBestTitle: memakai qualityScore dari kandidat DeepSeek", () => {
  const title = pickBestTitle([
    { title: "Kenapa Madu Tidak Pernah Basi", qualityScore: 93 },
    { title: "Bagaimana Kompas Menunjuk Utara", qualityScore: 71 }
  ]);
  assert.equal(title, "Kenapa Madu Tidak Pernah Basi");
});

test("DEFAULT_TITLE_PATTERNS: contoh di prompt patuh pada aturan yang diminta ke AI", () => {
  for (const example of DEFAULT_TITLE_PATTERNS) {
    assert.ok(example.length <= 65, `contoh "${example}" (${example.length} char) melebihi batas potong YouTube`);
  }
  const questionOpeners = DEFAULT_TITLE_PATTERNS
    .filter((example) => /^(kenapa|mengapa|bagaimana)\b/i.test(example));
  assert.ok(
    questionOpeners.length <= DEFAULT_TITLE_PATTERNS.length / 2,
    `contoh judul masih didominasi pertanyaan (${questionOpeners.length}/${DEFAULT_TITLE_PATTERNS.length})`
  );
});

test("titleBonus: judul dengan angka, ketegangan, dan subjek dinilai lebih tinggi", () => {
  const rich = titleBonus("Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman", ["madu"], new Set());
  const bland = titleBonus("Penjelasan Lengkap Soal Pengawetan Alami", ["madu"], new Set());
  assert.ok(rich > bland, `bonus judul berdetail (${rich}) harus di atas judul kabur (${bland})`);
});

test("pickBestTitle: detail terukur mengalahkan skor AI yang lebih tinggi tapi kabur", () => {
  const title = pickBestTitle([
    { title: "Alasan Madu Bertahan Sangat Lama di Dalam Wadah Tertutup", qualityScore: 88 },
    { title: "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan", qualityScore: 80 }
  ], { subject: "madu" });
  assert.equal(title, "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan");
});

test("pickBestTitle: pembuka yang sama dengan video terakhir dihindari", () => {
  const recentOpeners = new Set(["kenapa madu"]);
  const title = pickBestTitle([
    { title: "Kenapa Madu Tidak Pernah Basi Meski Disimpan Ribuan Tahun", qualityScore: 90 },
    { title: "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan", qualityScore: 82 }
  ], { subject: "madu", recentOpeners });
  assert.equal(title, "Madu Berumur Tiga Ribu Tahun yang Ternyata Masih Aman Dimakan");
});

test("detectComparison: mengenali pola perbandingan vs, versus, dan lawan", () => {
  const comp1 = detectComparison("Anak Kratau vs Gunung Toba");
  assert.ok(comp1);
  assert.equal(comp1.sideA, "Anak Kratau");
  assert.equal(comp1.sideB, "Gunung Toba");

  const comp2 = detectComparison("Bumi versus Mars");
  assert.ok(comp2);
  assert.equal(comp2.sideA, "Bumi");
  assert.equal(comp2.sideB, "Mars");

  assert.equal(detectComparison("Madu Berumur Ribuan Tahun"), null);
});

test("titleBonus: menghukum keras judul yang membuang salah satu entitas perbandingan", () => {
  const subject = "Anak Kratau vs Gunung Toba";
  const bothSides = "Dahsyat Mana: Letusan Anak Krakatau vs Supervolcano Toba";
  const oneSideOnly = "Runtuhan Anak Krakatau 2018 Memicu Tsunami Selat Sunda";

  const bonusBoth = titleBonus(bothSides, [], new Set(), subject);
  const bonusOne = titleBonus(oneSideOnly, [], new Set(), subject);

  assert.ok(bonusBoth > bonusOne + 50, `bonus judul perbandingan utuh (${bonusBoth}) harus jauh mengungguli judul parsial (${bonusOne})`);
});

test("pickBestTitle: mempertahankan topik perbandingan utuh meski judul parsial punya skor AI lebih tinggi", () => {
  const subject = "Anak Kratau vs Gunung Toba";
  const title = pickBestTitle([
    { title: "Runtuhan Anak Krakatau 2018 Memicu Tsunami Selat Sunda", qualityScore: 95 },
    { title: "Dahsyat Mana: Letusan Anak Krakatau vs Supervolcano Toba", qualityScore: 78 }
  ], { subject });
  assert.equal(title, "Dahsyat Mana: Letusan Anak Krakatau vs Supervolcano Toba");
});

test("config: intro, outro, dan bumper outro dinonaktifkan secara default", () => {
  assert.equal(config.render.introEnabled, false);
  assert.equal(config.render.outroEnabled, false);
  assert.equal(config.render.bumperOutroEnabled, false);
});

test("curated volcano ideas: berhasil dimuat dan berisi ide prioritas", async () => {
  const { loadCuratedVolcanoIdeas } = await import("../src/topic-engine.js");
  const ideas = await loadCuratedVolcanoIdeas();
  assert.ok(ideas.length >= 8);
  assert.ok(ideas.some((it) => it.title.includes("Tambora 1815")));
  assert.ok(ideas.some((it) => it.title.includes("Kawah Ijen")));
  assert.ok(ideas.some((it) => it.title.includes("Palung Jawa")));
});


