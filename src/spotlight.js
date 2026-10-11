import { config } from "./config.js";
import { buildWordTimeline, findPhraseTime, tokenizeMatchText } from "./word-timeline.js";

/**
 * Popup "Spotlight": kartu kecil berisi satu poin kunci yang muncul tepat saat
 * frasa pemicunya diucapkan.
 *
 * Prinsip desain: presisi datang dari PENOLAKAN, bukan animasi. Kartu hanya
 * tampil kalau frasa pemicu benar-benar ketemu di timeline kata dengan skor
 * tinggi. Tidak ketemu → dibatalkan, bukan ditebak posisinya. Popup yang muncul
 * di waktu yang salah lebih merusak daripada tidak ada popup sama sekali.
 *
 * ponytail: satu bentuk kartu (teks) untuk semua tipe. Tipe "figure" memakai
 * kartu yang sama, hanya sublabel-nya diisi peran tokoh, karena render kartu
 * foto lewat pureimage tidak bisa menggambar teks dengan font variable yang
 * dipakai repo ini (fillText crash pada NotoSans-Variable). Upgrade: tambahkan
 * font statis lalu render kartu berfoto sebagai overlay PNG.
 */

const MIN_SCORE = 0.48; // Toleransi skor pencocokan lebih baik agar kartu lebih sering muncul
const MIN_GAP_SEC = 5; // Jeda minimum antar kartu lebih rapat (sebelumnya 8s)
const MAX_PER_VIDEO = 22; // Kuota per video dinaikkan (sebelumnya 14)
const CARD_DURATION_SEC = 4.5; // Durasi tampil lebih lama (sebelumnya 3.6s) agar terbaca jelas di HP
const COMPARE_CARD_DURATION_SEC = 6; // Kartu perbandingan (2 angka + 2 nama) butuh waktu baca lebih lama
const LEAD_IN_SEC = 0.12;

const stats = { candidates: 0, placed: 0, rejectedScore: 0, rejectedQuota: 0, rejectedGap: 0 };

export function normalizeSpotlight(raw) {
  if (!raw || typeof raw !== "object") return null;
  const phrase = cleanShort(raw.phrase, 90);
  if (!phrase) return null;
  // "compare": bar chart animasi 2 nilai. Hanya valid kalau AI benar-benar mengisi
  // kedua nama dan kedua angka pembanding — tidak pernah diekstrak otomatis dari
  // regex (extractAutoSpotlight), karena menebak pasangan angka pembanding dari
  // teks bebas terlalu berisiko salah/mengarang.
  if (raw.type === "compare") {
    const label = cleanShort(raw.label, 24);
    const compareLabel = cleanShort(raw.compareLabel, 24);
    const value = Number(raw.value);
    const compareValue = Number(raw.compareValue);
    if (!label || !compareLabel || !Number.isFinite(value) || !Number.isFinite(compareValue) ||
        value <= 0 || compareValue <= 0) {
      return null;
    }
    return { type: "compare", label, compareLabel, value, compareValue, unit: cleanShort(raw.unit, 10), phrase };
  }
  const label = cleanShort(raw.label, 42);
  if (!label) return null;
  const type = raw.type === "figure" ? "figure" : "keypoint";
  return { type, label, sublabel: cleanShort(raw.sublabel, 52), phrase };
}

function formatCompareNumber(value, unit) {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  const text = rounded.toLocaleString("id-ID");
  if (!unit) return text;
  return unit === "x" ? `${text}x` : `${text} ${unit}`;
}

/**
 * Ekstraksi otomatis Spotlight jika AI tidak mengisi field spotlight.
 * Menjamin 8-18 spotlight muncul konsisten per video pada scene informatif.
 */
