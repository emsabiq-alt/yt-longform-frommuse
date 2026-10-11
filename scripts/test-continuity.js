import assert from "node:assert/strict";
import { checkFreshness } from "../src/continuity-engine.js";
import { filterFreshTrendingContext, pickBalancedCategory } from "../src/topic-engine.js";

const history = [
  {
    topic: "Kisah Tak Terungkap: Peran Rahasia Kartini dalam Politik Kolonial Belanda",
    title: "Peran Rahasia Kartini dalam Politik Kolonial",
    category: "sejarah",
    angle: "peristiwa penting yang hampir tidak tercatat",
    formatType: "kisah_manusia"
  },
  {
    topic: "Mengapa langit malam gelap padahal ada miliaran bintang",
    title: "Misteri Gelapnya Langit Malam",
    category: "alam semesta",
    angle: "fenomena kosmis",
    formatType: "dokumenter_klasik"
  },
  {
    topic: "Bagaimana gurita mengubah warna tubuhnya",
    title: "Kekuatan Super Gurita",
    category: "hewan dan tumbuhan",
    angle: "mekanisme bertahan hidup",
    formatType: "dokumenter_klasik"
  }
];

const repeatedSubject = checkFreshness({
  topic: "Semua Orang Salah Soal Kartini",
  title: "Surat Kartini yang Mengubah Sejarah",
  category: "tokoh dunia",
  angle: "versi sejarah yang disalahartikan",
  formatType: "debat_dua_sisi"
}, history);
assert.equal(repeatedSubject.isFresh, false);
assert.match(repeatedSubject.reason, /kartini/i);

const freshSubject = checkFreshness({
  topic: "Mengapa baterai natrium mulai menantang lithium",
  title: "Baterai Natrium Mulai Bangkit",
  category: "energi",
  angle: "material baru",
  formatType: "perbandingan"
}, history);
assert.equal(freshSubject.isFresh, true);

const relatedButDifferent = checkFreshness({
  topic: "Mengapa baterai ponsel sulit bertahan sepuluh tahun",
  title: "Umur Baterai Ponsel",
  category: "teknologi",
  angle: "batas material",
  formatType: "dokumenter_klasik"
}, [{
  topic: "Bagaimana baterai natrium mulai menantang lithium",
  title: "Baterai Natrium Mulai Bangkit",
  category: "energi",
  angle: "material baru",
  formatType: "perbandingan"
}]);
assert.equal(relatedButDifferent.isFresh, true);

const filteredTrending = filterFreshTrendingContext({
  enabled: true,
  themes: [
    { theme: "Kartini dan emansipasi", angle: "surat yang jarang dibahas", category: "sejarah" },
    { theme: "Baterai natrium", angle: "alternatif lithium", category: "energi" }
  ],
  topKeywords: ["Kartini", "baterai natrium"],
  trendingScore: 88
}, history);
assert.deepEqual(filteredTrending.themes.map((item) => item.theme), ["Baterai natrium"]);
assert.deepEqual(filteredTrending.topKeywords, ["baterai natrium"]);

assert.notEqual(pickBalancedCategory(history), "sejarah");

console.log("Continuity smoke test passed.");
