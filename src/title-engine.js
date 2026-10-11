/**
 * Title Engine — generate judul viral dari ringkasan konten (hook + summary + poin).
 * Judul dibuat AI berdasarkan deskripsi/inti video, bukan sekadar diambil dari topik.
 */

import { requestKnowledgeJsonWithFallback } from "./deepseek.js";
import { cleanText } from "./util.js";
import { loadHistory } from "./continuity-engine.js";
import { simplifyForLayAudience } from "./story-language.js";

/**
 * Bentuk judul. SELALU menyebut subjek konkret (benda/makhluk/tempat nyata) dan
 * menahan jawabannya.
 *
 * Sebelumnya semua contoh berbentuk pertanyaan dan prompt mewajibkan pembuka
 * 'Kenapa'/'Bagaimana'/'Mengapa'. Akibatnya seluruh judul channel punya tiga kata
 * pertama yang sama: di feed subscriber judul jadi saling tertukar, dan slot
 * paling mahal di judul terpakai untuk kata fungsi, bukan subjeknya. Pertanyaan
 * tetap dipakai, tapi hanya sebagai salah satu dari lima bentuk.
 */
const TITLE_SHAPES = [
  {
    label: "Pertanyaan langsung",
    examples: [
      "Kenapa Madu Tidak Pernah Basi Meski Disimpan Ribuan Tahun",
      "Bagaimana Semut Menemukan Jalan Pulang Tanpa Pernah Tersesat",
      "Mengapa Garam Dulu Lebih Berharga daripada Emas"
    ]
  },
  {
    label: "Subjek dulu, kejutannya menyusul",
    examples: [
      "Madu Berumur Tiga Ribu Tahun yang Masih Aman Dimakan",
      "Keyboard Kita Sengaja Dibuat Lebih Lambat, dan Itu Masih Berlaku",
      "Kompas Sudah Menunjuk Utara Sebelum Ada yang Tahu Kenapa"
    ]
  },
  {
    label: "Pertentangan (fakta yang seharusnya mustahil)",
    examples: [
      "Langit Malam Tetap Gelap Padahal Dipenuhi Miliaran Bintang",
      "Kapal Baja Seberat Dua Puluh Ribu Ton Tetap Mengapung",
      "Es Justru Mengambang, Berbeda dari Hampir Semua Benda Padat"
    ]
  },
  {
    label: "Angka yang mengunci rasa penasaran",
    examples: [
      "Delapan Menit Perjalanan Cahaya Matahari Sebelum Sampai ke Bumi",
      "Enam Sisi Sarang Lebah dan Alasan Bentuk Lain Selalu Kalah",
      "Dua Ratus Tahun Air Laut Asin, Air Sungai Tetap Tawar"
    ]
  },
  {
    label: "Akibat atau taruhan yang jelas",
    examples: [
      "Satu Baut Longgar yang Membuat Pesawat Kembali ke Landasan",
      "Bawang Membuat Mata Menangis, dan Itu Bentuk Pertahanan Dirinya",
      "Otak Tidak Ikut Tidur, dan Itu Sebabnya Mimpi Terasa Nyata"
    ]
  }
];

const DEFAULT_TITLE_PATTERNS = TITLE_SHAPES.flatMap((shape) => shape.examples);

// Frasa kabur yang dilarang menggantikan subjek konkret di judul.
const VAGUE_TITLE_PATTERNS = /\b(hal ini|hal kecil|hal biasa|hal sepele|fenomena ini|kejadian ini|peristiwa ini|sesuatu yang|sesuatu|misteri ini|rahasia ini|benda ini|teknologi ini|suara ini|pola ini|mereka ini)\b/i;
const STIFF_TITLE_PATTERNS = /\b(efek domino|paradoks modern|lanskap urban|tatanan sosial|implikasi|hipotesis|mekanisme)\b/i;

// Detail terukur dan kata yang menciptakan ketegangan. Dua hal inilah yang
// membuat judul terasa "berisi" tanpa perlu kata yang lebih sulit: penonton
// dapat satu angka yang bisa dipegang, plus rasa ada yang tidak beres.
const CONCRETE_DETAIL = /\d|\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|puluh|ratus|ribu|juta|miliar|abad|dekade|persen|derajat|kilometer|meter|ton|kilogram|tahun|bulan|menit|detik|jam|hari)\b/i;
const TENSION_WORDS = /\b(padahal|meski|meskipun|tapi|tetapi|justru|namun|sebelum|tanpa|walau|walaupun|ternyata|bukan|sengaja|gagal|kalah|hilang)\b/i;
const SUBJECT_SKIP_WORDS = new Set([
  "kenapa", "mengapa", "bagaimana", "yang", "jarang", "diketahui", "fakta",
  "menarik", "orang", "tentang", "dalam", "untuk", "dengan", "sebuah", "ini", "itu"
]);

