import { simplifyForLayAudience } from "./story-language.js";

/**
 * Format Engine - mendefinisikan pola struktur video yang berbeda-beda.
 * Tujuannya: menghancurkan pola tetap "2 image 1 reaction" agar video tidak terasa template.
 */

export const FORMAT_TYPES = {
  dokumenter_klasik: {
    label: "Dokumenter Klasik",
    description: "Hook kuat → konteks → analisis mendalam → kesimpulan. Pola paling fleksibel, mirip Vox atau Lemmino.",
    reactionFrequency: 3,
    minScenes: 10,
    narrativeCue: "Bangun argumen logis step-by-step. Reaction muncul setiap 2 scene image sebagai pertanyaan penasaran yang membawa ke babak berikutnya."
  },
  investigasi_misteri: {
    label: "Investigasi Misteri",
    description: "Pertanyaan besar di awal → petunjuk-petunjuk → pengungkapan → konsekuensi. Seperti film detektif dokumenter.",
    reactionFrequency: 4,
    minScenes: 12,
    narrativeCue: "Susun seperti detektif: setiap scene image memberi petunjuk baru. Reaction muncul saat menemukan 'clue' penting. Jangan jawab semua di awal; simpan pengungkapan untuk babak akhir."
  },
  timeline_evolutif: {
    label: "Timeline Evolutif",
    description: "Masa lalu → transisi → masa kini → prediksi masa depan. Waktu adalah tulang punggung narasi.",
    reactionFrequency: 4,
    minScenes: 10,
    narrativeCue: "Gunakan penanda waktu yang jelas. Reaction berfungsi sebagai 'fast forward' atau pertanyaan 'lalu bagaimana sekarang?' yang menghubungkan era."
  },
  mitos_vs_fakta: {
    label: "Mitos vs Fakta",
    description: "Klaim populer → bukti menyangkal → mekanisme ilmiah → aplikasi nyata. Langsung hancurkan mitos.",
    reactionFrequency: 2,
    minScenes: 10,
    narrativeCue: "Buka dengan klaim yang sering dipercaya. Reaction langsung menunjukkan keraguan atau kaget. Hancurkan mitos dengan data konkret, bukan opini."
  },
  kisah_manusia: {
    label: "Kisah Manusia",
    description: "Fokus pada individu, konflik pribadi, keputusan kritis, dan pelajaran hidup. Lebih naratif, lebih emosional. Cerita bergaya sketsa stick figure dengan detail mendalam, karakter dinamis, dan visual yang menarik untuk mencegah kebosanan penonton.",
    reactionFrequency: 5,
    minScenes: 10,
    narrativeCue: "Ceritakan seperti biografi singkat. Reaction muncul hanya saat momen emosional atau keputusan kritis. Gunakan visual sketsa stick figure yang kaya detail dengan berbagai gaya ilustrasi untuk menjaga perhatian penonton."
  },
  stick_figure_rich: {
    label: "Sketsa Stick Figure Kaya",
    description: "Visual bergaya sketsa dengan berbagai gaya ilustrasi, karakter dinamis, kehidupan dalam, dan detail yang kaya. Bangun kedalaman naratif melalui detail visual yang teliti dan karakter yang hidup.",
    reactionFrequency: 4,
    minScenes: 12,
    narrativeCue: "Buat sketsa informatif yang hidup dengan karakter dinamis, gaya ilustrasi yang bervariasi, dan detail visual yang kaya. Gunakan tekstur, kedalaman, dan gaya khusus untuk menceritakan cerita dengan kedalaman yang sama seperti video dokumenter panjang yt-longform."
  },
  countdown: {
    label: "Countdown",
    description: "Hitung mundur #5 → #4 → #3 → #2 → #1 dengan alasan mendalam di balik setiap peringkat.",
    reactionFrequency: 2,
    minScenes: 12,
    narrativeCue: "Setiap angka countdown harus punya narasi kuat dan self-contained. Reaction berfungsi sebagai transisi 'tapi yang lebih mengejutkan adalah...'. Jangan rush; setiap peringkat pantas dijelaskan."
  },
  debat_dua_sisi: {
    label: "Debat Dua Sisi",
    description: "Argumen pro → kontra → data netral → penutup seimbang. Tampilkan kedua sisi secara adil.",
    reactionFrequency: 2,
    minScenes: 10,
    narrativeCue: "Presentasikan argumen pro secara kuat, lalu kontra dengan sama kuat. Reaction adalah 'tapi tunggu, ada sisi lain'. Akhiri dengan sintesis, bukan pemenang."
  },
  fenomena_alam: {
    label: "Fenomena Alam",
    description: "Observasi → hipotesis → bukti → implikasi. Mulai dari apa yang terlihat, lalu mengapa.",
    reactionFrequency: 4,
    minScenes: 10,
    narrativeCue: "Mulai dari gejala yang terlihat sehari-hari. Reaction muncul saat mengajukan hipotesis. Akhiri dengan implikasi luas yang membuat penonton melihat alam berbeda."
  },
  perbandingan: {
    label: "Perbandingan",
    description: "A vs B, sebelum vs sesudah, atau dua pendekatan berbeda. Struktur paralel yang jelas.",
    reactionFrequency: 2,
    minScenes: 10,
    narrativeCue: "Jelaskan sisi A secara adil, lalu sisi B. Reaction berfungsi sebagai 'bandingkan keduanya'. Jangan memihak terlalu dini; biarkan data bicara."
  },
  eksperimen_berpikir: {
    label: "Eksperimen Berpikir",
    description: "Bayangkan jika... → konsekuensi → implikasi nyata. Hipotesis ekstrem yang mengguncang perspektif.",
    reactionFrequency: 3,
    minScenes: 10,
    narrativeCue: "Gunakan 'bayangkan' atau 'apa jika' untuk membuka. Reaction muncul saat konsekuensi mulai tidak terduga atau absurd. Akhiri dengan pelajaran nyata yang bisa diterapkan."
  }
};

