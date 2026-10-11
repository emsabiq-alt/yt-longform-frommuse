/**
 * Primitif pencocokan frasa ke waktu ucapan.
 *
 * Dipakai dua konsumen: pergantian sub-visual (longform-render) dan penempatan
 * popup Spotlight. Dipisah ke modul sendiri supaya keduanya memakai tokenizer
 * yang persis sama — kalau berbeda, skor kecocokan di satu tempat tidak lagi
 * memprediksi keberhasilan di tempat lain.
 */

export function normalizeMatchToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function tokenizeMatchText(value) {
  return String(value || "")
    .split(/\s+/)
    .map(normalizeMatchToken)
    .filter((token) => token.length > 1);
}

/**
 * Timeline kata untuk pencocokan frasa. Kalau Whisper mengirim timestamp per
 * kata (timestamp_granularities word), waktunya dipakai apa adanya. Kalau tidak,
 * waktu kata diinterpolasi linear di dalam caption-nya.
 * @returns {{ token: string, time: number, end: number }[]}
 */
export function buildWordTimeline(captions) {
  const timeline = [];
  for (const cap of captions || []) {
    const start = Number(cap?.start ?? 0);
    const span = Number(cap?.end ?? 0) - start;
    const words = Array.isArray(cap?.words) ? cap.words : [];
    if (words.length) {
      for (const word of words) {
        const token = normalizeMatchToken(word?.word);
        if (!token) continue;
        const wordStart = Number(word.start);
        if (!Number.isFinite(wordStart)) continue;
        const wordEnd = Number(word.end);
        timeline.push({
          token,
          time: wordStart,
          end: Number.isFinite(wordEnd) && wordEnd >= wordStart ? wordEnd : wordStart
        });
      }
      continue;
    }
    const capWords = String(cap?.text || "").split(/\s+/).filter(Boolean);
    if (!capWords.length || !(span > 0)) continue;
    capWords.forEach((word, i) => {
      const token = normalizeMatchToken(word);
      if (!token) return;
      timeline.push({
        token,
        time: start + span * (i / capWords.length),
        end: start + span * ((i + 1) / capWords.length)
      });
    });
  }
  return timeline.sort((a, b) => a.time - b.time);
}

/**
 * Cari posisi frasa di timeline kata. Sliding window dengan skor overlap token
 * (urutan bebas di dalam window).
 * @returns {{ time: number, end: number, score: number } | null}
 */
export function findPhraseTime(wordTimeline, phraseTokens) {
  if (!phraseTokens.length || !wordTimeline.length) return null;
  const windowSize = Math.min(phraseTokens.length + 2, wordTimeline.length);
  const phraseSet = new Set(phraseTokens);
  let best = null;
  for (let start = 0; start + 1 <= wordTimeline.length; start += 1) {
    const end = Math.min(start + windowSize, wordTimeline.length);
    let matched = 0;
    let firstHit = -1;
    let lastHit = -1;
    const seen = new Set();
    for (let i = start; i < end; i += 1) {
      const token = wordTimeline[i].token;
      if (!phraseSet.has(token)) continue;
      if (firstHit < 0) firstHit = i;
      lastHit = i;
      if (!seen.has(token)) {
        matched += 1;
        seen.add(token);
      }
    }
    const score = matched / phraseTokens.length;
    if (score > 0 && (!best || score > best.score)) {
      // Waktu diambil dari kata pertama yang benar-benar cocok, bukan awal
      // window. Window lebih lebar dari frasanya, jadi memakai awal window
      // membuat kartu/pergantian gambar muncul sampai sedetik terlalu cepat.
      best = {
        time: wordTimeline[firstHit].time,
        end: wordTimeline[lastHit].end ?? wordTimeline[lastHit].time,
        score
      };
      if (score === 1) break;
    }
  }
  return best;
}