/**
 * Bangun teks ringkasan dari plan untuk dijadikan bahan judul.
 */
function buildContentDigest(plan) {
  const hook = simplifyForLayAudience(plan?.hook || "", 400);
  const summary = simplifyForLayAudience(plan?.summary || "", 800);
  const points = (plan?.importantPoints || [])
    .slice(0, 5)
    .map((p) => simplifyForLayAudience(p, 220))
    .filter(Boolean);
  const parts = [
    hook ? `Hook: ${hook}` : "",
    summary ? `Ringkasan: ${summary}` : "",
    points.length ? `Poin penting:\n${points.map((p) => `- ${p}`).join("\n")}` : ""
  ].filter(Boolean);
  return parts.join("\n\n");
}

function stripEmoji(value) {
  return String(value || "")
    // Hapus emoji dan simbol variasi Unicode
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{E0100}-\u{E01EF}]/gu, "")
    .trim();
}

function titleOpener(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z\u00C0-\u024F ]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(" ");
}

function subjectTerms(subject) {
  return String(subject || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !SUBJECT_SKIP_WORDS.has(word));
}

/**
 * Deteksi perbandingan (A vs B, versus, lawan, dibandingkan).
 */
function detectComparison(text) {
  const match = String(text || "").match(/\b(?:vs\.?|versus|lawan|dibandingkan|dibanding)\b/i);
  if (!match) return null;
  const parts = text.split(new RegExp(`\\b${match[0]}\\b`, "i")).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      sideA: parts[0],
      sideB: parts.slice(1).join(" "),
      conjunction: match[0]
    };
  }
  return null;
}

/**
 * Cek apakah term cocok dalam teks, termasuk variasi ejaan atau typo umum (mis. kratau -> krakatau).
 */
function termMatches(term, text) {
  const t = String(text || "").toLowerCase();
  const w = String(term || "").toLowerCase();
  if (t.includes(w)) return true;
  // Resilient terhadap typo/singkatan umum
  if (w === "kratau" && t.includes("krakatau")) return true;
  if (w === "krakatau" && t.includes("kratau")) return true;
  if (w.length >= 6 && t.includes(w.slice(0, 5))) return true;
  return false;
}

/**
 * Nilai tambahan di atas qualityScore milik AI.
 *
 * Skor AI saja tidak cukup: model cenderung memberi nilai tinggi pada judul yang
 * enak dibaca padahal isinya kabur atau topic drift. Tiga hal yang benar-benar membuat
 * penonton mengklik diperiksa: ada angka/ukuran yang bisa dipegang, ada kata ketegangan,
 * dan keselarasan penuh dengan topik/subjek pengguna (terutama topik perbandingan A vs B).
 */
function titleBonus(title, subjectWords, recentOpeners, rawSubject = "") {
  let bonus = 0;
  if (CONCRETE_DETAIL.test(title)) bonus += 12;
  if (TENSION_WORDS.test(title)) bonus += 8;

  const comparison = detectComparison(rawSubject);
  if (comparison) {
    const termsA = subjectTerms(comparison.sideA);
    const termsB = subjectTerms(comparison.sideB);
    const matchA = termsA.length === 0 || termsA.some((w) => termMatches(w, title));
    const matchB = termsB.length === 0 || termsB.some((w) => termMatches(w, title));

    if (matchA && matchB) {
      // Menjaga perbandingan kedua entitas secara utuh!
      bonus += 35;
    } else if (matchA || matchB) {
      // Topic drift: membuang salah satu pihak perbandingan! Dihukum berat.
      bonus -= 35;
    } else {
      // Tidak menyebut salah satu pun
      bonus -= 50;
    }
  } else {
    // Topik non-perbandingan: periksa coverage kata kunci subjek
    if (Array.isArray(subjectWords) && subjectWords.length > 0) {
      const matchCount = subjectWords.filter((word) => termMatches(word, title)).length;
      const coverage = matchCount / subjectWords.length;
      if (coverage >= 0.8) {
        bonus += 20;
      } else if (coverage >= 0.4) {
        bonus += 10;
      } else if (matchCount > 0) {
        bonus += 4;
      } else {
        bonus -= 25;
      }
    }
  }

  // 65 karena buildTitle() di youtube-meta.js memotong keras di 65 karakter.
  // Judul 66-68 karakter kehilangan kata terakhirnya di YouTube.
  if (title.length >= 42 && title.length <= 65) bonus += 6;
  if (recentOpeners.has(titleOpener(title))) bonus -= 25;
  return bonus;
}

