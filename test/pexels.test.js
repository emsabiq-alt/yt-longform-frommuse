// Unit test fungsi murni seleksi semantik & relevansi di src/pexels.js.
// Semua fungsi di bawah tidak menyentuh jaringan/disk — aman diuji langsung.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  buildPexelsQueryPlan,
  downloadPexelsVideo,
  tokenizeWords,
  scoreSceneVisualConcreteness,
  clipTitleFromVideo,
  clipRelevanceScore,
  scorePexelsCandidate,
  searchPexelsVideos,
  selectPexelsCandidate
} from "../src/pexels.js";
import { config, numberEnv } from "../src/config.js";

function video(id, slug, options = {}) {
  return {
    id,
    duration: options.duration ?? 12,
    url: `https://www.pexels.com/video/${slug}-${id}/`,
    video_files: options.files || [{
      file_type: "video/mp4",
      link: `https://videos.pexels.com/${id}.mp4`,
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      quality: options.quality || "hd"
    }]
  };
}

function minimalValidMp4() {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 16]),
    Buffer.from("ftyp"),
    Buffer.from("isom"),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from([0, 0, 0, 8]),
    Buffer.from("free")
  ]);
}

test("tokenizeWords: lowercase, buang stopword & token pendek nonvisual", () => {
  assert.deepEqual(tokenizeWords("US dollar bills"), ["us", "dollar", "bills"]);
  assert.deepEqual(
    tokenizeWords("UN EU US UK AI VR EV x y"),
    ["un", "eu", "us", "uk", "ai", "vr", "ev"]
  );
  assert.deepEqual(tokenizeWords("G20 summit in São Paulo"), ["g20", "summit", "sao", "paulo"]);
  assert.deepEqual(tokenizeWords("oil barrels and the trade"), ["oil", "barrels", "trade"]);
  assert.deepEqual(tokenizeWords(""), []);
  assert.deepEqual(tokenizeWords(null), []);
});

test("scoreSceneVisualConcreteness: scene konkret > scene abstrak", () => {
  const concrete = { visualKeywords: "oil barrels,stock exchange,gold bars" };
  const abstract = { visualKeywords: "economic crisis,currency diversification,global finance history" };
  assert.ok(
    scoreSceneVisualConcreteness(concrete) > scoreSceneVisualConcreteness(abstract),
    "scene konkret harus berskor lebih tinggi"
  );
});

test("scoreSceneVisualConcreteness: tanpa keyword berskor sangat rendah", () => {
  assert.equal(scoreSceneVisualConcreteness({ visualKeywords: "" }), -5);
  assert.equal(scoreSceneVisualConcreteness({}), -5);
});

test("clipTitleFromVideo: ambil slug dari URL Pexels, buang id numerik", () => {
  assert.equal(
    clipTitleFromVideo({ url: "https://www.pexels.com/video/aerial-view-of-a-city-3209828/" }),
    "aerial view of a city"
  );
  assert.equal(
    clipTitleFromVideo({ url: "https://www.pexels.com/video/s%C3%A3o-paulo-skyline-99/" }),
    "são paulo skyline"
  );
  assert.doesNotThrow(() => clipTitleFromVideo({
    url: "https://www.pexels.com/video/bad-%E0%A4%A-99/"
  }));
  assert.equal(clipTitleFromVideo({ url: "" }), "");
});

test("clipRelevanceScore: hitung overlap kata keyword unik di judul klip", () => {
  const tokens = tokenizeWords("oil barrels,global trade");
  const match = { url: "https://www.pexels.com/video/oil-barrels-in-a-refinery-12345/" };
  const noMatch = { url: "https://www.pexels.com/video/sunset-over-mountains-67890/" };
  assert.equal(clipRelevanceScore(tokens, match), 2); // "oil" + "barrels"
  assert.equal(clipRelevanceScore(tokens, noMatch), 0);
  assert.equal(clipRelevanceScore([], match), 0);
});