export function extractAutoSpotlight(scene) {
  if (!scene || scene.sceneType === "reaction" || scene.sceneType === "summary") return null;
  const narration = String(scene.narration || "").trim();
  if (!narration) return null;

  const rawScreenText = String(scene.screenText || "").trim();
  const isGeneric = /^(babak|scene|bagian|fakta|segmen)\s*\d*$/i.test(rawScreenText);

  // 1. Cari angka, persentase, tahun, atau satuan kuantitatif di narasi
  const statMatch =
    narration.match(/\b((?:(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|ratus|ribu|juta|miliar|triliun|puluhan|ratusan|ribuan|jutaan|miliaran|\d+[\d,.]*)\s+)+(?:persen|%|ribu|juta|miliar|triliun|meter|kilometer|km|ton|kg|derajat|jam|tahun|kali(?: lipat)?|sm|masehi|dolar|rupiah))\b/i) ||
    narration.match(/\b(tahun\s+\d{4}|\d{4}\s*sm|abad\s+ke-?\w+)\b/i);

  const words = narration.split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "").trim()).filter(Boolean);
  if (words.length < 3) return null;

  let label = "";
  let sublabel = "";
  let phrase = "";

  if (statMatch && statMatch.index !== undefined) {
    const matchIdx = statMatch.index;
    const beforeWords = narration.slice(0, matchIdx).split(/\s+/).map((w) => w.replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "").trim()).filter(Boolean);
    const startWordIdx = Math.max(0, beforeWords.length - 1);
    const phraseWords = words.slice(startWordIdx, startWordIdx + 4);
    phrase = phraseWords.join(" ");

    if (!isGeneric && rawScreenText.length >= 3 && rawScreenText.length <= 42) {
      label = rawScreenText;
      sublabel = statMatch[0].trim();
    } else {
      label = statMatch[0].trim();
      sublabel = "Fakta Kunci";
    }
  } else if (!isGeneric && rawScreenText.length >= 3 && rawScreenText.length <= 42) {
    const phraseWords = words.slice(0, Math.min(4, words.length));
    phrase = phraseWords.join(" ");
    label = rawScreenText;
    sublabel = "Poin Utama";
  }

  if (!label || !phrase) return null;

  return {
    type: "keypoint",
    label: cleanShort(label, 42),
    sublabel: cleanShort(sublabel, 52),
    phrase: cleanShort(phrase, 90)
  };
}

function cleanShort(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").trim();
}

/**
 * Tentukan kapan tiap kartu muncul. Scene reaction dan summary dilewati:
 * keduanya sudah punya teks penuh layar sendiri.
 * @returns {{ sceneIndex: number, startSec: number, endSec: number, label: string, sublabel: string, type: string, score: number }[]}
 */
export function planSceneSpotlights(scenes, options = {}) {
  const maxPerVideo = Math.max(0, Math.floor(Number(options.maxPerVideo ?? MAX_PER_VIDEO)));
  const minGap = Number(options.minGapSec ?? MIN_GAP_SEC);
  const minScore = Number(options.minScore ?? MIN_SCORE);
  const excludedScenes = options.excludedSceneIndexes instanceof Set
    ? options.excludedSceneIndexes
    : new Set(Array.isArray(options.excludedSceneIndexes) ? options.excludedSceneIndexes : []);
  const placed = [];

  for (const scene of scenes || []) {
    if (scene?.sceneType === "reaction" || scene?.sceneType === "summary") continue;
    const sIdx = Number(scene.index || 0);
    if (excludedScenes.has(sIdx) || scene.hasMockup) continue;
    const spotlight = normalizeSpotlight(scene?.spotlight) || extractAutoSpotlight(scene);
    if (!spotlight) continue;
    stats.candidates += 1;

    const timeline = buildWordTimeline(scene.sceneCaptions);
    const match = findPhraseTime(timeline, tokenizeMatchText(spotlight.phrase));
    if (!match || match.score < minScore) {
      stats.rejectedScore += 1;
      continue;
    }

    const sceneStart = Number(scene.startSec || 0);
    const sceneDuration = Number(scene.durationSec || 0);
    const localStart = Math.max(0, match.time - LEAD_IN_SEC);
    // Kartu tidak boleh menyeberang ke scene berikutnya: visual di baliknya
    // sudah berganti dan kartu jadi terlihat nyasar.
    const available = sceneDuration - localStart;
    if (available < 1.6) {
      stats.rejectedScore += 1;
      continue;
    }
    const startSec = sceneStart + localStart;
    if (placed.length && startSec - placed.at(-1).startSec < minGap) {
      stats.rejectedGap += 1;
      continue;
    }

    const cardDuration = spotlight.type === "compare" ? COMPARE_CARD_DURATION_SEC : CARD_DURATION_SEC;
    placed.push({
      sceneIndex: Number(scene.index || 0),
      startSec: Number(startSec.toFixed(3)),
      endSec: Number((startSec + Math.min(cardDuration, available)).toFixed(3)),
      label: spotlight.label,
      sublabel: spotlight.sublabel,
      type: spotlight.type,
      score: Number(match.score.toFixed(2)),
      ...(spotlight.type === "compare"
        ? { compareLabel: spotlight.compareLabel, value: spotlight.value, compareValue: spotlight.compareValue, unit: spotlight.unit }
        : {})
    });
  }

  // Spread a limited quota across the entire story, including its final chapters.
  const selected = placed.length <= maxPerVideo ? placed
    : Array.from({ length: maxPerVideo }, (_, i) => placed[
      maxPerVideo === 1 ? Math.floor(placed.length / 2)
        : Math.round(i * (placed.length - 1) / (maxPerVideo - 1))
    ]);
  stats.rejectedQuota += placed.length - selected.length;
  stats.placed += selected.length;
  return selected;
}