function pickBestTitle(titles, options = {}) {
  const subjectWords = subjectTerms(options.subject);
  const recentOpeners = options.recentOpeners instanceof Set
    ? options.recentOpeners
    : new Set(options.recentOpeners || []);
  const candidates = Array.isArray(titles) ? titles : [titles];
  const valid = candidates
    .map((candidate, index) => {
      const rawTitle = typeof candidate === "object" ? candidate?.title : candidate;
      const title = simplifyForLayAudience(stripEmoji(rawTitle), 80);
      const qualityScore = Number(typeof candidate === "object" ? candidate?.qualityScore : 0);
      const base = Number.isFinite(qualityScore) ? Math.max(0, Math.min(100, qualityScore)) : 0;
      return {
        title,
        score: base + titleBonus(title, subjectWords, recentOpeners, options.subject || ""),
        index
      };
    })
    .filter((candidate) => (
      candidate.title.length >= 10
      && candidate.title.length <= 80
      && /[a-zA-Z\u00C0-\u024F]/.test(candidate.title)
    ));
  if (!valid.length) return "";
  // Buang judul yang masih memakai frasa kabur (tanpa subjek konkret).
  const concrete = valid.filter((candidate) => (
    !VAGUE_TITLE_PATTERNS.test(candidate.title) && !STIFF_TITLE_PATTERNS.test(candidate.title)
  ));
  const pool = concrete.length ? concrete : valid;
  // Skor gabungan menentukan. Kalau setara, pilih judul yang paling ringkas tetapi
  // masih cukup deskriptif untuk tampilan mobile.
  const preferred = [...pool].sort((a, b) => (
    b.score - a.score
    || Number(a.title.length < 42 || a.title.length > 65) - Number(b.title.length < 42 || b.title.length > 65)
    || a.title.length - b.title.length
    || a.index - b.index
  ))[0];
  return preferred?.title || "";
}

function fallbackTitle(plan, input = {}) {
  const candidates = [
    input?.topic,
    plan?.title,
    String(plan?.summary || "").split(/[.!?]/)[0]
  ]
    .map((value) => simplifyForLayAudience(stripEmoji(cleanText(value, 100)), 80))
    .filter((value) => value.length >= 10 && !/^\(?tanpa judul\)?$/i.test(value));

  const usable = candidates.find((value) => !VAGUE_TITLE_PATTERNS.test(value)) || candidates[0];
  if (usable) return usable;
  if (String(input?.category || "").toLowerCase() === "luar angkasa") {
    return "Kenapa Luar Angkasa Masih Menyimpan Banyak Misteri";
  }
  return "Fakta Menarik yang Jarang Diketahui";
}

