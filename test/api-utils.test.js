// Unit test fungsi murni di api/_utils.js — validasi input, auth helper, queue helper.
// Jalankan: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clean,
  clampStr,
  clampNum,
  boolInput,
  safeEqual,
  issueSessionToken,
  buildQueueItem,
  configSummary,
  upsertById,
  removeById,
  makeId,
  check,
  remoteMissingEnv,
  normalizeTrendInput
} from "../api/_utils.js";

test("clean: trim string, null/undefined → ''", () => {
  assert.equal(clean("  hi  "), "hi");
  assert.equal(clean(null), "");
  assert.equal(clean(undefined), "");
});

test("clampStr: trim lalu potong ke panjang maksimum", () => {
  assert.equal(clampStr("  hello  "), "hello");
  assert.equal(clampStr("abcdef", 3), "abc");
  assert.equal(clampStr(null), "");
});

test("clampNum: jaga nilai dalam rentang, fallback saat bukan angka", () => {
  assert.equal(clampNum(5, 0, 10, 1), 5);
  assert.equal(clampNum(-5, 0, 10, 1), 0);    // di bawah min
  assert.equal(clampNum(50, 0, 10, 1), 10);   // di atas max
  assert.equal(clampNum("8", 0, 10, 1), 8);   // string numerik diterima
  assert.equal(clampNum("abc", 0, 10, 7), 7); // NaN → fallback
  assert.equal(clampNum(undefined, 0, 10, 3), 3);
});

test("boolInput: parsing nilai truthy/falsey + fallback", () => {
  for (const v of [true, "true", "1", "yes", "on", "YES"]) assert.equal(boolInput(v), true);
  for (const v of [false, "false", "0", "no", "nope"]) assert.equal(boolInput(v), false);
  assert.equal(boolInput(undefined, true), true); // kosong → fallback
  assert.equal(boolInput("", true), true);
  assert.equal(boolInput(null), false);           // fallback default
});

test("safeEqual: benar untuk sama, salah untuk beda (termasuk beda panjang)", () => {
  assert.equal(safeEqual("rahasia", "rahasia"), true);
  assert.equal(safeEqual("rahasia", "rahasiaX"), false); // beda panjang tetap aman
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("", ""), true);
});

test("issueSessionToken: format v1.<exp>.<sig> dengan kedaluwarsa ~30 hari ke depan", () => {
  const token = issueSessionToken();
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "v1");
  const exp = Number(parts[1]);
  assert.ok(Number.isFinite(exp));
  const days = (exp - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(days > 29 && days <= 30, `expected ~30 hari, dapat ${days}`);
  assert.ok(parts[2].length > 0); // ada signature
});

test("buildQueueItem: durasi di-clamp ke rentang [300, 1200]", () => {
  assert.equal(buildQueueItem({ durationSec: 100 }).durationSec, 300);  // dinaikkan ke min
  assert.equal(buildQueueItem({ durationSec: 5000 }).durationSec, 1200); // dipotong ke max
  assert.equal(buildQueueItem({ durationSec: 420 }).durationSec, 420);  // di dalam rentang
});

test("durasi default dashboard dan antrean selaras, dengan override env dan pilihan pengguna", () => {
  const original = process.env.YT_DURATION_SEC;
  try {
    delete process.env.YT_DURATION_SEC;
    assert.equal(configSummary().durationSec, 1200);
    assert.equal(buildQueueItem({}).durationSec, 1200);
    process.env.YT_DURATION_SEC = "";
    assert.equal(configSummary().durationSec, 1200);
    assert.equal(buildQueueItem({}).durationSec, 1200);
    process.env.YT_DURATION_SEC = "600";
    assert.equal(configSummary().durationSec, 600);
    assert.equal(buildQueueItem({}).durationSec, 600);
    assert.equal(buildQueueItem({ durationSec: 900 }).durationSec, 900);
    process.env.YT_DURATION_SEC = "invalid";
    assert.equal(configSummary().durationSec, 1200);
    assert.equal(buildQueueItem({}).durationSec, 1200);
  } finally {
    if (original === undefined) delete process.env.YT_DURATION_SEC;
    else process.env.YT_DURATION_SEC = original;
  }
});

test("buildQueueItem: sceneCount awal dibatasi ke 8-48 dan proporsional terhadap durasi", () => {
  const originalScene = process.env.YT_SCENE_COUNT;
  const originalDur = process.env.YT_DURATION_SEC;
  try {
    delete process.env.YT_SCENE_COUNT;
    delete process.env.YT_DURATION_SEC;
    assert.equal(buildQueueItem({ sceneCount: 100 }).sceneCount, 48);
    assert.equal(buildQueueItem({ sceneCount: 34 }).sceneCount, 34);
    assert.equal(buildQueueItem({ sceneCount: 18 }).sceneCount, 18);
    assert.equal(buildQueueItem({ sceneCount: 1 }).sceneCount, 8);
    assert.equal(buildQueueItem({ sceneCount: 0 }).sceneCount, 36);
    assert.equal(buildQueueItem({ durationSec: 600 }).sceneCount, 18);
  } finally {
    if (originalScene === undefined) delete process.env.YT_SCENE_COUNT;
    else process.env.YT_SCENE_COUNT = originalScene;
    if (originalDur === undefined) delete process.env.YT_DURATION_SEC;
    else process.env.YT_DURATION_SEC = originalDur;
  }
});

