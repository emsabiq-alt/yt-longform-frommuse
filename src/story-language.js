import { cleanText } from "./util.js";

const TERM_REPLACEMENTS = [
  [/\befek domino\b/gi, "rangkaian akibat"],
  [/\blanskap urban\b/gi, "wajah kota"],
  [/\btatanan sosial\b/gi, "cara hidup masyarakat"],
  [/\bparadoks modern\b/gi, "hal yang terlihat bertentangan hari ini"],
  [/\bparadoks\b/gi, "hal yang terlihat bertentangan"],
  [/\bmekanisme\b/gi, "cara kerja"],
  [/\bimplikasi\b/gi, "arti"],
  [/\bkonsekuensi\b/gi, "akibat"],
  [/\bhipotesis\b/gi, "dugaan awal"],
  [/\banalisis\b/gi, "penjelasan"],
  [/\banalitis\b/gi, "jelas dan masuk akal"],
  [/\bargumen\b/gi, "alasan"],
  [/\bsintesis\b/gi, "kesimpulan seimbang"],
  [/\bobservasi\b/gi, "pengamatan"],
  [/\bperspektif\b/gi, "cara melihat"],
  [/\bfenomena\b/gi, "kejadian"],
  [/\bsistemik\b/gi, "menyebar ke banyak bagian"],
  [/\bgeopolitik\b/gi, "hubungan antar negara"],
  [/\bfundamental\b/gi, "paling dasar"],
  [/\bkompleks\b/gi, "rumit"],
  [/\bdilema\b/gi, "pilihan sulit"],
  [/\bklimaks\b/gi, "bagian paling penting"],
  [/\bbabak\b/gi, "bagian"],
  [/\btesis\b/gi, "gagasan utama"],
  [/\besai dokumenter\b/gi, "cerita pengetahuan"],
  [/\btransformasi\b/gi, "perubahan besar"],
  [/\btransisi\b/gi, "perubahan bertahap"],
  [/\bkonteks\b/gi, "latar belakang"],
  [/\babstrak\b/gi, "sulit dibayangkan"],
  [/\bsignifikansi\b/gi, "pentingnya"],
  [/\bsignifikan\b/gi, "besar"],
  [/\bkrusial\b/gi, "sangat penting"],
  [/\besensial\b/gi, "penting"],
  [/\beksponensial\b/gi, "naik sangat cepat"],
  [/\bkorelasi\b/gi, "hubungan"],
  [/\bkontradiksi\b/gi, "pertentangan"],
  [/\bakumulasi\b/gi, "penumpukan"],
  [/\beskalasi\b/gi, "peningkatan tajam"],
  [/\bstagnan\b/gi, "jalan di tempat"],
  [/\bdistorsi\b/gi, "penyimpangan"],
  [/\banomali\b/gi, "kejadian aneh"],
  [/\bempiris\b/gi, "berdasarkan bukti nyata"],
  [/\bteoritis\b/gi, "di atas kertas"],
  [/\bkognitif\b/gi, "cara berpikir"],
  [/\bdisparitas\b/gi, "kesenjangan"],
  [/\bkonsensus\b/gi, "kesepakatan"],
  [/\bambigu\b/gi, "tidak jelas"],
  [/\bimplisit\b/gi, "tersirat"],
  [/\beksplisit\b/gi, "tegas"],
  [/\bkompleksitas\b/gi, "kerumitan"],
  [/\bsubstansial\b/gi, "cukup besar"],
  [/\bmasif\b/gi, "sangat besar"],
  [/\bkomprehensif\b/gi, "menyeluruh"],
  [/\bakselerasi\b/gi, "percepatan"],
  [/\bintervensi\b/gi, "campur tangan"],
  [/\bdegradasi\b/gi, "penurunan mutu"],
  [/\beksistensi\b/gi, "keberadaan"],
  [/\bdinamika\b/gi, "naik turunnya"]
];

const GENERIC_SCREEN_TEXT = /^(pertanyaan besar|awal cerita|titik buta|data penting|konflik inti|efek domino|pembalikan|pelajaran|hook dan konteks|akar masalah|analisis utama|dampak dan pembalikan|kesimpulan|ringkasan inti|hal yang berubah|fakta perubahan|fakta|babak|scene|bagian)(\s+\d+)?$/i;

