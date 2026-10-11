// Unit test format-engine + cost: variasi storyboard (ban-list) dan estimasi harga gambar.
import test from "node:test";
import assert from "node:assert/strict";
import { FORMAT_TYPES, pickFormatType, sceneWordRange } from "../src/format-engine.js";
import { estimateImageUsd } from "../src/cost.js";

test("pickFormatType: menghindari formatType dari 5 video terakhir", () => {
  const keys = Object.keys(FORMAT_TYPES);
  const banned = keys.slice(0, 5);
  const history = banned.map((formatType) => ({ formatType }));
  for (let i = 0; i < 200; i += 1) {
    assert.ok(!banned.includes(pickFormatType(history)), `terpilih formatType yang di-ban pada iterasi ${i}`);
  }
});

test("pickFormatType: membaca formatType dari history.input juga", () => {
  const keys = Object.keys(FORMAT_TYPES);
  const history = keys.slice(0, 5).map((formatType) => ({ input: { formatType } }));
  for (let i = 0; i < 100; i += 1) {
    assert.ok(!keys.slice(0, 5).includes(pickFormatType(history)));
  }
});

test("pickFormatType: kembali ke semua kunci saat history menghabiskan pool", () => {
  const keys = Object.keys(FORMAT_TYPES);
  const history = keys.map((formatType) => ({ formatType }));
  // Hanya 5 teratas yang dilihat, tapi cek juga kasus ekstrem lookback penuh.
  assert.ok(keys.includes(pickFormatType(history)));
  const allBanned = keys.slice(0, 5).map((formatType) => ({ formatType }));
  assert.ok(keys.includes(pickFormatType(allBanned)));
  assert.ok(keys.includes(pickFormatType()));
});

test("sceneWordRange: semua format bisa mencapai target kata dan ambang revisi", () => {
  // Batas kata tetap "48-65" membuat mitos_vs_fakta & countdown selalu gagal di
  // durasi panjang, memicu satu tulis-ulang penuh yang gagal lagi.
  for (const formatType of Object.keys(FORMAT_TYPES)) {
    for (const durationSec of [300, 420, 600, 720, 900, 1200]) {
      const sceneCount = 36;
      const range = sceneWordRange(sceneCount, formatType, durationSec);
      const reachable = range.narratedScenes * range.imageMax;
      const threshold = Math.max(range.targetWords, range.minimumWords);
      assert.ok(
        reachable >= threshold,
        `${formatType} @${durationSec}s: maksimal ${reachable} kata < ambang ${threshold}`
      );
      assert.ok(range.imageMax > range.imageMin, `${formatType}: rentang harus punya lebar`);
      assert.ok(range.summaryMin > range.imageMin);
      assert.ok(range.targetWords > range.minimumWords);
    }
  }
});

test("sceneWordRange: aman untuk input tidak wajar", () => {
  const range = sceneWordRange(0, "format-hantu", 0);
  assert.ok(range.narratedScenes >= 1);
  assert.ok(range.imageMin >= 35);
  assert.ok(range.imageMax > range.imageMin);
});

test("estimateImageUsd: harga mengikuti IMAGE_MODEL, bukan hanya ukuran", () => {
  assert.equal(estimateImageUsd("1536x1024", "low", "gpt-image-1-mini"), 0.006);
  assert.equal(estimateImageUsd("1536x1024", "low", "gpt-image-1"), 0.016);
  assert.equal(estimateImageUsd("1024x1024", "high", "gpt-image-1"), 0.167);
  // Model/ukuran/kualitas tak dikenal → jatuh ke mini / 1024x1536 / low.
  assert.equal(estimateImageUsd("1536x1024", "standard", "model-hantu"), 0.006);
  assert.equal(estimateImageUsd("9999x9999", "low"), 0.006);
});