test("clipRelevanceScore: kata keyword berulang dihitung sekali", () => {
  const tokens = tokenizeWords("dollar dollar dollar");
  const video = { url: "https://www.pexels.com/video/a-stack-of-dollar-bills-111/" };
  assert.equal(clipRelevanceScore(tokens, video), 1);
});

test("searchPexelsVideos: gunakan endpoint dan parameter resmi tanpa min_duration", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = config.pexels.apiKey;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => ({ videos: [] }) };
  };
  config.pexels.apiKey = "test-key";

  try {
    await searchPexelsVideos("oil refinery", {
      orientation: "landscape",
      size: "medium",
      locale: "en-US",
      page: 2,
      perPage: 999,
      minDuration: 99
    });
  } finally {
    globalThis.fetch = originalFetch;
    config.pexels.apiKey = originalKey;
  }

  assert.equal(requestedUrl.origin + requestedUrl.pathname, "https://api.pexels.com/v1/videos/search");
  assert.deepEqual(
    [...requestedUrl.searchParams.keys()].sort(),
    ["locale", "orientation", "page", "per_page", "query", "size"]
  );
  assert.equal(requestedUrl.searchParams.get("query"), "oil refinery");
  assert.equal(requestedUrl.searchParams.get("per_page"), "80");
  assert.equal(requestedUrl.searchParams.has("min_duration"), false);
});

test("buildPexelsQueryPlan: intent eksplisit kosong tidak mencari Pexels", () => {
  assert.deepEqual(buildPexelsQueryPlan({
    pexelsQuery: "",
    visualKeywords: "oil refinery"
  }, "oil industry"), []);
});

test("buildPexelsQueryPlan: scene lama tetap berasal dari visualKeywords atau topik", () => {
  assert.equal(
    buildPexelsQueryPlan({ visualKeywords: "oil refinery workers inspecting pipeline" })[0],
    "oil refinery workers inspecting pipeline"
  );
  assert.equal(buildPexelsQueryPlan({}, "modern elevator interior")[0], "modern elevator interior");
});

test("buildPexelsQueryPlan: fallback mempertahankan seluruh subjek wajib", () => {
  const plan = buildPexelsQueryPlan({
    pexelsQuery: "oil refinery workers inspecting pipeline",
    mustMatchTerms: ["oil", "pipeline"]
  });
  assert.equal(plan.length, 2);
  assert.match(plan[1], /\boil\b/);
  assert.match(plan[1], /\bpipeline\b/);
  assert.notEqual(plan[1], "oil refinery");
});

test("selectPexelsCandidate: kandidat relevan mengalahkan kandidat tidak relevan", () => {
  const selected = selectPexelsCandidate([
    video(1, "sunset-over-mountains"),
    video(2, "workers-inspecting-oil-refinery-pipelines")
  ], {
    query: "oil refinery workers inspecting pipeline",
    mustMatchTerms: ["oil", "refinery"],
    minDurationSec: 8,
    minRelevance: 0.3
  });
  assert.equal(selected.video.id, 2);
  assert.ok(selected.score > 0);
  assert.ok(selected.matchedTerms.includes("oil"));
});

test("selectPexelsCandidate: slug generik tetap dipilih mengikuti urutan pencarian Pexels", () => {
  // Pexels sudah mengurutkan hasil berdasarkan relevansi query, jadi kandidat
  // dengan slug tidak deskriptif tidak boleh dibuang — pilih peringkat teratas.
  const selected = selectPexelsCandidate([
    video(1, "sunset-over-mountains"),
    video(2, "video-855")
  ], {
    query: "oil refinery",
    minDurationSec: 8
  });
  assert.ok(selected, "kandidat harus tetap terpilih");
  assert.equal(selected.video.id, 1, "urutan hasil pencarian Pexels harus dihormati");
  assert.equal(selected.score, 0);
});

