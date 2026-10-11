import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQueryCandidates,
  parseGoogleNewsXml,
  scrapeArticleContent,
  fetchNewsArticlesForTopic,
  enrichTrendNewsItems,
  resolveGoogleNewsUrl,
  isGoogleLogo,
  extractArticleImage
} from "../src/news-research.js";

test("buildQueryCandidates: membersihkan stopword dan kata hook YouTube", () => {
  const query = "Misteri Danau Toba Letusan Dahsyat Supervolcano Yang Pernah Mengubah Iklim Dunia";
  const candidates = buildQueryCandidates(query);

  assert.ok(candidates.length >= 2, "Harus menghasilkan minimal 2 kandidat pencarian bertahap");
  // Kandidat pertama membuang stopwords seperti "Misteri", "Dahsyat", "Yang", "Pernah"
  assert.equal(candidates[0], "Danau Toba Letusan Supervolcano Mengubah Iklim Dunia");
  // Entitas kunci 2 kata pertama tersedia
  assert.ok(candidates.includes("Danau Toba"));
  // Query asli utuh tetap ada sebagai fallback terakhir
  assert.ok(candidates.includes(query));
});

test("parseGoogleNewsXml: mengekstrak judul, sumber media, dan tanggal", () => {
  const sampleXml = `
    <rss version="2.0">
      <channel>
        <item>
          <title>Letusan Dahsyat Gunung Toba Purba - Kompas.com</title>
          <link>https://sains.kompas.com/read/123</link>
          <pubDate>Mon, 08 Sep 2026 12:00:00 GMT</pubDate>
          <source url="https://kompas.com">Kompas.com</source>
        </item>
        <item>
          <title>Dampak Letusan Toba Mengubah Iklim Bumi - CNN Indonesia</title>
          <link>https://cnnindonesia.com/teknologi/456</link>
          <pubDate>Tue, 09 Sep 2026 08:30:00 GMT</pubDate>
          <source url="https://cnnindonesia.com">CNN Indonesia</source>
        </item>
      </channel>
    </rss>
  `;

  const items = parseGoogleNewsXml(sampleXml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Letusan Dahsyat Gunung Toba Purba");
  assert.equal(items[0].outlet, "Kompas.com");
  assert.equal(items[0].day, "2026-09-08");
  assert.equal(items[1].outlet, "CNN Indonesia");
  assert.equal(items[1].day, "2026-09-09");
});

test("scrapeArticleContent: mengekstrak excerpt dan og:image dari HTML", async () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta property="og:image" content="https://asset.kompas.com/crop/toba.jpg" />
      </head>
      <body>
        <p>Letusan Gunung Toba yang terjadi sekitar 74.000 tahun yang lalu merupakan salah satu letusan supervolcano terbesar di muka bumi yang memicu musim dingin vulkanik berkepanjangan.</p>
      </body>
    </html>
  `;

  const mockFetch = async () => ({
    ok: true,
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => sampleHtml
  });

  const result = await scrapeArticleContent("https://kompas.com/test", { fetchImpl: mockFetch });
  assert.ok(result);
  assert.equal(result.imageUrl, "https://asset.kompas.com/crop/toba.jpg");
  assert.match(result.excerpt, /Letusan Gunung Toba yang terjadi/);
});

test("enrichTrendNewsItems: memperkaya item yang belum memiliki excerpt", async () => {
  const sampleHtml = `
    <html>
      <head><meta property="og:image" content="https://img.tempo.co/photo.jpg" /></head>
      <body><p>Riset terbaru mengungkap volume material abu vulkanik mencapai ribuan kilometer kubik.</p></body>
    </html>
  `;

  const mockFetch = async () => ({
    ok: true,
    headers: { get: () => "text/html" },
    text: async () => sampleHtml
  });

  const trend = {
    title: "Danau Toba",
    newsItems: [
      { headline: "Riset Toba", outlet: "Tempo.co", url: "https://tempo.co/1", excerpt: null, imageUrl: null },
      { headline: "Fakta Toba", outlet: "Kompas.com", url: "https://kompas.com/2", excerpt: "Sudah ada excerpt", imageUrl: "https://k.com/img.jpg" }
    ]
  };

  await enrichTrendNewsItems(trend, { fetchImpl: mockFetch });
  assert.match(trend.newsItems[0].excerpt, /Riset terbaru mengungkap volume/);
  assert.equal(trend.newsItems[0].imageUrl, "https://img.tempo.co/photo.jpg");
  // Item ke-2 yang sudah punya excerpt tidak tertimpa
  assert.equal(trend.newsItems[1].excerpt, "Sudah ada excerpt");
});

test("fetchNewsArticlesForTopic: menggunakan progressive fallback saat query pertama gagal", async () => {
  const sampleXml = `
    <rss version="2.0">
      <channel>
        <item>
          <title>Mengenal Kaldera Danau Toba - National Geographic</title>
          <link>https://natgeo.grid.id/toba</link>
          <pubDate>Wed, 10 Sep 2026 10:00:00 GMT</pubDate>
          <source>National Geographic</source>
        </item>
      </channel>
    </rss>
  `;

  const mockFetch = async (url) => {
    // Simulasi: query pertama (yang panjang/penuh) mengembalikan RSS kosong
    if (url.includes("Danau%20Toba%20Letusan%20Supervolcano%20Mengubah%20Iklim%20Dunia")) {
      return { ok: true, text: async () => "<rss><channel></channel></rss>" };
    }
    // Query kandidat kedua atau ketiga berhasil
    return { ok: true, text: async () => sampleXml };
  };

  const trendResult = await fetchNewsArticlesForTopic("Misteri Danau Toba Letusan Dahsyat Supervolcano Yang Pernah Mengubah Iklim Dunia", {
    fetchImpl: mockFetch
  });

  assert.ok(trendResult, "Harus menghasilkan objek trend dari kandidat berikutnya");
  assert.equal(trendResult.newsItems.length, 1);
  assert.equal(trendResult.newsItems[0].title, "Mengenal Kaldera Danau Toba");
});

test("isGoogleLogo: mendeteksi dan menolak URL logo/ikon Google News", () => {
  assert.equal(isGoogleLogo("https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300-rw"), true);
  assert.equal(isGoogleLogo("https://gstatic.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png"), true);
  assert.equal(isGoogleLogo("https://news.google.com/favicon.ico"), true);
  assert.equal(isGoogleLogo("https://sumbarsatu.com/assets/foto/berita/26/09/11211126601700394.jpg"), false);
  assert.equal(isGoogleLogo("https://asset.kompas.com/crops/123/danau-toba.jpg"), false);
});

test("resolveGoogleNewsUrl: memecahkan token Google News ke URL artikel asli penerbit", async () => {
  const fakeGnewsUrl = "https://news.google.com/rss/articles/CBMi12345";
  const fakePublisherUrl = "https://sumbarsatu.com/berita/danau-toba-festival";

  const mockFetch = async (url) => {
    if (url.includes("batchexecute")) {
      return {
        ok: true,
        text: async () => `)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"${fakePublisherUrl}\\",1]"]]`
      };
    }
    // Halaman redirect awal
    return {
      ok: true,
      text: async () => `<div data-n-a-id="CBMi12345" data-n-a-ts="1789182626" data-n-a-sg="Ae5Wzi-XFU-p5C0jEaImjyq90iO9"></div>`
    };
  };

  const resolved = await resolveGoogleNewsUrl(fakeGnewsUrl, { fetchImpl: mockFetch });
  assert.equal(resolved, fakePublisherUrl);

  // URL non-Google dikembalikan tanpa perubahan
  const directUrl = "https://detik.com/berita/123";
  assert.equal(await resolveGoogleNewsUrl(directUrl, { fetchImpl: mockFetch }), directUrl);
});