/**
 * Satu baris ringkasan penempatan spotlight per render, lalu reset counter.
 */
export function logSpotlightStats() {
  if (!stats.candidates) return null;
  const snapshot = { ...stats };
  console.log(
    `[Spotlight] kandidat ${snapshot.candidates} | tampil ${snapshot.placed} | ditolak skor/ruang ${snapshot.rejectedScore}, kuota ${snapshot.rejectedQuota}, jarak ${snapshot.rejectedGap}`
  );
  for (const key of Object.keys(stats)) stats[key] = 0;
  return snapshot;
}

const ACCENT = "&H004CC8F5";

// Keypoint spotlight — pojok kiri bawah (diperbesar agar jelas di layar smartphone)
const KP_X = 64;
const KP_Y = 450;
const KP_W = 540;

// Figure spotlight — tengah layar (PlayRes 1280×720, diperbesar agar jelas di HP)
const FIG_W = 660;
const FIG_X = Math.round((1280 - FIG_W) / 2); // 310
const FIG_Y = 230; // sepertiga atas layar agar tidak tutup caption bawah

// Compare spotlight — bar chart 2 nilai, tengah layar seperti kartu figure
const CMP_W = 520;
const CMP_X = Math.round((1280 - CMP_W) / 2); // 380
const CMP_Y = 210;
const CMP_BAR_W = 100;
const CMP_BAR_GAP = 70;
const CMP_BAR_MAX_H = 130;
const CMP_PAD_TOP = 46; // ruang label angka di atas bar
const CMP_NAME_ROW_H = 48; // ruang label nama di bawah bar
const CMP_H = CMP_PAD_TOP + CMP_BAR_MAX_H + CMP_NAME_ROW_H;

/**
 * Baris ASS untuk kartu spotlight.
 * - type "figure"   → kartu besar di tengah layar (nama tokoh + jabatan)
 * - type "keypoint" → kartu kecil di pojok kiri bawah (fakta kunci)
 */
