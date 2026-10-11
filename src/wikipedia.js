/**
 * Wikipedia fact fetcher — grounding fakta GRATIS (tanpa API key) untuk naskah.
 *
 * Alur: topik/judul (sering berupa pertanyaan)
 *   1. bersihkan jadi query + ambil kata inti (content words),
 *   2. kumpulkan kandidat artikel dari opensearch (cocok judul) + search (full-text),
 *   3. SARING berdasar relevansi: judul wajib berbagi minimal satu kata inti dengan
 *      topik (mencegah "madu" nyangkut ke artikel kue), lalu ambil ringkasannya,
 *   4. kembalikan ekstrak fakta + sumber untuk atribusi deskripsi.
 *
 * Sifatnya OPSIONAL & graceful: bila tidak ada artikel relevan, jaringan gagal,
 * atau dimatikan lewat config, fungsi mengembalikan null dan pipeline lanjut
 * seperti biasa (model menulis kreatif tanpa grounding). Lebih baik melewati
 * grounding daripada menyuntik fakta yang salah.
 *
 * Tidak butuh API key. Yang wajib hanya header User-Agent deskriptif (kebijakan
 * Wikimedia). Konten Wikipedia berlisensi CC BY-SA sehingga sumbernya wajib
 * dicantumkan di deskripsi video.
 */

import { config } from "./config.js";
import { cleanText } from "./util.js";

// Kata tanya / pengisi di awal pertanyaan Indonesia yang menambah noise saat search.
const QUESTION_PREFIX = /^(kenapa|mengapa|bagaimana|apakah|adakah|benarkah|apa|kapan|siapa|di\s*mana|dimana|kah)\b[\s,]*/i;

// Kata umum + kata pembingkai pertanyaan yang TIDAK menunjuk subjek artikel.
// Membuang kata pembingkai ("asal-usul", "manfaat", "ditemukan") penting agar
// subjek konkret (madu, kompas, angka) yang memimpin pencarian, bukan framing.
const STOPWORDS = new Set([
  // penghubung & fungsi
  "yang", "dan", "di", "ke", "dari", "untuk", "pada", "atau", "ini", "itu",
  "tidak", "pernah", "bisa", "adalah", "apa", "kenapa", "mengapa", "bagaimana",
  "dengan", "tanpa", "juga", "akan", "masih", "sudah", "saat", "ketika", "kah",
  "karena", "agar", "supaya", "meski", "walau", "hingga", "sampai", "sebuah",
  "suatu", "para", "lebih", "paling", "sangat", "banyak", "semua", "hanya",
  "saja", "oleh", "dalam", "kita", "kami", "mereka", "dia", "nya",
  "antara", "tentang", "secara", "selalu", "namun", "tetapi", "tapi", "dulu",
  "daripada", "seperti", "bukan", "boleh", "harus", "punya", "milik", "buah",
  // pembingkai pertanyaan / klise konten
  "asal", "usul", "rahasia", "misteri", "fakta", "sebenarnya", "ternyata",
  "manfaat", "alasan", "sebab", "akibat", "dampak", "proses", "cara", "kisah",
  "cerita", "ribuan", "jutaan", "ratusan", "tahun", "tahunan", "ditemukan",
  "menemukan", "membuat", "terjadi", "disimpan", "butuh", "sehari", "hari",
  "setiap", "tahu", "mengubah", "berabad", "abad", "tengah", "sejarah",
  "penjelasan", "pengertian", "jenis", "macam", "contoh"
]);

/**
 * Bersihkan topik (sering berupa pertanyaan panjang) menjadi query pencarian
 * yang lebih bersih. Diekspor untuk keperluan unit test.
 */
export function buildSearchQuery(topic) {
  let q = cleanText(topic, 200);
  for (let i = 0; i < 3; i++) {
    const next = q.replace(QUESTION_PREFIX, "").trim();
    if (next === q) break;
    q = next;
  }
  q = q.replace(/\?+\s*$/g, "").trim();
  return cleanText(q, 160) || cleanText(topic, 160);
}

