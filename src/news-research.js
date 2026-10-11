/**
 * news-research.js
 * Grounding berita dan fakta otomatis untuk pipeline longform dan cron harian.
 *
 * Menggunakan progressive query resolver untuk menemukan artikel Google News
 * (baik isu tren hangat maupun arsip sejarah/sains/evergreen), mengekstrak
 * cuplikan isi teks (excerpt) dan foto (og:image) untuk dimasukkan ke storyboard
 * dan device mockup overlay.
 */

const STOPWORDS = new Set([
  "misteri", "rahasia", "kenapa", "mengapa", "bagaimana", "apa", "fakta",
  "dahsyat", "viral", "terbaru", "terkuak", "luar", "biasa", "heboh",
  "yang", "dan", "di", "ke", "dari", "untuk", "pada", "dengan", "ini", "itu",
  "pernah", "bisa", "akan", "telah", "sudah", "bikin", "membuat", "jadi", "saat",
  "adalah", "yaitu", "sebuah", "seorang", "para", "kaum", "tentang", "kala",
  "menurut", "hingga", "sampai", "oleh"
]);

export function buildQueryCandidates(rawQuery) {
  const q = String(rawQuery || "").trim().slice(0, 200);
  const words = q.split(/\s+/).filter(Boolean);
  const meaningful = words.filter(w => !STOPWORDS.has(w.toLowerCase().replace(/[^a-z0-9à-ÿ]/gi, "")));

  const candidates = [];
  // 1. Kata kunci esensial (tanpa kata filler/hook YouTube)
  if (meaningful.length >= 2) {
    candidates.push(meaningful.join(" "));
  }
  // 2. Jika panjang, ambil 3-4 kata entitas utama
  if (meaningful.length > 3) {
    candidates.push(meaningful.slice(0, 4).join(" "));
  }
  // 3. Pasangan 2 kata kunci pertama (misal "Danau Toba")
  if (meaningful.length >= 2) {
    candidates.push(meaningful.slice(0, 2).join(" "));
  }
  // 4. Query asli utuh
  candidates.push(q);

  return [...new Set(candidates.filter(c => c && c.length >= 3))];
}