export function spotlightDialogueLines(placements, dialogueFn, escapeFn) {
  const events = [];
  for (const card of placements || []) {
    const isFigure = card.type === "figure";
    const twoLine = Boolean(card.sublabel);
    const fade = "{\\fad(250,300)}";

    if (isFigure) {
      // Kartu tokoh: tengah layar, lebih besar, lega untuk avatar 92px
      const height = twoLine ? 160 : 128;
      const top = FIG_Y;
      events.push(dialogueFn(
        card.startSec, card.endSec, "FigurePanel",
        `${fade}{\\an7\\pos(${FIG_X},${top})\\p1}m 0 0 l ${FIG_W} 0 l ${FIG_W} ${height} l 0 ${height}`
      ));
      events.push(dialogueFn(
        card.startSec, card.endSec, "FigureBar",
        `${fade}{\\an7\\pos(${FIG_X},${top})\\p1}m 0 0 l 8 0 l 8 ${height} l 0 ${height}`
      ));
      // Teks tokoh ditaruh di area tengah-kanan kartu (setelah avatar di sisi kiri)
      const textCenterX = Math.round(FIG_X + 120 + (FIG_W - 120) / 2);
      events.push(dialogueFn(
        card.startSec + 0.08, card.endSec, "FigureLabel",
        `${fade}{\\an5\\pos(${textCenterX},${top + (twoLine ? 46 : 56)})}${escapeFn(card.label)}`
      ));
      if (twoLine) {
        events.push(dialogueFn(
          card.startSec + 0.14, card.endSec, "FigureSub",
          `${fade}{\\an5\\pos(${textCenterX},${top + 98})}${escapeFn(card.sublabel)}`
        ));
      }
    } else if (card.type === "compare") {
      // Kartu perbandingan: dua bar animasi tumbuh dari baseline yang sama,
      // tingginya proporsional terhadap value/compareValue. Label angka di atas
      // tiap bar (posisi tetap, tidak ikut animasi) dan nama di bawah baseline.
      const totalBarsW = CMP_BAR_W * 2 + CMP_BAR_GAP;
      const barsX = CMP_X + Math.round((CMP_W - totalBarsW) / 2);
      const barAX = barsX;
      const barBX = barsX + CMP_BAR_W + CMP_BAR_GAP;
      const bottomY = CMP_Y + CMP_PAD_TOP + CMP_BAR_MAX_H;
      const maxVal = Math.max(card.value, card.compareValue, 1e-9);
      const hA = Math.max(18, Math.round(CMP_BAR_MAX_H * (card.value / maxVal)));
      const hB = Math.max(18, Math.round(CMP_BAR_MAX_H * (card.compareValue / maxVal)));
      const topA = bottomY - hA;
      const topB = bottomY - hB;

      events.push(dialogueFn(
        card.startSec, card.endSec, "ComparePanel",
        `${fade}{\\an7\\pos(${CMP_X},${CMP_Y})\\p1}m 0 0 l ${CMP_W} 0 l ${CMP_W} ${CMP_H} l 0 ${CMP_H}`
      ));
      events.push(dialogueFn(
        card.startSec, card.endSec, "CompareBar",
        `${fade}{\\an7\\pos(${CMP_X},${CMP_Y})\\p1}m 0 0 l 8 0 l 8 ${CMP_H} l 0 ${CMP_H}`
      ));
      // Bar tumbuh dari baseline: \org di titik bawah bar jadi titik jangkar skala,
      // \fscy dimulai kecil lalu di-tween ke 100% agar tampak "tumbuh ke atas".
      events.push(dialogueFn(
        card.startSec, card.endSec, "CompareBar",
        `${fade}{\\an7\\org(${barAX + Math.round(CMP_BAR_W / 2)},${bottomY})\\pos(${barAX},${topA})\\fscy12\\t(80,480,\\fscy100)\\p1}m 0 0 l ${CMP_BAR_W} 0 l ${CMP_BAR_W} ${hA} l 0 ${hA}`
      ));
      events.push(dialogueFn(
        card.startSec, card.endSec, "CompareBarMuted",
        `${fade}{\\an7\\org(${barBX + Math.round(CMP_BAR_W / 2)},${bottomY})\\pos(${barBX},${topB})\\fscy12\\t(80,480,\\fscy100)\\p1}m 0 0 l ${CMP_BAR_W} 0 l ${CMP_BAR_W} ${hB} l 0 ${hB}`
      ));
      events.push(dialogueFn(
        card.startSec + 0.1, card.endSec, "CompareValue",
        `${fade}{\\an2\\pos(${barAX + Math.round(CMP_BAR_W / 2)},${topA - 10})}${escapeFn(formatCompareNumber(card.value, card.unit))}`
      ));
      events.push(dialogueFn(
        card.startSec + 0.1, card.endSec, "CompareValue",
        `${fade}{\\an2\\pos(${barBX + Math.round(CMP_BAR_W / 2)},${topB - 10})}${escapeFn(formatCompareNumber(card.compareValue, card.unit))}`
      ));
      events.push(dialogueFn(
        card.startSec + 0.16, card.endSec, "CompareName",
        `${fade}{\\an8\\pos(${barAX + Math.round(CMP_BAR_W / 2)},${bottomY + 8})}${escapeFn(card.label)}`
      ));
      events.push(dialogueFn(
        card.startSec + 0.16, card.endSec, "CompareName",
        `${fade}{\\an8\\pos(${barBX + Math.round(CMP_BAR_W / 2)},${bottomY + 8})}${escapeFn(card.compareLabel)}`
      ));
    } else {
      // Kartu keypoint: pojok kiri bawah (font lebih besar, panel lebih lega)
      const height = twoLine ? 132 : 92;
      const top = KP_Y + (twoLine ? 0 : 20);
      events.push(dialogueFn(
        card.startSec, card.endSec, "SpotlightPanel",
        `${fade}{\\an7\\pos(${KP_X},${top})\\p1}m 0 0 l ${KP_W} 0 l ${KP_W} ${height} l 0 ${height}`
      ));
      events.push(dialogueFn(
        card.startSec, card.endSec, "SpotlightBar",
        `${fade}{\\an7\\pos(${KP_X},${top})\\p1}m 0 0 l 6 0 l 6 ${height} l 0 ${height}`
      ));
      events.push(dialogueFn(
        card.startSec + 0.08, card.endSec, "SpotlightLabel",
        `${fade}{\\an7\\pos(${KP_X + 24},${top + 16})}${escapeFn(card.label)}`
      ));
      if (twoLine) {
        events.push(dialogueFn(
          card.startSec + 0.14, card.endSec, "SpotlightSub",
          `${fade}{\\an7\\pos(${KP_X + 24},${top + 64})}${escapeFn(card.sublabel)}`
        ));
      }
    }
  }
  return events;
}