/**
 * Pilih formatType acak, tapi hindari yang dipakai beberapa video terakhir
 * supaya struktur storyboard tidak terasa berulang. Pola sama dengan pickViralAngle().
 */
export function pickFormatType(history = []) {
  const keys = Object.keys(FORMAT_TYPES);
  const recent = new Set(
    history
      .slice(0, 5)
      .map((item) => item?.formatType || item?.input?.formatType || "")
      .filter(Boolean)
  );
  const candidates = keys.filter((key) => !recent.has(key));
  const pool = candidates.length ? candidates : keys;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function formatTypeDescription(formatType) {
  return simplifyForLayAudience(FORMAT_TYPES[formatType]?.description || FORMAT_TYPES.dokumenter_klasik.description, 500);
}

export function formatTypeNarrativeCue(formatType) {
  return simplifyForLayAudience(FORMAT_TYPES[formatType]?.narrativeCue || FORMAT_TYPES.dokumenter_klasik.narrativeCue, 500);
}

function patternDokumenterKlasik(count) {
  const types = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if ((i + 1) % 3 === 0 && i < count - 2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternInvestigasiMisteri(count) {
  const types = [];
  const clue1 = Math.max(2, Math.floor(count * 0.3));
  const clue2 = Math.max(clue1 + 2, Math.floor(count * 0.6));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === clue1 || i === clue2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternTimelineEvolutif(count) {
  const types = [];
  const t1 = Math.max(2, Math.floor(count * 0.35));
  const t2 = Math.max(t1 + 2, Math.floor(count * 0.7));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === t1 || i === t2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternMitosVsFakta(count) {
  const types = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i > 0 && i % 2 === 1 && i < count - 2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternKisahManusia(count) {
  const types = [];
  const emotional = Math.floor(count * 0.45);
  const climax = count > 12 ? Math.floor(count * 0.75) : -1;
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === emotional || i === climax) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternCountdown(count) {
  const types = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i % 2 === 1 && i < count - 2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternDebatDuaSisi(count) {
  const types = [];
  const t1 = Math.max(2, Math.floor(count * 0.33));
  const t2 = Math.max(t1 + 2, Math.floor(count * 0.66));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === t1 || i === t2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternFenomenaAlam(count) {
  const types = [];
  const h = Math.max(2, Math.floor(count * 0.3));
  const c = Math.max(h + 2, Math.floor(count * 0.7));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === h || i === c) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternPerbandingan(count) {
  const types = [];
  const t1 = Math.max(2, Math.floor(count * 0.33));
  const t2 = Math.max(t1 + 2, Math.floor(count * 0.66));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === t1 || i === t2) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternEksperimenBerpikir(count) {
  const types = [];
  const w = Math.max(2, Math.floor(count * 0.35));
  const imp = Math.max(w + 2, Math.floor(count * 0.7));
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === w || i === imp) types.push("reaction");
    else types.push("image");
  }
  return types;
}

function patternStickFigureRich(count) {
  const types = [];
  const emotional = Math.floor(count * 0.45);
  const climax = count > 12 ? Math.floor(count * 0.75) : -1;
  const visualVarieties = Math.min(8, Math.floor(count / 2));
  
  for (let i = 0; i < count; i++) {
    if (i === count - 1) types.push("summary");
    else if (i === emotional || i === climax) types.push("reaction");
    else if (i % 2 === 1 && i < count - 2 && i < visualVarieties) types.push("image");
    else types.push("image");
  }
  return types;
}

/**
 * Bangun array scene types berdasarkan formatType dan jumlah scene.
 * Scene terakhir selalu 'summary'.
 * @param {number} sceneCount
 * @param {string} formatType
 * @returns {string[]}
 */
export function buildScenePattern(sceneCount, formatType = "dokumenter_klasik") {
  const count = Math.max(8, Math.floor(sceneCount || 36));
  switch (formatType) {
    case "dokumenter_klasik": return patternDokumenterKlasik(count);
    case "investigasi_misteri": return patternInvestigasiMisteri(count);
    case "timeline_evolutif": return patternTimelineEvolutif(count);
    case "mitos_vs_fakta": return patternMitosVsFakta(count);
    case "kisah_manusia": return patternKisahManusia(count);
    case "countdown": return patternCountdown(count);
    case "debat_dua_sisi": return patternDebatDuaSisi(count);
    case "fenomena_alam": return patternFenomenaAlam(count);
    case "perbandingan": return patternPerbandingan(count);
    case "eksperimen_berpikir": return patternEksperimenBerpikir(count);
    case "stick_figure_rich": return patternStickFigureRich(count);
    default: return patternDokumenterKlasik(count);
  }
}

/**
 * Rentang kata per scene yang BISA dicapai pola format ini.
 *
 * Anggaran narasi utama dibagi sesuai jumlah scene image/summary pada format
 * terpilih agar format dengan banyak reaction tetap dapat mencapai target.
 * Reaction juga dibacakan, tetapi memakai kalimat pendek di luar anggaran ini.
 *
 * @param {number} sceneCount
 * @param {string} formatType
 * @param {number} durationSec
 * @returns {{ narratedScenes: number, targetWords: number, minimumWords: number, imageMin: number, imageMax: number, summaryMin: number, summaryMax: number }}
 */
export function sceneWordRange(sceneCount, formatType, durationSec) {
  const narratedScenes = buildScenePattern(sceneCount, formatType)
    .filter((type) => type !== "reaction").length || 1;
  const seconds = Math.max(60, Number(durationSec) || 300);
  // Around 2,280 words at 20 minutes; measured TTS determines enrichment and final timing.
  const targetWords = Math.round(seconds * 1.9);
  const minimumWords = Math.round(seconds * 1.8);
  const imageMin = Math.max(35, Math.ceil(minimumWords / narratedScenes));
  const imageMax = Math.max(imageMin + 12, Math.ceil((seconds * 2.05) / narratedScenes));
  return {
    narratedScenes,
    targetWords,
    minimumWords,
    imageMin,
    imageMax,
    summaryMin: imageMin + 7,
    summaryMax: imageMax + 10
  };
}

/**
 * Ambil sceneType untuk index tertentu. Kalau AI sudah mengirimkan sceneType yang valid,
 * gunakan itu. Kalau tidak, pakai pola dari formatType.
 */
export function resolveSceneType(value, index, total, formatType = "dokumenter_klasik") {
  if (value && ["image", "reaction", "summary"].includes(value)) return value;
  const pattern = buildScenePattern(total, formatType);
  return pattern[index] || "image";
}
