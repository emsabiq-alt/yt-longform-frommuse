const MEDIA = [
  "kompas.com", "detik.com", "cnnindonesia.com", "tempo.co",
  "antaranews.com", "liputan6.com", "tribunnews.com", "okezone.com",
  "sindonews.com", "republika.co.id"
];

const CRITERIA = { minimumArticles: 4, minimumSources: 2, minimumDays: 2 };

const STOPWORDS = new Set(`
yang dan atau dari untuk pada dalam dengan ini itu saat hari terbaru update indonesia
akan telah sudah pun juga bisa lebih lagi ada tak tidak bukan karena agar supaya
namun tetapi tapi meski meskipun hingga sampai oleh kepada tentang terhadap antara
setelah sebelum ketika sejak selama selain baik bahwa sebagai sebab akibat lalu
kemudian sehingga walaupun apakah bagaimana kenapa mengapa siapa mana mau harus
boleh perlu kita kamu anda dia mereka kami kalian di ke si sang para pak bu dr prof
thn th juta miliar ribu triliun persen tahun bulan minggu jam menit detik
senin selasa rabu kamis jumat sabtu minggu januari februari maret april mei juni
juli agustus september oktober november desember hari ini kemarin besok baru
lama pertama kedua ketiga keempat besar kecil tinggi rendah banyak sedikit
menurut kata ungkap ujar jelas sebut tutur terang akui klaim nilai rilis
kabar laporan berita info update terkini terbaru breaking eksklusif nasional
daerah lokal global internasional dunia indonesia wni wna negara pemerintah
presiden gubernur bupati walikota menteri wakil pusat daerah provinsi kabupaten kota
`.trim().split(/\s+/));

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: `Method ${req.method} tidak didukung.` });
  try {
    const pin = String(req.headers["x-dashboard-pin"] || "").trim();
    if (!process.env.AUTO_DASHBOARD_PIN || pin !== process.env.AUTO_DASHBOARD_PIN) {
      return res.status(process.env.AUTO_DASHBOARD_PIN ? 401 : 403).json({ error: "PIN dashboard tidak valid." });
    }

    const feeds = await Promise.allSettled(MEDIA.map(async (domain) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${domain} when:7d`)}&hl=id&gl=ID&ceid=ID%3Aid`;
      const response = await fetch(url, {
        headers: { "User-Agent": "yt-longform-studio/1.0" },
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
      return parseFeed(await response.text(), domain);
    }));

    const items = feeds.flatMap((r) => r.status === "fulfilled" ? r.value : []);
    const fetchedSources = feeds.filter(r => r.status === "fulfilled").length;
    if (!items.length) throw new Error("Semua feed gagal diambil");

    const rawTopics = findTopics(items);
    const topics = await aiDedup(rawTopics);

    // Scrape kutipan isi artikel untuk top topics (max 3 artikel per topik)
    await Promise.allSettled(
      topics.slice(0, 8).flatMap((topic) =>
        topic.newsItems.slice(0, 3).map(async (item) => {
          if (!item.url) return;
          const sc = await scrapeArticleFull(item.url);
          item.excerpt = sc?.excerpt || null;
          item.imageUrl = sc?.imageUrl || null;
          if (sc?.resolvedUrl) item.url = sc.resolvedUrl;
        })
      )
    );

    res.status(200).json({
      fetchedAt: new Date().toISOString(),
      criteria: CRITERIA,
      media: MEDIA,
      fetchedSources,
      topics
    });
  } catch (error) {
    console.error("[api/trends]", error);
    res.status(502).json({ error: "Gagal mengambil tren berita." });
  }
}

function isGoogleLogo(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return false;
  const lower = imageUrl.toLowerCase();
  if (lower.includes("encrypted-tbn0.gstatic.com/images?q=tbn:")) return false;
  return (
    lower.includes("googleusercontent.com") ||
    lower.includes("gstatic.com") ||
    lower.includes("google.com") ||
    lower.includes("google_news") ||
    lower.includes("googlenews") ||
    lower.includes("favicon") ||
    lower.includes("logo_google") ||
    lower.includes("default_news")
  );
}