test("scorePexelsCandidate: must-match kini sinyal ranking, bukan gerbang", () => {
  const scored = scorePexelsCandidate(video(1, "refinery-industrial-facility"), {
    query: "oil refinery",
    mustMatchTerms: ["oil"],
    minDurationSec: 8
  });
  // Slug tanpa "oil" tetap layak (Pexels sudah mengurutkan hasil per query),
  // tetapi skornya lebih rendah dari kandidat yang memuat istilah wajib.
  assert.equal(scored.eligible, true);
  assert.equal(scored.rejectionReason, "");
  const withMust = scorePexelsCandidate(video(2, "oil-refinery-industrial"), {
    query: "oil refinery",
    mustMatchTerms: ["oil"],
    minDurationSec: 8
  });
  assert.ok(withMust.score > scored.score);
});

test("scorePexelsCandidate: cakupan must-match memengaruhi skor bertingkat", () => {
  const options = {
    query: "oil refinery workers",
    mustMatchTerms: ["oil", "refinery", "workers"],
    minDurationSec: 8
  };
  const partial = scorePexelsCandidate(video(1, "oil-refinery-at-sunset"), options);
  const full = scorePexelsCandidate(video(2, "workers-inspecting-oil-refinery"), options);

  assert.equal(partial.requiredMustMatches, 3);
  assert.equal(partial.mustMatchCoverage, 2 / 3);
  assert.equal(partial.eligible, true);
  assert.equal(full.mustMatchCoverage, 1);
  assert.equal(full.eligible, true);
  assert.ok(full.score > partial.score, "cakupan penuh harus menang ranking");
});

test("scorePexelsCandidate: ranking memenangkan New York atas New Jersey", () => {
  const options = {
    query: "New York skyline",
    mustMatchTerms: ["New York", "skyline"],
    minDurationSec: 8
  };
  const selected = selectPexelsCandidate([
    video(1, "new-jersey-skyline-at-night"),
    video(2, "new-york-skyline-at-night")
  ], options);
  assert.equal(selected.video.id, 2);
});

test("scorePexelsCandidate: tanpa must-match eksplisit dinilai lewat ranking, bukan gerbang", () => {
  const options = {
    query: "new york skyline at night",
    minDurationSec: 8
  };
  const partial = scorePexelsCandidate(video(1, "new-jersey-skyline-at-night"), options);
  const exact = scorePexelsCandidate(video(2, "new-york-skyline-at-night"), options);

  // Tanpa istilah eksplisit dari storyboard tidak ada gerbang identitas:
  // kandidat parsial tetap layak tetapi kalah ranking dari yang persis.
  assert.equal(partial.requiredMustMatches, 0);
  assert.equal(partial.eligible, true);
  assert.equal(exact.eligible, true);
  assert.ok(exact.score > partial.score, "kecocokan penuh harus mengungguli parsial");

  const selected = selectPexelsCandidate([
    video(1, "new-jersey-skyline-at-night"),
    video(2, "new-york-skyline-at-night")
  ], options);
  assert.equal(selected.video.id, 2);
});

test("scorePexelsCandidate: must-match eksplisit tidak dilengkapi otomatis dari query", () => {
  const locationPartial = scorePexelsCandidate(video(1, "new-jersey-skyline-at-night"), {
    query: "new york skyline at night",
    mustMatchTerms: ["new"],
    minDurationSec: 8
  });
  const subjectPartial = scorePexelsCandidate(video(2, "oil-painting-in-studio"), {
    query: "oil refinery workers inspecting pipeline",
    mustMatchTerms: ["oil"],
    minDurationSec: 8
  });

  // Hanya istilah eksplisit yang menjadi gerbang; token query lain jadi ranking.
  assert.equal(locationPartial.requiredMustMatches, 1);
  assert.equal(locationPartial.eligible, true);
  assert.equal(subjectPartial.requiredMustMatches, 1);
  assert.equal(subjectPartial.eligible, true);

  // Ranking tetap memenangkan subjek yang benar.
  const selected = selectPexelsCandidate([
    video(2, "oil-painting-in-studio"),
    video(3, "oil-refinery-workers-inspecting-pipeline")
  ], {
    query: "oil refinery workers inspecting pipeline",
    mustMatchTerms: ["oil"],
    minDurationSec: 8
  });
  assert.equal(selected.video.id, 3);
});