const SCREEN_FALLBACKS = [
  "Awal Masalahnya",
  "Fakta yang Terlewat",
  "Bukti Mulai Terlihat",
  "Hal yang Berubah",
  "Angka yang Mengejutkan",
  "Pilihan yang Mengubah Arah",
  "Akibatnya Mulai Terasa",
  "Hal yang Sering Keliru",
  "Petunjuk Terakhir",
  "Yang Perlu Diingat"
];

const CHAPTERS = [
  "Pembuka",
  "Awal Masalah",
  "Bukti Baru",
  "Akibatnya",
  "Penutup"
];

const PURPOSES = [
  "Membuat penonton langsung paham pertanyaan utamanya.",
  "Menjelaskan awal cerita dengan contoh yang mudah dibayangkan.",
  "Menambah fakta baru agar alurnya maju.",
  "Menunjukkan akibat yang mulai terlihat.",
  "Menutup cerita dengan pelajaran yang mudah diingat."
];

const STOPWORDS = new Set([
  "yang", "dan", "atau", "di", "ke", "dari", "ini", "itu", "adalah", "dengan",
  "untuk", "pada", "dalam", "karena", "sebagai", "bisa", "akan", "saat", "kita",
  "mereka", "sebuah", "satu", "bagaimana", "mengapa", "kenapa", "apa", "lalu",
  "namun", "tetapi", "sementara", "tersebut", "jadi", "mulai"
]);

export function simplifyForLayAudience(value, max = 2000) {
  let text = cleanText(value || "", max || 2000);
  for (const [pattern, replacement] of TERM_REPLACEMENTS) {
    // Istilah yang diikuti kata berhuruf kapital adalah bagian dari nama diri
    // ("Paradoks Fermi", "Sintesis Protein", "Transisi Demografi"). Mengganti
    // bagian depannya merusak nama yang justru dicari penonton, dan ini ikut
    // terbaca di title serta narasi TTS.
    text = text.replace(pattern, (match, ...rest) => {
      const full = String(rest[rest.length - 1]);
      const offset = Number(rest[rest.length - 2]);
      return /^\s+\p{Lu}/u.test(full.slice(offset + match.length)) ? match : replacement;
    });
  }
  return cleanText(text, max || 2000);
}

export function isGenericStoryboardText(value) {
  return GENERIC_SCREEN_TEXT.test(cleanText(value || "", 120));
}

/**
 * Buang kalimat kembar. `seen` opsional dipakai untuk berbagi sidik jari ANTAR
 * scene: tanpa itu, dua scene yang menyatakan fakta sama dengan kata berbeda
 * sama-sama lolos dan video terasa berputar di tempat.
 * Minimal satu kalimat selalu dipertahankan supaya narasi tidak pernah kosong
 * (narasi kosong = scene bisu dengan durasi yang tetap terpakai).
 */
export function dedupeSentences(value, max = 2000, seen = null) {
  const text = simplifyForLayAudience(value, max);
  const sentences = text.match(/[^.!?]+[.!?]?/g) || (text ? [text] : []);
  const kept = [];
  const fingerprints = Array.isArray(seen) ? seen : [];
  let firstSentence = "";

  for (const raw of sentences) {
    const sentence = cleanText(raw, max);
    if (!sentence) continue;
    const fingerprint = textFingerprint(sentence);
    if (!fingerprint) continue;
    if (!firstSentence) firstSentence = sentence;
    const repeated = fingerprints.some((known) => known === fingerprint || jaccard(known, fingerprint) >= 0.78);
    if (repeated) continue;
    fingerprints.push(fingerprint);
    kept.push(sentence);
  }

  return cleanText(kept.length ? kept.join(" ") : firstSentence, max);
}

