// ponytail: RSS publik hanya memberi headline terkini; simpan arsip harian bila kelak perlu mengukur tren bulanan.
const FEED_BASE = "https://news.google.com/rss";
export const SUSTAINED_NEWS_MEDIA = [
  "kompas.com", "detik.com", "cnnindonesia.com", "tempo.co", "antaranews.com", "liputan6.com"
];
export const SUSTAINED_NEWS_CRITERIA = { minimumArticles: 5, minimumSources: 3, minimumDays: 3 };
const FEED_URLS = SUSTAINED_NEWS_MEDIA.map((domain) =>
  `${FEED_BASE}/search?q=${encodeURIComponent(`site:${domain} when:7d`)}&hl=id&gl=ID&ceid=ID%3Aid`
);

const STOP_WORDS = new Set([
  "yang", "dan", "atau", "dari", "untuk", "pada", "dalam", "dengan", "di", "ke", "ini", "itu", "saat", "kini",
  "hari", "terbaru", "update", "akibat", "soal", "jadi", "akan", "telah", "masih", "kembali", "indonesia",
  "karena", "sebagai", "oleh", "tentang", "setelah", "hingga", "warga", "waspada", "resmi", "begini", "berikut",
  "januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"
]);
// ponytail: daftar kecil ini hanya membuang idiom headline; ganti dengan clustering entitas jika false-positive makin beragam.
const GENERIC_HEADLINE_PHRASES = new Set(["buka suara", "cara cek", "rp triliun", "rp jutaan"]);

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => String.fromCodePoint(
      code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10)
    ))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tag(xml, name) {
  return decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

function normalizedWords(title) {
  return title.toLowerCase().replace(/[^a-z0-9à-ÿ ]/g, " ").split(/\s+/)
    .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !STOP_WORDS.has(word));
}

function titleCase(value) {
  return value.split(" ").map((word) => word.length <= 2 ? word.toUpperCase() :
    word.replace(/^\p{L}/u, (letter) => letter.toUpperCase())).join(" ");
}

export function parseGoogleNewsRss(xml = "") {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const publishedAt = tag(item, "pubDate");
    const titleParts = tag(item, "title").split(" - ");
    if (titleParts.length > 1) titleParts.pop();
    if (/\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(titleParts.at(-1) || "")) titleParts.pop();
    return {
      title: titleParts.join(" - "),
      source: tag(item, "source") || "Media Nasional",
      url: tag(item, "link"),
      publishedAt,
      day: Number.isNaN(Date.parse(publishedAt)) ? "" : new Date(publishedAt).toISOString().slice(0, 10)
    };
  }).filter((item) => item.title && item.day);
}

export function findSustainedNewsTopics(items = [], options = {}) {
  const minimumArticles = options.minimumArticles || SUSTAINED_NEWS_CRITERIA.minimumArticles;
  const minimumSources = options.minimumSources || SUSTAINED_NEWS_CRITERIA.minimumSources;
  const minimumDays = options.minimumDays || SUSTAINED_NEWS_CRITERIA.minimumDays;
  const phrases = new Map();

  for (const item of items) {
    const words = normalizedWords(item.title);
    for (let length = 2; length <= 4; length++) {
      for (let start = 0; start <= words.length - length; start++) {
        const phrase = words.slice(start, start + length).join(" ");
        const matches = phrases.get(phrase) || [];
        matches.push(item);
        phrases.set(phrase, matches);
      }
    }
  }

  const candidates = [...phrases].map(([phrase, matches]) => {
    const unique = [...new Map(matches.map((item) => [item.title, item])).values()];
    const sources = new Set(unique.map((item) => item.source));
    const days = new Set(unique.map((item) => item.day));
    return {
      phrase,
      title: titleCase(phrase),
      articles: unique.length,
      sources: sources.size,
      days: days.size,
      publishedAt: unique.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]?.publishedAt || "",
      newsTitle: unique[0]?.title || "",
      newsSource: unique[0]?.source || "",
      newsUrl: unique[0]?.url || "",
      newsItems: unique.slice(0, 12)
    };
  }).filter((topic) => !GENERIC_HEADLINE_PHRASES.has(topic.phrase) &&
    topic.articles >= minimumArticles && topic.sources >= minimumSources && topic.days >= minimumDays);

  for (const topic of candidates) {
    const longer = candidates
      .filter((other) => other.phrase !== topic.phrase && ` ${other.phrase} `.includes(` ${topic.phrase} `))
      .filter((other) => other.days >= topic.days && other.sources >= topic.sources * 0.5 && other.articles >= topic.articles * 0.35)
      .sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length)[0];
    if (longer) topic.canonicalPhrase = longer.phrase;
  }

  return candidates
    .filter((topic) => !topic.canonicalPhrase)
    .sort((a, b) => (b.articles * 100 + b.days * 10 + b.sources) -
      (a.articles * 100 + a.days * 10 + a.sources));
}

export async function fetchSustainedNewsTopics(fetchImpl = fetch) {
  const results = await Promise.allSettled(FEED_URLS.map(async (url) => {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "yt-longform-studio/1.0" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
    const domain = new URL(url).searchParams.get("q").split(" ")[0].slice(5);
    return parseGoogleNewsRss(await response.text()).map((item) => ({ ...item, source: domain }));
  }));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!items.length) throw new Error("semua feed Google News gagal");
  return findSustainedNewsTopics(items);
}

export async function fetchTopSustainedNewsTopic(fetchImpl = fetch) {
  return (await fetchSustainedNewsTopics(fetchImpl))[0] || null;
}