test("ranking: European Union mengalahkan negara Eropa generik", () => {
  const options = {
    query: "European Union flag",
    mustMatchTerms: ["European Union", "flag"],
    minDurationSec: 8
  };
  const generic = scorePexelsCandidate(video(1, "european-country-flag-waving"), options);
  const exact = scorePexelsCandidate(video(2, "european-union-flag-waving"), options);

  assert.equal(generic.eligible, true);
  assert.ok(exact.score > generic.score);
  assert.equal(selectPexelsCandidate([
    video(1, "european-country-flag-waving"),
    video(2, "european-union-flag-waving")
  ], options).video.id, 2);
});

test("scorePexelsCandidate: news tidak dianggap cocok dengan new (token match tetap ketat)", () => {
  const scored = scorePexelsCandidate(video(1, "new-studio"), {
    query: "news studio",
    mustMatchTerms: ["news", "studio"],
    minDurationSec: 8
  });
  // Tokenizer tetap ketat: "new" bukan "news". Kandidat tetap layak (ranking),
  // tapi istilah "news" tidak boleh dihitung cocok.
  assert.equal(scored.matchedMustTerms.includes("news"), false);
  assert.equal(scored.mustMatchCoverage, 1 / 2);
});

test("ranking: EU flag mengalahkan rainbow flag", () => {
  const options = {
    query: "EU flag",
    mustMatchTerms: ["EU", "flag"],
    minDurationSec: 8
  };
  const rainbow = scorePexelsCandidate(video(1, "rainbow-flag-waving"), options);
  assert.equal(rainbow.matchedMustTerms.includes("eu"), false);
  assert.equal(selectPexelsCandidate([
    video(1, "rainbow-flag-waving"),
    video(2, "EU-flag-waving")
  ], options).video.id, 2);
});

test("ranking: UN headquarters mengalahkan corporate headquarters", () => {
  const options = {
    query: "UN headquarters",
    mustMatchTerms: ["UN", "headquarters"],
    minDurationSec: 8
  };
  assert.equal(selectPexelsCandidate([
    video(1, "corporate-headquarters"),
    video(2, "un-headquarters")
  ], options).video.id, 2);
});

test("ranking: G20 summit mengalahkan business summit", () => {
  const options = {
    query: "G20 summit leaders",
    mustMatchTerms: ["G20", "summit", "leaders"],
    minDurationSec: 8
  };
  assert.equal(selectPexelsCandidate([
    video(1, "business-summit-leaders"),
    video(2, "g20-summit-leaders")
  ], options).video.id, 2);
});

test("ranking: São Paulo dinormalisasi tanpa kehilangan identitas", () => {
  const options = {
    query: "São Paulo skyline",
    mustMatchTerms: ["São Paulo", "skyline"],
    minDurationSec: 8
  };
  const partial = scorePexelsCandidate(video(1, "paulo-skyline"), options);
  const exact = scorePexelsCandidate(video(2, "sao-paulo-skyline"), options);
  assert.ok(exact.score > partial.score);
  assert.equal(selectPexelsCandidate([
    video(1, "paulo-skyline"),
    video(2, "sao-paulo-skyline")
  ], options).video.id, 2);
});

test("scorePexelsCandidate: must-match parsial diselesaikan lewat ranking query", () => {
  const options = {
    query: "oil refinery",
    mustMatchTerms: ["oil"],
    minDurationSec: 8
  };
  const partial = scorePexelsCandidate(video(1, "oil-painting"), options);
  const exact = scorePexelsCandidate(video(2, "oil-refinery"), options);

  // "oil-painting" memenuhi gerbang eksplisit ("oil") jadi layak,
  // tetapi ranking memenangkan kandidat dengan cakupan query lebih tinggi.
  assert.equal(partial.eligible, true);
  assert.equal(exact.eligible, true);
  assert.ok(exact.score > partial.score);
  assert.equal(selectPexelsCandidate([
    video(1, "oil-painting"),
    video(2, "oil-refinery")
  ], options).video.id, 2);
});