export function spotlightStyles() {
  const body = config.render.fontBody;
  return [
    // Keypoint — pojok kiri bawah (font diperbesar dari 30->36 dan 22->26)
    `Style: SpotlightPanel,${body},20,&HC011171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SpotlightBar,${body},20,${ACCENT},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: SpotlightLabel,${body},42,&H00FFFFFF,&H000000FF,&H9011171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1`,
    `Style: SpotlightSub,${body},30,${ACCENT},&H000000FF,&H9011171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1`,
    // Figure — tengah layar (font diperbesar dari 38->46 dan 26->30)
    `Style: FigurePanel,${body},20,&HE011171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: FigureBar,${body},20,${ACCENT},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: FigureLabel,${body},52,&H00FFFFFF,&H000000FF,&HAA11171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.8,0,5,0,0,0,1`,
    `Style: FigureSub,${body},34,${ACCENT},&H000000FF,&HAA11171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.5,0,5,0,0,0,1`,
    // Compare — kartu bar chart 2 nilai, tengah layar
    `Style: ComparePanel,${body},20,&HE011171B,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: CompareBar,${body},20,${ACCENT},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: CompareBarMuted,${body},20,&H00888888,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: CompareValue,${body},40,&H00FFFFFF,&H000000FF,&HAA11171B,&H0011171B,-1,0,0,0,100,100,0,0,1,1.5,0,2,0,0,0,1`,
    `Style: CompareName,${body},28,${ACCENT},&H000000FF,&HAA11171B,&H0011171B,0,0,0,0,100,100,0,0,1,1.2,0,8,0,0,0,1`
  ];
}