test("scrapeArticleContent: menolak og:image jika hanya berisi logo Google News", async () => {
  const gnewsHtml = `
    <html>
      <head>
        <meta property="og:image" content="https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300-rw" />
      </head>
      <body><p>Isi artikel berita pengujian Google News redirect.</p></body>
    </html>
  `;

  const mockFetch = async () => ({
    ok: true,
    headers: { get: () => "text/html" },
    text: async () => gnewsHtml
  });

  const res = await scrapeArticleContent("https://test.com/sample", { fetchImpl: mockFetch });
  assert.ok(res);
  assert.equal(res.imageUrl, null, "Logo Google News harus ditolak dan menghasilkan null");
});

test("extractArticleImage: mengekstrak gambar dari Schema.org JSON-LD dan lazy-loading data-src", () => {
  // 1. JSON-LD resolusi tinggi
  const jsonLdHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "headline": "Mobil Listrik Terbaru",
            "image": [
              "https://asset.kompas.com/crops/highres_1200.jpg"
            ]
          }
        </script>
      </head>
      <body><p>Isi berita</p></body>
    </html>
  `;
  assert.equal(extractArticleImage(jsonLdHtml), "https://asset.kompas.com/crops/highres_1200.jpg");

  // 2. Lead figure image dengan lazy loading data-src saat meta tags tidak ada
  const lazyLoadHtml = `
    <html>
      <body>
        <figure class="article-lead">
          <img data-src="https://img.tempo.co/danau_toba_lead.jpg" alt="Danau Toba" />
        </figure>
      </body>
    </html>
  `;
  assert.equal(extractArticleImage(lazyLoadHtml), "https://img.tempo.co/danau_toba_lead.jpg");
});