async function resolveGoogleNewsUrl(googleNewsUrl) {
  if (!googleNewsUrl || typeof googleNewsUrl !== "string") return googleNewsUrl;
  if (!googleNewsUrl.includes("news.google.com")) return googleNewsUrl;
  try {
    const res = await fetch(googleNewsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
      },
      signal: AbortSignal.timeout(8_000),
      redirect: "follow"
    });
    if (!res.ok) return googleNewsUrl;
    const html = await res.text();

    const token = html.match(/data-n-a-id=["']([^"']+)["']/)?.[1]
      || googleNewsUrl.match(/\/articles\/([A-Za-z0-9_-]+)/)?.[1];
    const ts = html.match(/data-n-a-ts=["']([^"']+)["']/)?.[1];
    const sg = html.match(/data-n-a-sg=["']([^"']+)["']/)?.[1];

    if (token && ts && sg) {
      const innerPayload = JSON.stringify([
        "garturlreq",
        [["en-US", "US", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "US:en", null, 180, null, null, null, null, null, 0, null, null, [1608, 16, 122, 556, 241, 251, 967]], "en-US", "US", 1, [2, 3, 4, 8], 1, 0, "655000234", 0, 0, null, 0],
        token,
        Number(ts),
        sg
      ]);
      const fReq = JSON.stringify([[["Fbv4je", innerPayload, null, "generic"]]]);
      const body = new URLSearchParams();
      body.append("f.req", fReq);

      const rpcRes = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
        body: body.toString(),
        signal: AbortSignal.timeout(6_000)
      });
      if (rpcRes.ok) {
        const rpcText = await rpcRes.text();
        const match = rpcText.match(/garturlres[^\w]+(https?:\/\/[^\\"\s]+)/);
        if (match?.[1] && match[1].startsWith("http")) {
          return match[1];
        }
      }
    }

    const cLink = html.match(/<c-wiz[\s\S]*?<a[^>]+href=["'](https?:\/\/[^"']+)["']/i);
    if (cLink?.[1] && !cLink[1].includes("google.com")) {
      return cLink[1];
    }

    return googleNewsUrl;
  } catch {
    return googleNewsUrl;
  }
}

function extractArticleImage(html, pageUrl = "") {
  if (!html || typeof html !== "string") return null;

  // 1. JSON-LD Schema.org
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const jm of jsonLdMatches) {
    try {
      const data = JSON.parse(jm[1].trim());
      const findImg = (obj) => {
        if (!obj) return null;
        if (typeof obj.image === "string" && obj.image.startsWith("http")) return obj.image;
        if (Array.isArray(obj.image)) {
          const first = obj.image.find((img) => typeof img === "string" && img.startsWith("http"));
          if (first) return first;
          const objWithUrl = obj.image.find((img) => img?.url && typeof img.url === "string");
          if (objWithUrl?.url) return objWithUrl.url;
        }
        if (obj.image?.url && typeof obj.image.url === "string") return obj.image.url;
        if (Array.isArray(obj["@graph"])) {
          for (const g of obj["@graph"]) {
            const r = findImg(g);
            if (r) return r;
          }
        }
        return null;
      };
      const img = findImg(data);
      if (img && !isGoogleLogo(img)) {
        const cleaned = cleanImageUrl(img, pageUrl);
        if (cleaned) return cleaned;
      }
    } catch {}
  }

  // 2. Open Graph, Twitter Card, dan image_src
  const metaRegexes = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:url|og:image:secure_url)["']/i,
    /<meta[^>]+(?:property|name)=["'](?:twitter:image|twitter:image:src)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:twitter:image|twitter:image:src)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i
  ];
  for (const regex of metaRegexes) {
    const match = html.match(regex);
    if (match?.[1]) {
      const cleaned = cleanImageUrl(match[1], pageUrl);
      if (cleaned && !isGoogleLogo(cleaned)) return cleaned;
    }
  }

  // 3. Lead image dari tag <figure> atau <article>
  const bodyRegexes = [
    /<figure[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-original|data-highres|src)=["']([^"']+)["']/i,
    /<article[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-original|data-highres|src)=["']([^"']+)["']/i,
    /<div[^>]+class=["'][^"']*(?:lead-image|featured-image|post-thumbnail|detail__media)[^"']*["'][\s\S]*?<img[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/i
  ];
  for (const regex of bodyRegexes) {
    const match = html.match(regex);
    if (match?.[1]) {
      const cleaned = cleanImageUrl(match[1], pageUrl);
      if (cleaned && !isGoogleLogo(cleaned)) return cleaned;
    }
  }

  return null;
}

function cleanImageUrl(rawUrl, baseUrl = "") {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let imgUrl = rawUrl.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  if (imgUrl.startsWith("//")) imgUrl = `https:${imgUrl}`;
  if (!imgUrl.startsWith("http") && baseUrl) {
    try { imgUrl = new URL(imgUrl, baseUrl).href; } catch { return null; }
  }
  return imgUrl.startsWith("http") ? imgUrl : null;
}

async function scrapeArticleFull(url) {
  try {
    let targetUrl = url;
    if (typeof url === "string" && url.includes("news.google.com")) {
      targetUrl = await resolveGoogleNewsUrl(url);
    }

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      signal: AbortSignal.timeout(8_000),
      redirect: "follow"
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = await res.text();

    // Ekstrak foto berita dengan multi-strategy
    const imageUrl = extractArticleImage(html, res.url || targetUrl);

    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|header|footer|aside|figure|figcaption|form|button|iframe|noscript|menu)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ").trim();

    if (clean.length < 100) return null;
    return { excerpt: clean.slice(0, 700).trim(), imageUrl, resolvedUrl: targetUrl !== url ? targetUrl : null };
  } catch {
    return null;
  }
}

