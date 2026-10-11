/**
 * Continuity Engine - memastikan ide, judul, tema, angle, dan formatType
 * tidak sama atau terlalu mirip dengan video yang sudah pernah dibuat.
 */

import { listContextItems } from "./storage.js";
import { cleanText } from "./util.js";

const SIMILARITY_THRESHOLD = 0.5;
const COMBO_LOOKBACK = 15;
const TITLE_SIMILARITY_THRESHOLD = 0.55;
const SUBJECT_STOP_WORDS = new Set([
  "fakta", "rahasia", "misteri", "kisah", "cerita", "sejarah", "politik",
  "kolonial", "dunia", "indonesia", "belanda", "jawa", "manusia", "orang",
  "peran", "dampak", "keputusan", "tersembunyi", "terungkap", "salah",
  "tentang", "dalam", "antara", "menjadi", "membuat", "mengubah", "pertama",
  "terakhir", "terbesar", "terdalam", "sebenarnya", "utama", "modern",
  "kenapa", "mengapa", "bagaimana", "semua", "alasan", "baterai", "bahasa",
  "warna", "energi", "teknologi", "makanan", "material", "suara", "musik",
  "hewan", "tumbuhan", "tubuh", "langit", "bintang", "planet", "lautan",
  "samudra", "sistem", "angka", "waktu", "gunung", "danau", "pulau", "kawah", "gempa", "bencana"
]);

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordSet(value) {
  const stop = new Set([
    "yang", "dan", "di", "ke", "dari", "untuk", "pada", "kenapa", "mengapa",
    "bisa", "adalah", "itu", "ini", "apa", "bagaimana", "the", "of", "a", "an",
    "padahal", "ternyata", "saja", "dengan", "atau", "juga", "para", "sebuah",
    "seorang", "suatu", "paling", "hanya", "lebih", "sangat", "banyak"
  ]);
  return new Set(
    normalizeTitle(value)
      .split(" ")
      .filter((w) => w.length > 3 && !stop.has(w))
  );
}

function subjectSet(value) {
  return new Set(
    [...keywordSet(value)]
      .filter((word) => word.length >= 5 && !SUBJECT_STOP_WORDS.has(word))
  );
}