function buildTitlePrompt(digest, currentTitle, category, subject, recentTitles = []) {
  const comparison = detectComparison(subject);
  const shapeBlock = TITLE_SHAPES.flatMap((shape) => [
    `${shape.label}:`,
    ...shape.examples.map((example) => `  - ${example}`)
  ]);

  const topicBlock = comparison
    ? [
        `*** PERHATIAN KHUSUS: TOPIK ADALAH PERBANDINGAN DUA ENTITAS ***`,
        `Topik: "${subject}" (Entitas A: "${comparison.sideA}" vs Entitas B: "${comparison.sideB}")`,
        `WAJIB: SEMUA 10 kandidat judul HARUS membandingkan kedua entitas tersebut (atau mengadu kedahsyatan/dampak keduanya).`,
        `DILARANG KERAS membuang salah satu entitas! DILARANG membuat judul yang hanya membahas "${comparison.sideA}" saja atau hanya "${comparison.sideB}" saja!`,
        `DILARANG TOPIC DRIFT ke sub-peristiwa parsial (misal: jangan hanya bahas tsunami atau letusan tahun tertentu dari salah satu pihak). Fokus utama adalah duel perbandingan keduanya!`
      ].join("\n")
    : [
        `Subjek konkret video (WAJIB disebut eksplisit di judul): ${subject || currentTitle || "(tentukan dari ringkasan)"}`,
        `Topik utama: "${subject || currentTitle || ""}"`
      ].join("\n");

  return [
    "Kamu spesialis judul YouTube edukasi berbahasa Indonesia untuk topik yang relevan secara global.",
    "Tugas: riset secara internal dari bahan yang diberikan, lalu buat 10 kandidat judul video berkualitas tinggi yang membuat orang penasaran dan mau membuka video.",
    "Bahan dasar (ringkasan konten video):",
    "---",
    digest,
    "---",
    topicBlock,
    `Judul saat ini: ${currentTitle || "(belum ada)"}`,
    `Kategori: ${category || "umum"}`,
    recentTitles.length
      ? `Judul video terakhir di channel ini (DILARANG memakai pembuka atau pola yang sama):\n${recentTitles.map((title) => `- ${title}`).join("\n")}`
      : "",
    "",
    "ATURAN JUDUL:",
    "- Idealnya 42-65 karakter, maksimal 80 karakter. Di atas 65 karakter YouTube memotongnya.",
    "- Bahasa Indonesia natural, singkat, padat.",
    "- Tidak pakai emoji dan tidak pakai tanda seru berlebihan.",
    "- WAJIB SINKRON DENGAN TOPIK UTAMA. DILARANG KERAS TOPIC DRIFT: Judul harus mewakili topik utama yang diminta penonton, bukan hanyut ke fakta/peristiwa sampingan kecil dari naskah.",
    comparison ? "- KARENA TOPIK PERBANDINGAN ('vs'), KEDUA ENTITAS WAJIB HADIR DI JUDUL. Dilarang membuang salah satu pihak." : "",
    "- WAJIB menyebut SUBJEK KONKRET yang dibahas (benda/makhluk/tempat/peristiwa nyata),",
    "  sehingga penonton LANGSUNG paham videonya tentang apa hanya dari judul.",
    "- WAJIB memuat satu DETAIL SPESIFIK yang diambil dari bahan di atas: angka, ukuran,",
    "  jangka waktu, tahun, atau nama. Detail inilah yang membuat judul terasa berisi.",
    "  Judul tanpa satu pun detail terukur dianggap lemah, sekalipun kalimatnya rapi.",
    "  Angka ditulis dengan kata ('Delapan Menit', 'Tiga Ribu Tahun'), bukan angka.",
    "- Judul yang kuat menyimpan KETEGANGAN: ada yang tidak sesuai dugaan. Pakai kata seperti",
    "  'padahal', 'meski', 'justru', 'tanpa', 'sebelum', 'ternyata' bila memang sesuai isi.",
    "- Ada LIMA bentuk judul di bawah. Sebarkan 10 kandidat ke SEMUA bentuk, minimal satu",
    "  kandidat per bentuk. Jangan menulis sepuluh pertanyaan.",
    "- DILARANG membuat lebih dari tiga kandidat yang diawali kata yang sama.",
    "- DILARANG KERAS memakai kata ganti kabur sebagai pengganti subjek:",
    "  'Hal Ini', 'Hal Kecil', 'Fenomena Ini', 'Sesuatu', 'Benda Ini', 'Teknologi Ini', 'Misteri Ini'.",
    "  Tulis nama subjeknya secara langsung (mis. 'Madu', 'Kucing', 'Kompas', 'Es', 'Keyboard').",
    "- DILARANG GAYA PERTANYAAN TERLALU BASIC / ELEMENTER:",
    "  JANGAN membuat judul dengan pertanyaan remeh seperti: 'Kenapa Dinamakan X?', 'Kenapa Disebut Anak?', 'Apa Itu X?', atau 'Mengenal X'.",
    "- GAYA PERTANYAAN WAJIB KOMPREHENSIF DAN MEMICU PENASARAN TINGGI (HIGH STAKES):",
    "  Gunakan sudut pandang yang mengangkat misteri sains mendalam, anomali data, atau ancaman nyata berskala luas.",
    "  Contoh BAGUS: 'Kenapa Letusan Danau Toba Gagal Memusnahkan Nenek Moyang Kita?' (bukan 'Apa Itu Danau Toba?').",
    "  Contoh BAGUS: 'Selat Sunda Terkunci: Kapan Gempa M9,0 Meledak?' (bukan 'Kenapa Selat Sunda Rawan Gempa?').",
    "- Boleh menahan JAWABAN (curiosity gap), tetapi SUBJEK-nya harus jelas.",
    "  Contoh benar: 'Kenapa Madu Tidak Pernah Basi' (subjek=madu jelas, jawaban ditahan).",
    "  Contoh SALAH: 'Kenapa Hal Ini Tidak Pernah Basi' (subjek kabur — DILARANG).",
    "- DILARANG pakai kata: 'skill', 'insentif', 'trik', 'hack', 'rahasia di balik'.",
    "- DILARANG pakai istilah kaku yang terlalu konseptual. Pilih kata sehari-hari yang langsung kebayang.",
    "- Kerumitan judul harus datang dari FAKTANYA, bukan dari kata yang lebih sulit.",
    "  'Kapal Baja Dua Puluh Ribu Ton Tetap Mengapung' lebih rumit dan lebih mudah dipahami",
    "  daripada 'Fenomena Daya Apung pada Struktur Baja'. Pilih yang pertama.",
    "- DILARANG gaya listicle ('5 Fakta...', '3 Hal...') atau gaya tips/tutorial.",
    "- Judul harus akurat sesuai konten; jangan clickbait yang menipu. Detail yang dipakai",
    "  harus benar-benar ada di bahan di atas, jangan mengarang angka.",
    "- Utamakan subjek/pertanyaan yang bisa dipahami penonton internasional; jangan bergantung pada konteks lokal Indonesia.",
    "- Beri qualityScore 0-100 untuk tiap kandidat. Nilai dari kesesuaian dengan topik utama, kejelasan subjek, adanya detail terukur, rasa penasaran yang jujur, dan kekuatan untuk CTR.",
    "",
    "LIMA BENTUK JUDUL (subjek selalu disebut jelas, variasikan diksinya):",
    ...shapeBlock,
    "",
    "Kembalikan JSON valid saja dengan format:",
    '{ "titles": [{ "title": "judul 1", "shape": "nama bentuk", "qualityScore": 0, "reason": "alasan singkat" }] }'
  ].filter(Boolean).join("\n");
}