function text(xml, tag) {
  return String(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

function parseFeed(xml, source) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const publishedAt = text(match[1], "pubDate");
    const rawTitle = text(match[1], "title");
    // Hapus suffix sumber "- NamaMedia" di akhir judul Google News
    const title = rawTitle.replace(/ - [^-]{2,40}$/, "").trim();
    const url = text(match[1], "link");
    const day = (() => { try { return new Date(publishedAt).toISOString().slice(0, 10); } catch { return ""; } })();
    return { title, source, url, publishedAt, day };
  }).filter((it) => it.title && it.day && it.title.length > 10);
}

function tokenize(title) {
  return title
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diakritik
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function findTopics(items) {
  const phrases = new Map();

  for (const item of items) {
    const words = tokenize(item.title);
    // n-gram 2–4 kata
    for (let len = 2; len <= 4; len++) {
      for (let start = 0; start <= words.length - len; start++) {
        const phrase = words.slice(start, start + len).join(" ");
        if (!phrases.has(phrase)) phrases.set(phrase, []);
        phrases.get(phrase).push(item);
      }
    }
  }

  // Hitung statistik per frasa
  let candidates = [...phrases].map(([phrase, matches]) => {
    const uniq = [...new Map(matches.map((it) => [it.title, it])).values()];
    const sources = new Set(uniq.map((it) => it.source));
    const days = new Set(uniq.map((it) => it.day));
    return {
      phrase,
      title: toTitleCase(phrase),
      articles: uniq.length,
      sources: sources.size,
      days: days.size,
      newsItems: uniq.slice(0, 12)
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    };
  });

  // Filter kriteria minimum
  candidates = candidates.filter(
    (c) => c.articles >= CRITERIA.minimumArticles
      && c.sources >= CRITERIA.minimumSources
      && c.days >= CRITERIA.minimumDays
  );

  // Skor: bobot hari > sumber > artikel (tren bertahan lebih penting dari viral sesaat)
  candidates.forEach((c) => {
    c.score = c.days * 10 + c.sources * 5 + Math.log(c.articles + 1) * 3;
  });

  // Sort descending score
  candidates.sort((a, b) => b.score - a.score);

  // Hapus sub-frasa: jika "A B" sudah ada di phrase "A B C" yang skornya lebih tinggi, hapus "A B"
  const kept = [];
  for (const cand of candidates) {
    const isSubsumed = kept.some(
      (k) => k.score >= cand.score * 0.85 && k.phrase.includes(cand.phrase) && k.phrase !== cand.phrase
    );
    if (!isSubsumed) kept.push(cand);
    if (kept.length >= 30) break;
  }

  // Diversifikasi: jangan terlalu banyak dari cluster kata yang sama (max 3 per kata dominan)
  const wordCount = new Map();
  const diverse = [];
  for (const cand of kept) {
    const words = cand.phrase.split(" ");
    const dominant = words[0]; // kata pertama sebagai cluster key
    const count = wordCount.get(dominant) || 0;
    if (count >= 3) continue;
    wordCount.set(dominant, count + 1);
    diverse.push(cand);
    if (diverse.length >= 20) break;
  }

  return diverse;
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Deduplikasi topik menggunakan OpenAI:
 * - Kelompokkan topik yang membahas kejadian yang sama
 * - Pilih 1 wakil terbaik per kelompok
 * - Kembalikan maks 10 topik yang benar-benar berbeda cerita
 * Jika OPENAI_API_KEY tidak ada atau request gagal, kembalikan input asli.
 */
async function aiDedup(topics) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || topics.length <= 3) return topics;

  try {
    const list = topics.map((t, i) => `${i + 1}. ${t.title} (${t.articles} artikel, ${t.sources} sumber)`).join("\n");
    const prompt = [
      "Berikut adalah daftar topik berita Indonesia yang ditemukan dari RSS media nasional.",
      "Tugas kamu: kelompokkan topik yang MEMBAHAS CERITA/KEJADIAN YANG SAMA (bukan hanya kata yang mirip).",
      "Dari setiap kelompok, pilih 1 topik yang paling informatif dan spesifik sebagai wakil.",
      "Kembalikan HANYA nomor topik yang terpilih (satu per kelompok), maksimal 10 nomor, dipisah koma.",
      "Jangan tambahkan teks lain selain angka yang dipisah koma. Contoh: 1,3,7,12",
      "",
      "Daftar topik:",
      list
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 80,
        temperature: 0
      }),
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || "";
    const indices = raw.split(/[,\s]+/)
      .map((s) => parseInt(s, 10) - 1)
      .filter((n) => Number.isFinite(n) && n >= 0 && n < topics.length);

    if (indices.length < 3) return topics; // fallback jika output AI tidak valid
    return indices.map((i) => topics[i]);
  } catch (e) {
    console.warn("[trends] aiDedup gagal, pakai hasil mentah:", e.message);
    return topics;
  }
}