function namedSubjectSet(value) {
  const words = String(value || "").match(/[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'-]*/g) || [];
  return new Set(
    words
      .filter((word) => word.length >= 5 && /^[A-Z\u00C0-\u00DE]/.test(word))
      .map((word) => normalizeTitle(word))
      .filter((word) => word && !SUBJECT_STOP_WORDS.has(word))
  );
}

function similarity(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const w of aSet) if (bSet.has(w)) inter += 1;
  const union = aSet.size + bSet.size - inter;
  return union > 0 ? inter / union : 0;
}

export async function loadHistory(limit = 100) {
  try {
    const items = await listContextItems();
    return (items || [])
      .map((it) => {
        const topic = cleanText(it.input?.topic || it.topic || it.title || "", 160);
        const title = cleanText(it.title || "", 100);
        const hook = cleanText(it.plan?.hook || it.hook || "", 240);
        const summary = cleanText(it.plan?.summary || it.summary || "", 360);
        const importantPoints = (it.plan?.importantPoints || it.importantPoints || [])
          .map((point) => cleanText(point, 180))
          .filter(Boolean)
          .slice(0, 5);
        return {
          topic,
          title,
          category: cleanText(it.input?.category || it.category || "", 80),
          angle: cleanText(it.input?.angle || it.angle || "", 80),
          formatType: cleanText(it.input?.formatType || it.formatType || "", 40),
          viralAngleId: cleanText(it.input?.viralAngleId || it.viralAngleId || "", 40),
          subjectText: [topic, title, hook, summary, ...importantPoints].filter(Boolean).join(" ")
        };
      })
      .filter((it) => it.topic)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Cek apakah kombinasi kandidat cukup segar dibandingkan history.
 * @returns {{ isFresh: boolean, reason: string, similarItem: object|null }}
 */
export function checkFreshness(candidate, history, options = {}) {
  const topicThreshold = options.topicThreshold || SIMILARITY_THRESHOLD;
  const titleThreshold = options.titleThreshold || TITLE_SIMILARITY_THRESHOLD;
  const comboLookback = options.comboLookback || COMBO_LOOKBACK;
  const allowRepeatedSubject = options.allowRepeatedSubject === true;

  const candNorm = normalizeTitle(candidate.topic);
  const candKeywords = keywordSet(candidate.topic);
  const candTitleKeywords = keywordSet(candidate.title || candidate.topic);
  const candidateSubjectText = [candidate.topic, candidate.title].filter(Boolean).join(" ");
  const candSubjects = subjectSet(candidateSubjectText);
  const candNamedSubjects = namedSubjectSet(candidateSubjectText);

  const recentHistory = history.slice(0, comboLookback);

  for (const past of recentHistory) {
    // Topik identik
    if (normalizeTitle(past.topic) === candNorm) {
      return { isFresh: false, reason: `topik identik pernah dibuat: "${past.title || past.topic}"`, similarItem: past };
    }

    // Topik mirip
    if (!allowRepeatedSubject && similarity(candKeywords, keywordSet(past.topic)) >= topicThreshold) {
      return { isFresh: false, reason: `topik terlalu mirip dengan: "${past.title || past.topic}"`, similarItem: past };
    }

    // Kombinasi category + angle + formatType sama
    if (
      candidate.category &&
      candidate.angle &&
      candidate.formatType &&
      past.category === candidate.category &&
      past.angle === candidate.angle &&
      past.formatType === candidate.formatType
    ) {
      return { isFresh: false, reason: `kombinasi kategori+angle+formatType sama dengan: "${past.title || past.topic}"`, similarItem: past };
    }

    if (
      candidate.category &&
      candidate.viralAngleId &&
      candidate.formatType &&
      past.category === candidate.category &&
      past.viralAngleId === candidate.viralAngleId &&
      past.formatType === candidate.formatType
    ) {
      return { isFresh: false, reason: `kombinasi kategori+viralAngle+formatType sama dengan: "${past.title || past.topic}"`, similarItem: past };
    }
  }

  // Subjek utama dan judul diperiksa terhadap seluruh history, bukan hanya lookback.
  for (const past of history) {
    const pastSubjectText = `${past.topic} ${past.title || ""}`;
    const pastSubjects = subjectSet(pastSubjectText);
    const pastNamedSubjects = namedSubjectSet(pastSubjectText);
    const sharedSubjects = [...candSubjects].filter((word) => pastSubjects.has(word));
    const sharedNamedSubjects = [...candNamedSubjects].filter((word) => pastNamedSubjects.has(word));
    if (!allowRepeatedSubject && (sharedNamedSubjects.length || sharedSubjects.length >= 2)) {
      const blockedSubjects = sharedNamedSubjects.length ? sharedNamedSubjects : sharedSubjects;
      return {
        isFresh: false,
        reason: `subjek "${blockedSubjects.join(", ")}" sudah pernah dibahas: "${past.title || past.topic}"`,
        similarItem: past
      };
    }
    if (similarity(candTitleKeywords, keywordSet(past.title)) >= titleThreshold) {
      return { isFresh: false, reason: `judul terlalu mirip dengan: "${past.title}"`, similarItem: past };
    }
  }

  return { isFresh: true, reason: "", similarItem: null };
}

/**
 * Verifikasi batch ide dari AI dan ambil yang pertama kali fresh.
 * @returns {object|null} idea yang fresh, atau null jika tidak ada.
 */
export function pickFreshIdeaFromBatch(ideas, formatType, angle, category, history, viralAngle = null) {
  for (const idea of ideas) {
    if (!idea?.topic) continue;
    const candidate = {
      topic: cleanText(idea.topic, 160),
      title: cleanText(idea.topic, 160),
      category: cleanText(idea.category || category, 80),
      angle: cleanText(idea.angle || angle, 80),
      formatType,
      viralAngleId: cleanText(viralAngle?.id || idea.viralAngleId || "", 40)
    };
    const check = checkFreshness(candidate, history);
    if (check.isFresh) return candidate;
    console.log(`[Continuity] Skip ide: ${check.reason}`);
  }
  return null;
}
