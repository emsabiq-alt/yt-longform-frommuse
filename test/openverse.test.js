import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOpenverseResults, personNameCandidates, fetchOpenverseImageForScene, searchOpenverseImages } from "../src/openverse.js";
import { looksLikePersonName, findPersonImage } from "../src/wikidata.js";
import { buildMediaAttributionBlock } from "../src/youtube-meta.js";

function openverseEntry(overrides = {}) {
  return {
    id: "abc-123",
    title: "Avicenna manuscript",
    url: "https://live.staticflickr.com/photo.jpg",
    thumbnail: "https://api.openverse.org/thumb.jpg",
    foreign_landing_url: "https://flickr.com/photos/1",
    creator: "Wellcome Collection",
    license: "by",
    license_version: "4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    provider: "flickr",
    source: "flickr",
    filetype: "jpg",
    filesize: 400_000,
    tags: [{ name: "avicenna" }, { name: "manuscript" }],
    width: 1920,
    height: 1080,
    ...overrides
  };
}

test("Openverse: hasil dinormalisasi ke bentuk kandidat Wikimedia", () => {
  const [candidate] = parseOpenverseResults([openverseEntry()]);
  assert.equal(candidate.pageId, "abc-123");
  assert.equal(candidate.mediaType, "image");
  assert.equal(candidate.license, "CC BY 4.0");
  assert.equal(candidate.categories, "avicenna manuscript");
  assert.equal(candidate.downloadUrl, "https://live.staticflickr.com/photo.jpg");
});

test("Openverse: label lisensi public domain dan CC0 dikenali scorer Wikimedia", () => {
  const [pdm] = parseOpenverseResults([openverseEntry({ license: "pdm", license_version: "" })]);
  const [cc0] = parseOpenverseResults([openverseEntry({ id: "x2", license: "cc0", license_version: "1.0" })]);
  assert.equal(pdm.license, "Public Domain Mark");
  assert.equal(cc0.license, "CC0 1.0");
});

test("Openverse: URL non-https dan tipe file tak didukung ditolak", () => {
  const results = parseOpenverseResults([
    openverseEntry({ url: "http://insecure.example/a.jpg" }),
    openverseEntry({ id: "svg", url: "https://x.example/a.svg", filetype: "svg" })
  ]);
  assert.equal(results.length, 0);
});

test("Wikidata: hanya nama orang yang memicu lookup", () => {
  assert.equal(looksLikePersonName("Ibnu Sina"), true);
  assert.equal(looksLikePersonName("Marie Curie"), true);
  assert.equal(looksLikePersonName("kapal selam"), false);
  assert.equal(looksLikePersonName("Apollo 11"), false);
  assert.equal(looksLikePersonName("Jakarta"), false);
});

test("Wikidata: entitas non-manusia ditolak, tidak dipakai sebagai foto tokoh", async () => {
  const result = await findPersonImage("Ibnu Sina", {
    searchEntity: async () => [
      { id: "Q125233024", label: "MTs Ibnu Sina", description: "madrasah tsanawiyah di Malang" },
      { id: "Q8011", label: "Ibnu Sina", description: "polimatik Persia" }
    ],
    // Entitas madrasah tidak akan sampai ke sini karena disaring deskripsi.
    entityImage: async (id) => (id === "Q8011" ? "Avicenna.jpg" : "Gedung.jpg")
  });
  assert.equal(result.entityId, "Q8011");
  assert.match(result.url, /Special:FilePath\/Avicenna\.jpg/);
});

test("Wikidata: tokoh tanpa P18 mengembalikan null, bukan menebak", async () => {
  const result = await findPersonImage("Budi Santoso", {
    searchEntity: async () => [{ id: "Q1", label: "Budi Santoso", description: "penulis" }],
    entityImage: async () => null
  });
  assert.equal(result, null);
});

test("personNameCandidates: nama tokoh diambil dari mustMatchTerms dan narrativeContext", () => {
  const names = personNameCandidates({
    mustMatchTerms: ["Ibnu Sina", "medicine"],
    narrativeContext: "ilmuwan Ibnu Sina menulis kitab"
  });
  assert.deepEqual(names, ["Ibnu Sina"]);
});

test("fetchOpenverseImageForScene: foto tokoh Wikidata dipakai lebih dulu", async () => {
  const media = await fetchOpenverseImageForScene({
    itemId: "item1",
    scene: { index: 3, segmentIndex: 0, mustMatchTerms: ["Ibnu Sina"], pexelsQuery: "avicenna" },
    personImage: async () => ({
      entityId: "Q8011",
      label: "Ibnu Sina",
      url: "https://commons.wikimedia.org/wiki/Special:FilePath/Avicenna.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Avicenna.jpg"
    }),
    searchImages: async () => {
      throw new Error("tidak boleh dipanggil saat foto tokoh tersedia");
    },
    downloadImage: async (_url, outputPath) => outputPath
  });
  assert.equal(media.provider, "wikidata");
  assert.equal(media.openversePageId, "Q8011");
  assert.equal(media.sceneIndex, 3);
});

test("fetchOpenverseImageForScene: download gagal → null, pipeline lanjut ke OpenAI", async () => {
  const media = await fetchOpenverseImageForScene({
    itemId: "item1",
    scene: { index: 1, segmentIndex: 0, pexelsQuery: "avicenna manuscript", mustMatchTerms: ["manuscript"] },
    searchImages: async () => parseOpenverseResults([openverseEntry({ title: "avicenna manuscript" })]),
    downloadImage: async () => {
      throw new Error("HTTP 503");
    }
  });
  assert.equal(media, null);
});

test("Openverse: balasan non-JSON (timeout gateway) jadi error jelas, bukan SyntaxError", async () => {
  await assert.rejects(
    () => searchOpenverseImages("manuscript", {
      fetchImpl: async () => ({
        ok: true,
        json: async () => { throw new SyntaxError("Unexpected token <"); },
        text: async () => "<html>error 524</html>"
      })
    }),
    /non-JSON/
  );
});

test("atribusi: aset Openverse dan Wikidata ikut dikreditkan, bukan hanya Wikimedia", () => {
  const block = buildMediaAttributionBlock({
    assets: {
      images: [
        {
          provider: "openverse",
          title: "Avicenna manuscript",
          creator: "Wellcome Collection",
          license: "CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          sourceUrl: "https://flickr.com/photos/1"
        },
        {
          provider: "wikidata",
          title: "Ibnu Sina",
          license: "Lihat halaman sumber",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:Avicenna.jpg"
        }
      ],
      clips: []
    }
  });
  assert.match(block, /Avicenna manuscript/);
  assert.match(block, /Ibnu Sina/);
  assert.match(block, /creativecommons\.org\/licenses\/by\/4\.0/);
});