/** Token kata inti (>=4 huruf, bukan stopword) untuk uji relevansi judul. */
export function contentWords(text) {
  return cleanText(text, 200)
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/** Judul dianggap relevan bila berbagi minimal satu kata inti dengan topik. */
function overlapScore(title, topicWords) {
  const titleWords = new Set(contentWords(title));
  let score = 0;
  for (const w of topicWords) if (titleWords.has(w)) score += 1;
  return score;
}

function wikiHost(lang) {
  const safe = String(lang || "id").toLowerCase().replace(/[^a-z-]/g, "") || "id";
  return `https://${safe}.wikipedia.org`;
}

async function wikiFetch(url, userAgent, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Opensearch = pencocokan JUDUL (typeahead). Akurat untuk menemukan artikel subjek.
async function openSearch(query, ctx) {
  if (!query) return [];
  const url = `${ctx.host}/w/api.php?action=opensearch&format=json&limit=5&namespace=0`
    + `&search=${encodeURIComponent(query)}`;
  const data = await wikiFetch(url, ctx.userAgent, ctx.timeoutMs);
  return Array.isArray(data?.[1]) ? data[1].filter(Boolean) : [];
}

// Full-text search = cadangan bila judul tidak langsung cocok.
async function fullTextSearch(query, ctx) {
  const url = `${ctx.host}/w/api.php?action=query&list=search&format=json`
    + `&srsearch=${encodeURIComponent(query)}&srlimit=8&srprop=`;
  const data = await wikiFetch(url, ctx.userAgent, ctx.timeoutMs);
  const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
  return hits.map((hit) => hit?.title).filter(Boolean);
}

async function fetchSummary(title, ctx) {
  const url = `${ctx.host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const data = await wikiFetch(url, ctx.userAgent, ctx.timeoutMs);
  if (data?.type === "disambiguation") return null; // halaman disambiguasi tak berguna
  const extract = cleanText(data?.extract || "", 1200);
  if (extract.length < 60) return null;
  const canonicalTitle = cleanText(data?.title || title, 160);
  const pageUrl = data?.content_urls?.desktop?.page
    || `${ctx.host}/wiki/${encodeURIComponent(canonicalTitle.replace(/\s+/g, "_"))}`;
  return { title: canonicalTitle, extract, url: pageUrl };
}

/**
 * Isi artikel penuh (bukan hanya paragraf pembuka).
 *
 * `/page/summary/` hanya mengembalikan lead paragraph, sementara naskah diminta
 * berisi angka, tahun, dan nama di 10+ scene — bagian padat data ("Efek Osmotik",
 * "Metilglioksal") tidak pernah sampai ke prompt. Endpoint summary TETAP dipakai
 * untuk judul kanonik, URL, dan penyaring disambiguasi; extracts hanya menambah
 * badan teks. Judul section dipertahankan sebagai label pendek supaya model tahu
 * fakta itu berasal dari bagian mana.
 */
/**
 * Rapikan teks `prop=extracts`: heading wiki jadi label pendek, section
 * administratif dibuang. Diekspor untuk unit test tanpa jaringan.
 */
export function cleanExtractText(raw, maxChars = 4000) {
  return cleanText(
    String(raw || "")
      // "== Efek Osmotik ==" → "Efek Osmotik:"; subsection (===) jadi kalimat biasa.
      .replace(/^={3,}\s*(.+?)\s*={3,}$/gm, "$1.")
      .replace(/^==\s*(.+?)\s*==$/gm, "\n$1:")
      // Section administratif tidak memuat fakta yang bisa dinarasikan.
      .replace(/\n(Lihat pula|Referensi|Pranala luar|Bacaan lanjutan|Catatan|Daftar isi|See also|References|External links|Further reading|Notes):[\s\S]*$/i, ""),
    maxChars
  );
}

async function fetchExtract(title, ctx, maxChars) {
  const url = `${ctx.host}/w/api.php?action=query&format=json&prop=extracts&explaintext=1`
    + `&redirects=1&titles=${encodeURIComponent(title)}`;
  const data = await wikiFetch(url, ctx.userAgent, ctx.timeoutMs);
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return "";
  return cleanExtractText(page.extract, maxChars);
}

/**
 * Kumpulkan kandidat judul lalu saring berdasar relevansi ke SUBJEK topik.
 * Subjek = kata-kata inti terdepan. Opensearch difokuskan ke subjek (cocok judul),
 * full-text sebagai cadangan. Judul hanya lolos bila mengandung kata-subjek
 * pertama ATAU berbagi minimal dua kata inti — mencegah nyangkut ke artikel
 * yang cuma kebetulan memuat satu kata pembingkai.
 */
async function relevantTitles(query, topicWords, ctx) {
  const lead = topicWords[0];
  const pair = topicWords.slice(0, 2).join(" ");
  const topicSet = new Set(topicWords);
  const [openPair, openLead, textHits] = await Promise.all([
    pair ? openSearch(pair, ctx).catch(() => []) : Promise.resolve([]),
    lead ? openSearch(lead, ctx).catch(() => []) : Promise.resolve([]),
    fullTextSearch(query, ctx).catch(() => [])
  ]);

  const ordered = [];
  const seen = new Set();
  // Opensearch (cocok judul) diutamakan, lalu full-text.
  [...openPair, ...openLead, ...textHits].forEach((title) => {
    const key = title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const titleWords = contentWords(title);
    // Presisi: SEMUA kata inti judul harus termuat di topik (title ⊆ topik).
    // Artikel yang lebih luas/lain (desa, koran, sense berbeda) otomatis gugur.
    if (!titleWords.length || !titleWords.every((w) => topicSet.has(w))) return;
    const score = titleWords.length;            // makin banyak kata cocok = makin spesifik
    const matchesLead = lead ? titleWords.includes(lead) : false;
    const parenPenalty = /\(/.test(title) ? 1 : 0; // utamakan judul tanpa "(disambiguasi)"
    ordered.push({ title, score, matchesLead, parenPenalty });
  });

  return ordered
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) =>
      (b.score - a.score)
      || (Number(b.matchesLead) - Number(a.matchesLead))
      || (a.parenPenalty - b.parenPenalty)
      || (a.index - b.index))
    .map((entry) => entry.title);
}

/**
 * Ambil fakta Wikipedia untuk sebuah topik.
 * @param {string} topic - Topik/judul (boleh berupa pertanyaan).
 * @param {object} [options] - { lang } untuk override bahasa.
 * @returns {Promise<null | { used: true, lang: string, query: string, facts: string, sources: Array<{title:string,url:string}> }>}
 */
export async function fetchWikipediaFacts(topic, options = {}) {
  const wiki = config.wikipedia || {};
  if (!wiki.enabled) return null;

  const cleanTopic = cleanText(topic || "", 240);
  if (cleanTopic.length < 5) return null;

  const lang = options.lang || wiki.lang || "id";
  const ctx = {
    host: wikiHost(lang),
    userAgent: wiki.userAgent || "yt-longform-studio/1.0",
    timeoutMs: wiki.timeoutMs || 8000
  };
  const maxArticles = wiki.maxArticles || 2;
  const maxChars = wiki.maxChars || 1800;
  const query = buildSearchQuery(cleanTopic);
  const topicWords = contentWords(cleanTopic);
  if (!topicWords.length) return null;

  try {
    const titles = await relevantTitles(query, topicWords, ctx);
    if (!titles.length) return null;

    // Anggaran dibagi rata hanya sebanyak artikel yang benar-benar tersedia,
    // supaya topik dengan satu artikel relevan tidak dipotong separuh.
    const perArticleChars = Math.max(
      600,
      Math.floor(maxChars / Math.min(maxArticles, titles.length)) - 40
    );

    const sources = [];
    const blocks = [];
    for (const title of titles) {
      if (blocks.length >= maxArticles) break;
      let summary;
      try {
        summary = await fetchSummary(title, ctx);
      } catch {
        continue; // satu artikel gagal jangan menggagalkan keseluruhan
      }
      if (!summary) continue;
      // Pastikan ringkasan tetap relevan (judul kanonik bisa berbeda dari kandidat).
      if (overlapScore(summary.title, topicWords) === 0
        && overlapScore(summary.extract, topicWords) === 0) continue;
      // Badan artikel bersifat tambahan: kegagalan extracts tidak boleh
      // menghilangkan grounding yang sudah didapat dari summary.
      let body = "";
      try {
        body = await fetchExtract(summary.title, ctx, perArticleChars);
      } catch {
        body = "";
      }
      blocks.push(`• ${summary.title}: ${body.length > summary.extract.length ? body : summary.extract}`);
      sources.push({ title: summary.title, url: summary.url });
    }
    if (!blocks.length) return null;

    const facts = cleanText(blocks.join("  "), maxChars);
    return { used: true, lang, query, facts, sources };
  } catch (error) {
    console.warn(`[Wikipedia] Gagal ambil fakta untuk "${query}": ${error.message}`);
    return null;
  }
}