test("buildQueueItem: ttsProvider hanya 'openai' atau 'elevenlabs'", () => {
  assert.equal(buildQueueItem({ ttsProvider: "openai" }).ttsProvider, "openai");
  assert.equal(buildQueueItem({ ttsProvider: "elevenlabs" }).ttsProvider, "elevenlabs");
  assert.equal(buildQueueItem({ ttsProvider: "tidak-dikenal" }).ttsProvider, "openai"); // default
});

test("buildQueueItem: trim topik, hormati id yang diberikan, auto-id kalau kosong", () => {
  assert.equal(buildQueueItem({ topic: "  Lubang Hitam  " }).topic, "Lubang Hitam");
  assert.equal(buildQueueItem({ id: "id-manual" }).id, "id-manual");
  assert.match(buildQueueItem({}).id, /^q_/);
  // createdAt & updatedAt berupa ISO timestamp
  const item = buildQueueItem({});
  assert.ok(!Number.isNaN(Date.parse(item.createdAt)));
  assert.ok(!Number.isNaN(Date.parse(item.updatedAt)));
});

test("metadata tren RSS dibersihkan dan dipertahankan di item antrian", () => {
  const trend = normalizeTrendInput({
    title: "  Pembayaran QR  ", articles: 7, sources: 4, days: 3,
    newsItems: [{ title: "  QR lintas negara meluas  ", source: " kompas.com ", url: "https://example.com/news", publishedAt: "2026-09-09" }]
  });
  assert.deepEqual(trend, {
    title: "Pembayaran QR", articles: 7, sources: 4, days: 3,
    newsItems: [{ title: "QR lintas negara meluas", source: "kompas.com", url: "https://example.com/news", publishedAt: "2026-09-09", excerpt: "", imageUrl: "" }]
  });
  assert.deepEqual(buildQueueItem({ trend }).trend, trend);
  assert.equal(normalizeTrendInput({ title: "tanpa berita" }), null);
});

test("upsertById: insert item baru, merge item yang sudah ada, tanpa mutasi sumber", () => {
  const base = [{ id: "a", x: 1, y: 2 }];
  const inserted = upsertById(base, { id: "b", x: 9 });
  assert.deepEqual(inserted, [{ id: "a", x: 1, y: 2 }, { id: "b", x: 9 }]);

  const updated = upsertById(base, { id: "a", x: 99 });
  assert.deepEqual(updated, [{ id: "a", x: 99, y: 2 }]); // x ditimpa, y dipertahankan
  assert.deepEqual(base, [{ id: "a", x: 1, y: 2 }]);      // sumber tidak berubah

  assert.deepEqual(upsertById(null, { id: "a" }), [{ id: "a" }]); // non-array → []
});

test("removeById: buang berdasarkan id, aman untuk non-array", () => {
  assert.deepEqual(removeById([{ id: "a" }, { id: "b" }], "a"), [{ id: "b" }]);
  assert.deepEqual(removeById([], "a"), []);
  assert.deepEqual(removeById(null, "x"), []);
});

test("makeId: format <prefix>_<14 digit>_<4 hex>", () => {
  assert.match(makeId("q"), /^q_\d{14}_[0-9a-f]{4}$/);
  assert.match(makeId("item"), /^item_\d{14}_[0-9a-f]{4}$/);
});

test("check: bungkus hasil cek dengan default yang benar", () => {
  assert.deepEqual(check("x", 1), { name: "x", ok: true, detail: "", required: true });
  assert.deepEqual(check("y", 0, "gagal", false), { name: "y", ok: false, detail: "gagal", required: false });
});

test("remoteMissingEnv: deteksi env wajib yang kosong; privateKey menggantikan password", () => {
  const allMissing = remoteMissingEnv({
    prefix: "SFTP", host: "", user: "", password: "", privateKey: "", remoteDir: ""
  });
  assert.deepEqual(allMissing, ["SFTP_HOST", "SFTP_USER", "SFTP_PASSWORD", "SFTP_REMOTE_DIR"]);

  // privateKey terisi → PASSWORD tidak dianggap kurang
  const withKey = remoteMissingEnv({
    prefix: "SFTP", host: "h", user: "u", password: "", privateKey: "kunci", remoteDir: "/d"
  });
  assert.deepEqual(withKey, []);
});

import { buildQueryCandidates } from "../api/research.js";

test("buildQueryCandidates: membersihkan stopwords dan menghasilkan kandidat pencarian berita cerdas", () => {
  const query = "Misteri Danau Toba Letusan Dahsyat Supervolcano Yang Pernah Mengubah Iklim Dunia";
  const candidates = buildQueryCandidates(query);
  assert.ok(candidates.length >= 2, "Harus menghasilkan lebih dari 1 kandidat");
  assert.ok(candidates[0].includes("Danau Toba"), "Kandidat utama harus memuat Danau Toba");
  assert.ok(!candidates[0].toLowerCase().includes("misteri"), "Stopword 'misteri' harus dibuang");
  assert.ok(!candidates[0].toLowerCase().includes("yang"), "Stopword 'yang' harus dibuang");
  assert.ok(candidates.includes(query), "Query asli harus tetap disertakan sebagai fallback terakhir");
});