export function polishPlanForLayAudience(plan, input = {}) {
  const sceneCount = Array.isArray(plan?.scenes) ? plan.scenes.length : 0;
  const usedScreen = new Set();
  const usedPurpose = new Set();
  // Judul bab = screenText scene pertama di tiap bagian, supaya daftar bab
  // YouTube berisi frasa konkret, bukan label generik "Awal Masalah".
  const chapterTitles = new Map();
  const usedChapter = new Set();
  // Sidik jari dibagikan ANTAR scene. dedupeSentences per-scene hanya menangkap
  // pengulangan di dalam satu scene, jadi dua scene yang menyatakan fakta sama
  // dengan kata berbeda dulu lolos keduanya dan video terasa jalan di tempat.
  const seenSentences = [];
  let droppedSentences = 0;

  const polished = {
    ...plan,
    title: simplifyForLayAudience(plan?.title || input.topic || "", 100),
    hook: simplifyForLayAudience(plan?.hook || "", 300),
    summary: dedupeSentences(plan?.summary || "", 700),
    importantPoints: uniqueTextList(plan?.importantPoints || [], 8, 220),
    factCheckNote: simplifyForLayAudience(plan?.factCheckNote || "", 300)
  };

  polished.scenes = (plan?.scenes || []).map((scene, index) => {
    const sceneType = scene?.sceneType || "image";
    // Scene summary sengaja TIDAK ikut dedupe lintas scene: tugasnya justru
    // mengulang inti yang sudah disebut, dan narasi penutup wajib ada.
    const shared = sceneType === "image" ? seenSentences : null;
    const before = sentenceCount(scene?.narration);
    const next = {
      ...scene,
      narration: sceneType === "reaction"
        ? simplifyForLayAudience(scene?.narration || "", 180)
        : dedupeSentences(scene?.narration || "", 4000, shared),
      reactionCue: simplifyForLayAudience(scene?.reactionCue || "", 120)
    };
    if (shared) droppedSentences += Math.max(0, before - sentenceCount(next.narration));

    if (sceneType === "reaction") {
      let question = cleanText(scene?.reactionText || scene?.screenText || scene?.narration || "", 180);
      const isGeneric = !question
        || isGenericStoryboardText(question)
        || /^(fakta|hal yang berubah|babak|scene|bagian)\b/i.test(question);
      if (isGeneric) {
        const fallbacks = [
          "Tapi bagaimana anomali sebesar ini bisa luput dari pantauan?",
          "Lalu, apa yang sebenarnya tersembunyi di balik data seismik tersebut?",
          "Di sinilah titik baliknya: apa yang memicu pelepasan energi sebesar itu?",
          "Pertanyaannya, seberapa besar ancaman yang sebenarnya sedang mengintai?",
          "Tapi benarkah kekuatan bencana ini bisa mengubah iklim bumi?",
          "Lalu, bagaimana fenomena ini bisa meledak tanpa peringatan?"
        ];
        question = fallbacks[index % fallbacks.length];
      } else {
        question = simplifyForLayAudience(question, 180).trim();
        if (!/[?]$/.test(question)) {
          question = `${question.replace(/[.!]+$/g, "")}?`;
        }
      }
      next.screenText = question;
      next.narration = question;
      next.reactionText = question;
    } else if (sceneType === "summary") {
      next.screenText = "Ringkasan Inti";
    } else {
      next.screenText = uniqueScreenText(next, index, input, usedScreen);
    }
    // Bucket posisi menjamin bab kontigu; labelnya diambil dari scene pembuka
    // bucket itu — pakai chapter dari AI bila spesifik, kalau tidak screenText.
    const section = audienceChapterName(index, sceneCount);
    if (!chapterTitles.has(section)) {
      // Kegenerikan diperiksa pada teks mentah: simplifyForLayAudience mengubah
      // "Analisis utama" menjadi "penjelasan utama" yang lolos dari filter.
      const raw = cleanText(scene?.chapter || "", 74).replace(/[.!?]+$/g, "").trim();
      const fromAi = isGenericStoryboardText(raw) ? "" : simplifyForLayAudience(raw, 74);
      // screenText scene reaction/summary bukan judul bab yang bermakna
      // ("Ringkasan Inti"), jadi bucket-nya memakai nama bagian.
      const own = sceneType === "image" ? next.screenText : section;
      const label = [fromAi, own, `${section} ${index + 1}`]
        .find((value) => value && !usedChapter.has(textKey(value)));
      usedChapter.add(textKey(label));
      chapterTitles.set(section, label);
    }
    next.chapter = chapterTitles.get(section);
    next.beatPurpose = uniqueBeatPurpose(index, sceneCount, sceneType, next, usedPurpose);

    if (Array.isArray(scene?.visualSegments)) {
      next.visualSegments = alignNarrativeContext(scene.visualSegments, next.narration);
    }

    // Spotlight ikut aturan yang sama dengan narrativeContext: kalau frasa
    // pemicunya tidak ada lagi di narasi final (diparafrase AI atau kalimatnya
    // dibuang dedupe), kartunya dibuang. Lebih baik tanpa kartu daripada kartu
    // yang muncul di detik yang salah.
    if (next.spotlight) {
      const tokens = matchTokens(next.spotlight.phrase);
      const match = bestPhraseMatch(matchTokens(next.narration), tokens);
      if (tokens.length < 2 || match.score < PHRASE_MIN_SCORE) next.spotlight = null;
    }

    return next;
  });

  if (droppedSentences) {
    console.log(`[Story] ${droppedSentences} kalimat berulang antar scene dibuang.`);
  }

  return polished;
}

