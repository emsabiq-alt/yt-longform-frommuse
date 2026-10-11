import test from "node:test";
import assert from "node:assert/strict";
import { nextScheduledPublishAt } from "../src/youtube-publisher.js";

test("nextScheduledPublishAt: memilih prime time US pada hari yang sama bila masih cukup waktu", () => {
  const publishAt = nextScheduledPublishAt({
    now: new Date("2026-08-10T22:00:00.000Z"), // 18:00 America/New_York
    time: "20:30",
    timeZone: "America/New_York",
    leadMinutes: 30
  });
  assert.equal(publishAt, "2026-08-11T00:30:00.000Z");
});

test("nextScheduledPublishAt: pindah ke hari berikutnya jika prime time sudah lewat", () => {
  const publishAt = nextScheduledPublishAt({
    now: new Date("2026-08-11T01:00:00.000Z"), // 21:00 America/New_York
    time: "20:30",
    timeZone: "America/New_York",
    leadMinutes: 30
  });
  assert.equal(publishAt, "2026-08-12T00:30:00.000Z");
});