test("selectPexelsCandidate: video portrait-only ditolak", () => {
  const selected = selectPexelsCandidate([
    video(1, "oil-refinery-workers", {
      files: [{
        file_type: "video/mp4",
        link: "https://videos.pexels.com/portrait.mp4",
        width: 1080,
        height: 1920,
        quality: "hd"
      }]
    })
  ], {
    query: "oil refinery workers",
    mustMatchTerms: ["oil", "refinery"],
    minDurationSec: 8,
    minRelevance: 0.3
  });
  assert.equal(selected, null);
});

test("numberEnv: env kosong memakai default dan nol eksplisit tetap valid", () => {
  const name = "TEST_PEXELS_NUMBER_ENV";
  const original = process.env[name];
  try {
    process.env[name] = "";
    assert.equal(numberEnv(name, 30), 30);
    process.env[name] = "  ";
    assert.equal(numberEnv(name, 30), 30);
    process.env[name] = "0";
    assert.equal(numberEnv(name, 30), 0);
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

test("selectPexelsCandidate: durasi difilter lokal", () => {
  const selected = selectPexelsCandidate([
    video(1, "oil-refinery-workers", { duration: 4 }),
    video(2, "oil-refinery-workers", { duration: 12 })
  ], {
    query: "oil refinery workers",
    mustMatchTerms: ["oil"],
    minDurationSec: 8,
    minRelevance: 0.3
  });
  assert.equal(selected.video.id, 2);
});

test("selectPexelsCandidate: ID yang sudah dipakai dikecualikan", () => {
  const selected = selectPexelsCandidate([
    video(1, "oil-refinery-workers"),
    video(2, "oil-refinery-workers")
  ], {
    query: "oil refinery workers",
    mustMatchTerms: ["oil"],
    minDurationSec: 8,
    minRelevance: 0.3,
    usedPexelsIds: new Set([1])
  });
  assert.equal(selected.video.id, 2);
});

test("selectPexelsCandidate: pemenang deterministik saat skor sama mengikuti urutan pencarian", () => {
  const first = video(10, "oil-refinery-workers");
  const second = video(2, "oil-refinery-workers");
  const options = {
    query: "oil refinery workers",
    mustMatchTerms: ["oil"],
    minDurationSec: 8
  };
  // Saat sinyal slug identik, urutan hasil pencarian Pexels yang menentukan:
  // kandidat pertama dari API menang, terlepas dari nilai id-nya.
  assert.equal(selectPexelsCandidate([first, second], options).video.id, 10);
  assert.equal(selectPexelsCandidate([second, first], options).video.id, 2);
});

test("selectPexelsCandidate: singular dan plural sederhana dianggap cocok", () => {
  const selected = selectPexelsCandidate([
    video(1, "worker-checking-refineries-and-pipes")
  ], {
    query: "workers checking refinery pipelines",
    mustMatchTerms: ["workers", "refinery"],
    minDurationSec: 8,
    minRelevance: 0.5
  });
  assert.equal(selected.video.id, 1);
  assert.ok(selected.matchedMustTerms.includes("workers"));
});

test("scorePexelsCandidate: houses/house dan horses/horse dinormalisasi aman", () => {
  const pluralQuery = scorePexelsCandidate(video(1, "house-and-horse-in-countryside"), {
    query: "houses horses",
    mustMatchTerms: ["houses", "horses"],
    minDurationSec: 8,
    minRelevance: 1
  });
  const singularQuery = scorePexelsCandidate(video(2, "houses-and-horses-in-countryside"), {
    query: "house horse",
    mustMatchTerms: ["house", "horse"],
    minDurationSec: 8,
    minRelevance: 1
  });

  assert.equal(pluralQuery.eligible, true);
  assert.equal(pluralQuery.relevance, 1);
  assert.equal(singularQuery.eligible, true);
  assert.equal(singularQuery.relevance, 1);
});

test("scorePexelsCandidate: plural -ies mendukung city dan kata singular berakhiran ie", () => {
  const cases = [
    ["city", "cities"],
    ["movie", "movies"],
    ["cookie", "cookies"],
    ["selfie", "selfies"],
    ["zombie", "zombies"]
  ];

  for (const [singular, plural] of cases) {
    const pluralQuery = scorePexelsCandidate(video(1, singular), {
      query: plural,
      mustMatchTerms: [plural],
      minDurationSec: 8,
      minRelevance: 1
    });
    const singularQuery = scorePexelsCandidate(video(2, plural), {
      query: singular,
      mustMatchTerms: [singular],
      minDurationSec: 8,
      minRelevance: 1
    });
    assert.equal(pluralQuery.eligible, true, `${plural} harus cocok dengan ${singular}`);
    assert.equal(singularQuery.eligible, true, `${singular} harus cocok dengan ${plural}`);
  }
});

test("scorePexelsCandidate: nama entitas berakhiran s tidak di-stem generik", () => {
  const cases = [
    ["paris", "pari"],
    ["hamas", "hama"],
    ["brics", "bric"]
  ];

  for (const [entity, falseStem] of cases) {
    const scored = scorePexelsCandidate(video(1, falseStem), {
      query: entity,
      mustMatchTerms: [entity],
      minDurationSec: 8,
      minRelevance: 0
    });
    // Kandidat tetap eligible (ranking-first), tapi token palsu tidak boleh
    // dihitung cocok: skor tetap nol sehingga kalah dari kandidat sebenarnya.
    assert.equal(scored.matchedMustTerms.length, 0, `${entity} tidak boleh cocok dengan ${falseStem}`);
    assert.equal(scored.score, 0);
    assert.equal(scored.relevance, 0);
  }
});

test("downloadPexelsVideo: stream gagal mempertahankan destination dan membersihkan partial", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-"));
  const outputPath = path.join(tempDir, "existing.mp4");
  const originalFetch = globalThis.fetch;
  await fs.writeFile(outputPath, "video-lama-valid");

  globalThis.fetch = async () => ({
    ok: true,
    body: Readable.toWeb(Readable.from((async function* failingStream() {
      yield Buffer.from("potongan-baru");
      throw new Error("stream terputus");
    })()))
  });

  try {
    await assert.rejects(
      downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      /stream terputus/
    );
    assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
    assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadPexelsVideo: response HTML ditolak sebelum ditulis", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-html-"));
  const outputPath = path.join(tempDir, "existing.mp4");
  const originalFetch = globalThis.fetch;
  await fs.writeFile(outputPath, "video-lama-valid");

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "text/html; charset=utf-8" },
    body: Readable.toWeb(Readable.from(["<html>error</html>"]))
  });

  try {
    await assert.rejects(
      downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      /Content-Type text\/html bukan video/
    );
    assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
    assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadPexelsVideo: response tanpa header yang berisi HTML ditolak via signature", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-no-header-"));
  const outputPath = path.join(tempDir, "existing.mp4");
  const originalFetch = globalThis.fetch;
  await fs.writeFile(outputPath, "video-lama-valid");

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => null },
    body: Readable.toWeb(Readable.from(["<html>not a video</html>"]))
  });

  try {
    await assert.rejects(
      downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      /signature MP4 ftyp tidak ditemukan/
    );
    assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
    assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadPexelsVideo: octet-stream HTML ditolak via signature", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-octet-html-"));
  const outputPath = path.join(tempDir, "existing.mp4");
  const originalFetch = globalThis.fetch;
  await fs.writeFile(outputPath, "video-lama-valid");

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/octet-stream" },
    body: Readable.toWeb(Readable.from(["<html>octet-stream error</html>"]))
  });

  try {
    await assert.rejects(
      downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      /signature MP4 ftyp tidak ditemukan/
    );
    assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
    assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadPexelsVideo: signature ftyp valid dipindah atomik ke destination", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-valid-"));
  const outputPath = path.join(tempDir, "clip.mp4");
  const originalFetch = globalThis.fetch;
  const minimalMp4 = minimalValidMp4();

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "video/mp4" },
    body: Readable.toWeb(Readable.from([minimalMp4]))
  });

  try {
    assert.equal(
      await downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      outputPath
    );
    assert.deepEqual(await fs.readFile(outputPath), minimalMp4);
    assert.deepEqual(await fs.readdir(tempDir), ["clip.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadPexelsVideo: ftyp 16-byte saja dan major brand kosong ditolak", async () => {
  const invalidPayloads = [
    Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
      Buffer.from([0, 0, 2, 0])
    ]),
    Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from("ftyp"),
      Buffer.alloc(4),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("<html>error</html>")
    ])
  ];
  const originalFetch = globalThis.fetch;

  try {
    for (const [index, payload] of invalidPayloads.entries()) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pexels-truncated-ftyp-${index}-`));
      const outputPath = path.join(tempDir, "existing.mp4");
      await fs.writeFile(outputPath, "video-lama-valid");
      globalThis.fetch = async () => ({
        ok: true,
        headers: { get: () => "video/mp4" },
        body: Readable.toWeb(Readable.from([payload]))
      });
      await assert.rejects(
        downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
        /signature MP4 ftyp tidak ditemukan/
      );
      assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
      assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadPexelsVideo: payload HTML dengan ftyp tertanam ditolak walau mengaku video", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-embedded-ftyp-"));
  const outputPath = path.join(tempDir, "existing.mp4");
  const originalFetch = globalThis.fetch;
  const destinationBefore = "video-lama-valid";
  await fs.writeFile(outputPath, destinationBefore);
  const maliciousPayload = Buffer.concat([
    Buffer.from("<html><body>error payload "),
    Buffer.from([0, 0, 0, 16]),
    Buffer.from("ftyp"),
    Buffer.from("isom"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("</body></html>")
  ]);

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "video/mp4" },
    body: Readable.toWeb(Readable.from([maliciousPayload]))
  });

  try {
    await assert.rejects(
      downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      /signature MP4 ftyp tidak ditemukan/
    );
    assert.equal(await fs.readFile(outputPath, "utf8"), destinationBefore);
    assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("downloadPexelsVideo: ukuran box dan major brand ftyp wajib valid", async () => {
  const invalidPayloads = [
    Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
      Buffer.from([0, 0, 0, 0])
    ]),
    Buffer.concat([
      Buffer.from([0, 0, 0, 32]),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
      Buffer.from([0, 0, 0, 0])
    ]),
    Buffer.concat([
      Buffer.from([0, 0, 0, 16]),
      Buffer.from("ftyp"),
      Buffer.from([0x69, 0x73, 0x00, 0x6d]),
      Buffer.from([0, 0, 0, 0])
    ])
  ];
  const originalFetch = globalThis.fetch;

  try {
    for (const [index, payload] of invalidPayloads.entries()) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pexels-invalid-ftyp-${index}-`));
      const outputPath = path.join(tempDir, "existing.mp4");
      await fs.writeFile(outputPath, "video-lama-valid");
      globalThis.fetch = async () => ({
        ok: true,
        headers: { get: () => "video/mp4" },
        body: Readable.toWeb(Readable.from([payload]))
      });
      await assert.rejects(
        downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
        /signature MP4 ftyp tidak ditemukan/
      );
      assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
      assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("downloadPexelsVideo: stream kosong ditolak dan partial dibersihkan", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pexels-download-empty-"));
  const outputPath = path.join(tempDir, "existing.mp4");
  const originalFetch = globalThis.fetch;
  await fs.writeFile(outputPath, "video-lama-valid");

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "video/mp4" },
    body: Readable.toWeb(Readable.from([]))
  });

  try {
    await assert.rejects(
      downloadPexelsVideo("https://videos.pexels.com/test.mp4", outputPath),
      /file hasil kosong/
    );
    assert.equal(await fs.readFile(outputPath, "utf8"), "video-lama-valid");
    assert.deepEqual(await fs.readdir(tempDir), ["existing.mp4"]);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