/**
 * Generate judul viral dari ringkasan konten plan.
 * @param {object} plan - Objek plan yang sudah dinormalisasi.
 * @param {object} input - Input asli (untuk kategori/topik fallback).
 * @returns {Promise<string>} Judul terpilih, atau string kosong jika gagal.
 */
export async function generateViralTitle(plan, input = {}) {
  const currentTitle = simplifyForLayAudience(plan?.title || input?.topic || "", 100);
  const subject = simplifyForLayAudience(input?.topic || plan?.title || "", 120);
  const digest = buildContentDigest(plan);
  const safeFallback = fallbackTitle(plan, input);
  if (!digest.trim()) return currentTitle || safeFallback;

  // History dibaca di sini, bukan diteruskan dari createLongformDraft, karena
  // loadHistory() sudah menelan errornya sendiri dan hanya jalur ini yang
  // membutuhkannya. Judul lama dipakai dua kali: masuk prompt sebagai larangan,
  // dan menghukum kandidat yang pembukanya terulang.
  const recentTitles = (await loadHistory(8)).map((item) => item.title).filter(Boolean);
  const recentOpeners = new Set(recentTitles.map((title) => titleOpener(title)));

  try {
    const promptText = buildTitlePrompt(digest, currentTitle, input?.category, subject, recentTitles);
    const aiResult = await requestKnowledgeJsonWithFallback(promptText);
    const result = aiResult.data;
    const best = pickBestTitle(result?.titles, { subject, recentOpeners });
    if (best) {
      console.log(`[Title Engine] Judul viral digenerate via ${aiResult.provider}: "${best}"`);
      return best;
    }
    console.warn("[Title Engine] Provider AI tidak memberi kandidat judul valid; memakai fallback lokal.");
  } catch (error) {
    console.warn(`[Title Engine] Gagal generate judul viral: ${error.message}; memakai fallback lokal.`);
  }
  return safeFallback || currentTitle || "Fakta Menarik yang Jarang Diketahui";
}

export { fallbackTitle, pickBestTitle, titleBonus, detectComparison, DEFAULT_TITLE_PATTERNS };