function sentenceCount(value) {
  return (cleanText(value || "", 4000).match(/[^.!?]+[.!?]?/g) || []).filter((s) => cleanText(s, 4000)).length;
}

const PHRASE_WORDS = 5;
const PHRASE_MIN_SCORE = 0.6;

// Tokenisasi harus identik dengan normalizeMatchToken() di longform-render.js,
// karena skor yang dihitung di sini menentukan apakah render nanti berhasil
// mencocokkan frasa itu ke timeline kata caption.
function matchTokens(value) {
  return String(value || "")
    .split(/\s+/)
    .map((word) => word
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length > 1);
}

/**
 * Jendela seluncur yang sama seperti findPhraseTime() di longform-render.js.
 * @returns {{ score: number, start: number }} rasio token frasa yang muncul + posisi terbaik
 */
function bestPhraseMatch(narrationTokens, phraseTokens) {
  if (!phraseTokens.length || !narrationTokens.length) return { score: 0, start: 0 };
  const windowSize = Math.min(phraseTokens.length + 2, narrationTokens.length);
  const phraseSet = new Set(phraseTokens);
  let best = { score: 0, start: 0 };
  for (let start = 0; start < narrationTokens.length; start += 1) {
    const end = Math.min(start + windowSize, narrationTokens.length);
    const seen = new Set();
    for (let i = start; i < end; i += 1) {
      if (phraseSet.has(narrationTokens[i])) seen.add(narrationTokens[i]);
    }
    const score = seen.size / phraseTokens.length;
    if (score > best.score) best = { score, start };
    if (best.score === 1) break;
  }
  return best;
}

/**
 * Ambil potongan verbatim dari narasi final pada posisi proporsional segmen.
 * Melewati potongan yang tokennya sudah dipakai supaya dua segmen tidak
 * menunjuk momen yang sama.
 */
function sliceNarrationPhrase(words, index, total, used) {
  if (!words.length) return "";
  const span = Math.max(1, Math.floor(words.length / Math.max(1, total)));
  const base = Math.min(index * span, Math.max(0, words.length - PHRASE_WORDS));
  for (let offset = 0; offset <= span; offset += 1) {
    const from = Math.min(base + offset, Math.max(0, words.length - 1));
    const phrase = cleanText(words.slice(from, from + PHRASE_WORDS).join(" "), 200);
    const tokens = matchTokens(phrase);
    if (tokens.length >= 2 && !used.has(tokens.join(" "))) return phrase;
  }
  return cleanText(words.slice(base, base + PHRASE_WORDS).join(" "), 200);
}

/**
 * narrativeContext dipakai render untuk mengganti gambar TEPAT saat frasa itu
 * diucapkan. Kalau frasanya tidak ada di narasi final — AI memparafrase, atau
 * dedupeSentences membuang kalimat sumbernya — pencocokan gagal dan seluruh
 * scene jatuh ke pembagian rata, sehingga gambar berganti di tengah kalimat.
 * Frasa yang tidak cocok atau melompat ke belakang diganti potongan verbatim
 * narasi final pada posisi proporsional segmen itu.
 */