function textTag(xml, tag) {
  return String(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

function detectSource(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function parseGoogleNewsXml(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const rawTitle = textTag(match[1], "title").replace(/ - [^-]{2,40}$/, "").trim();
    const url = textTag(match[1], "link");
    const publishedAt = textTag(match[1], "pubDate");
    const source = textTag(match[1], "source") || detectSource(url);
    const day = (() => { try { return new Date(publishedAt).toISOString().slice(0, 10); } catch { return ""; } })();
    return { title: rawTitle, headline: rawTitle, outlet: source, source, url, publishedAt, day };
  }).filter((it) => it.title && it.title.length > 8);
}

export function isGoogleLogo(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return false;
  const lower = imageUrl.toLowerCase();
  // Thumbnail hasil pencarian Google Images sah dan bukan logo
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

/**
 * Pecahkan redirect Google News RSS (news.google.com/rss/articles/...)
 * ke URL artikel penerbit berita aslinya via batch execute RPC Fbv4je.
 */
export async function resolveGoogleNewsUrl(googleNewsUrl, options = {}) {
  if (!googleNewsUrl || typeof googleNewsUrl !== "string") return googleNewsUrl;
  if (!googleNewsUrl.includes("news.google.com")) return googleNewsUrl;

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 8_000;

  try {
    const res = await fetchImpl(googleNewsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8"
      },
      signal: AbortSignal.timeout(timeoutMs),
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

      const rpcRes = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
        body: body.toString(),
        signal: AbortSignal.timeout(Math.min(6_000, timeoutMs))
      });
      if (rpcRes.ok) {
        const rpcText = await rpcRes.text();
        const match = rpcText.match(/garturlres[^\w]+(https?:\/\/[^\\"\s]+)/);
        if (match?.[1] && match[1].startsWith("http")) {
          return match[1];
        }
      }
    }

    // Fallback: cari direct external link di dalam page Google News
    const cLink = html.match(/<c-wiz[\s\S]*?<a[^>]+href=["'](https?:\/\/[^"']+)["']/i);
    if (cLink?.[1] && !cLink[1].includes("google.com")) {
      return cLink[1];
    }

    return googleNewsUrl;
  } catch {
    return googleNewsUrl;
  }
}

/**
 * Ekstrak foto berita beresolusi tinggi dengan strategi multi-tier:
 * 1. Schema.org JSON-LD (NewsArticle / Article / ImageObject) - resolusi tertinggi (1200px+)
 * 2. Meta tags (og:image, og:image:url, twitter:image, image_src)
 * 3. Lead image artikel (<figure> atau <article> dengan data-src / data-original / src)
 */
export function extractArticleImage(html, pageUrl = "") {
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
    } catch {
      // Abaikan error parse JSON
    }
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

  // 3. Lead image dari tag <figure> atau <article> (termasuk atribut lazy load)
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

export async function scrapeArticleContent(url, options = {}) {
  const timeoutMs = options.timeoutMs || 8_000;
  const fetchImpl = options.fetchImpl || fetch;
  try {
    // Selesaikan URL redirect Google News jika ada
    let targetUrl = url;
    if (typeof url === "string" && url.includes("news.google.com")) {
      targetUrl = await resolveGoogleNewsUrl(url, { fetchImpl, timeoutMs });
    }

    const res = await fetchImpl(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow"
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    const html = await res.text();

    // Ekstrak foto berita dengan multi-strategy
    const imageUrl = extractArticleImage(html, res.url || targetUrl);

    // Ekstrak isi teks artikel
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(nav|header|footer|aside|figure|figcaption|form|button|iframe|noscript|menu)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s{2,}/g, " ").trim();
    const excerpt = clean.length >= 80 ? clean.slice(0, 700).trim() : null;

    return { excerpt, imageUrl, resolvedUrl: targetUrl !== url ? targetUrl : null };
  } catch {
    return null;
  }
}

/**
 * Cari artikel berita dari Google News untuk topik tertentu secara progresif,
 * lalu scrape kutipan dan fotonya secara paralel.
 */
export async function fetchNewsArticlesForTopic(topic, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const maxArticles = options.maxArticles || 5;
  const candidates = buildQueryCandidates(topic);
  let rawItems = [];

  for (const queryStr of candidates) {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(queryStr)}&hl=id&gl=ID&ceid=ID%3Aid`;
      const rssRes = await fetchImpl(rssUrl, {
        headers: { "User-Agent": "yt-longform-studio/1.0" },
        signal: AbortSignal.timeout(8_000)
      });
      if (rssRes.ok) {
        const xml = await rssRes.text();
        const items = parseGoogleNewsXml(xml);
        if (items.length > 0) {
          rawItems = items;
          break;
        }
      }
    } catch (err) {
      // Coba kandidat berikutnya
    }
  }

  if (!rawItems.length) return null;

  const topItems = rawItems.slice(0, maxArticles);
  await Promise.allSettled(topItems.map(async (item) => {
    if (!item.url) return;
    const scraped = await scrapeArticleContent(item.url, { fetchImpl });
    item.excerpt = scraped?.excerpt || null;
    item.imageUrl = scraped?.imageUrl || null;
    if (scraped?.resolvedUrl) item.url = scraped.resolvedUrl;
  }));

  const uniqueOutlets = new Set(topItems.map(it => it.outlet || it.source).filter(Boolean));

  // Jika ada artikel yang belum memiliki foto, coba cari via Google Images API jika tersedia
  try {
    const { isGoogleImageApiAvailable, fetchGoogleImageUrl } = await import("./google-image.js");
    if (isGoogleImageApiAvailable()) {
      await Promise.allSettled(topItems.filter(it => !it.imageUrl).map(async (item) => {
        const query = `${item.outlet ? item.outlet + " " : ""}${item.headline || item.title}`;
        const found = await fetchGoogleImageUrl(query, { fetchImpl });
        if (found?.imageUrl) {
          item.imageUrl = found.imageUrl;
          console.log(`[NewsResearch] Google Images API: "${query.slice(0, 40)}" → ${item.imageUrl.slice(0, 60)}`);
        }
      }));
    }
  } catch {}

  return {
    title: topic,
    articles: topItems.length,
    sources: uniqueOutlets.size || 1,
    days: 1,
    newsItems: topItems
  };
}

/**
 * Perkaya objek trend yang sudah ada (misal dari pickSustainedTrendIdea)
 * dengan scraping excerpt dan imageUrl untuk beberapa artikel teratas.
 */
export async function enrichTrendNewsItems(trend, options = {}) {
  if (!trend || !Array.isArray(trend.newsItems) || !trend.newsItems.length) return;
  const maxItems = options.maxItems || 4;
  const fetchImpl = options.fetchImpl || fetch;

  const targets = trend.newsItems.slice(0, maxItems).filter(it => !it.excerpt && it.url);
  if (targets.length) {
    await Promise.allSettled(targets.map(async (item) => {
      const scraped = await scrapeArticleContent(item.url, { fetchImpl });
      if (scraped?.excerpt) item.excerpt = scraped.excerpt;
      if (scraped?.imageUrl && !item.imageUrl) item.imageUrl = scraped.imageUrl;
      if (scraped?.resolvedUrl) item.url = scraped.resolvedUrl;
    }));
  }

  // Jika masih ada target yang belum punya imageUrl, coba Google Images API
  try {
    const { isGoogleImageApiAvailable, fetchGoogleImageUrl } = await import("./google-image.js");
    if (isGoogleImageApiAvailable()) {
      const needImages = trend.newsItems.slice(0, maxItems).filter(it => !it.imageUrl);
      await Promise.allSettled(needImages.map(async (item) => {
        const query = `${item.outlet ? item.outlet + " " : ""}${item.headline || item.title}`;
        const found = await fetchGoogleImageUrl(query, { fetchImpl });
        if (found?.imageUrl) item.imageUrl = found.imageUrl;
      }));
    }
  } catch {}
}