export function alignNarrativeContext(segments, narration) {
  const list = Array.isArray(segments) ? segments : [];
  const words = cleanText(narration || "", 4000).split(/\s+/).filter(Boolean);
  const narrationTokens = matchTokens(narration);
  const used = new Set();
  let cursor = 0;

  return list.map((segment, index) => {
    const phrase = simplifyForLayAudience(segment?.narrativeContext || "", 200);
    const tokens = matchTokens(phrase);
    const key = tokens.join(" ");
    const match = bestPhraseMatch(narrationTokens, tokens);
    const usable = tokens.length >= 2
      && !used.has(key)
      && match.score >= PHRASE_MIN_SCORE
      && match.start >= cursor;

    const next = usable ? phrase : sliceNarrationPhrase(words, index, list.length, used);
    const nextTokens = matchTokens(next);
    used.add(nextTokens.join(" "));
    // cursor wajib monoton: batas segmen yang melompat ke belakang membuat
    // computeSegmentDurations() menolak seluruh scene dan kembali ke pembagian rata.
    cursor = Math.max(cursor, usable ? match.start : bestPhraseMatch(narrationTokens, nextTokens).start);
    return { ...segment, narrativeContext: next };
  });
}

/**
 * Bab murni dari posisi scene, jadi urutannya selalu kontigu (maksimal 5 bab).
 * Reaction dan summary sengaja TIDAK dikecualikan: label khusus untuk keduanya
 * memecah satu bab menjadi beberapa entri berlabel sama di daftar bab YouTube.
 */
export function audienceChapterName(index, total) {
  const position = (index + 1) / Math.max(1, total);
  if (position <= 0.16) return CHAPTERS[0];
  if (position <= 0.42) return CHAPTERS[1];
  if (position <= 0.68) return CHAPTERS[2];
  if (position <= 0.88) return CHAPTERS[3];
  return CHAPTERS[4];
}

function uniqueScreenText(scene, index, input, used) {
  const raw = scene?.screenText || "";
  const fromNarration = headlineFromText(scene?.narration || "", input.topic || "", index);
  let candidate = simplifyForLayAudience(raw, 90).replace(/[.!?]+$/g, "").trim();

  if (!candidate || isGenericStoryboardText(candidate) || used.has(textKey(candidate))) {
    candidate = fromNarration;
  }

  if (!candidate || isGenericStoryboardText(candidate) || used.has(textKey(candidate))) {
    candidate = SCREEN_FALLBACKS[index % SCREEN_FALLBACKS.length];
  }

  if (used.has(textKey(candidate))) {
    candidate = `${candidate} ${index + 1}`;
  }

  candidate = cleanText(candidate, 74);
  used.add(textKey(candidate));
  return candidate;
}

function uniqueBeatPurpose(index, total, sceneType, scene, used) {
  const fallback = sceneType === "reaction"
    ? "Memberi jeda penasaran sebelum fakta berikutnya."
    : sceneType === "summary"
      ? PURPOSES[4]
      : PURPOSES[Math.min(PURPOSES.length - 1, Math.floor(((index + 1) / Math.max(1, total)) * PURPOSES.length))];
  let purpose = simplifyForLayAudience(scene?.beatPurpose || fallback, 180);

  if (!purpose || used.has(textKey(purpose))) {
    purpose = fallback;
  }
  if (used.has(textKey(purpose))) {
    purpose = `${fallback.replace(/[.!?]+$/g, "")} untuk scene ${index + 1}.`;
  }

  used.add(textKey(purpose));
  return purpose;
}

function uniqueTextList(values, limit, max) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = simplifyForLayAudience(value, max).replace(/[.!?]+$/g, "");
    const key = textKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(/[.!?]$/.test(text) ? text : `${text}.`);
    if (out.length >= limit) break;
  }
  return out.length ? out : ["Poin utama dibuat sederhana agar mudah dipahami."];
}

function headlineFromText(value, topic, index) {
  const source = simplifyForLayAudience(value || topic || "", 500)
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[()"]/g, "");
  const first = source.match(/^[^.!?]+/)?.[0] || source;
  const words = first
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9-]/g, ""))
    .filter((word) => word.length > 2 && !STOPWORDS.has(word.toLowerCase()));

  const picked = words.slice(0, 6);
  if (!picked.length) return SCREEN_FALLBACKS[index % SCREEN_FALLBACKS.length];
  return titleCase(cleanText(picked.join(" "), 74));
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function textFingerprint(value) {
  const words = cleanText(value, 500)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return [...new Set(words)].sort().join(" ");
}

function textKey(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function jaccard(a, b) {
  const left = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const right = new Set(String(b || "").split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}
