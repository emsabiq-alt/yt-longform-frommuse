import test from "node:test";
import assert from "node:assert/strict";
import { rankStoryboardImages, escapeDrawtext, wrapTitle, layoutKineticLines } from "../src/thumbnail.js";

test("escapeDrawtext: path Windows dan tanda kutip aman dipakai di filtergraph", () => {
  assert.equal(escapeDrawtext("D:\\a030\\assets\\f.ttf"), "D\\:/a030/assets/f.ttf");
  assert.equal(escapeDrawtext("Madu 100% Tak Basi: Kenapa?"), "Madu 100\\% Tak Basi\\: Kenapa?");
});

test("wrapTitle: judul panjang dipenggal maksimal dua baris", () => {
  assert.deepEqual(wrapTitle("Rahasia Ibnu Sina"), ["Rahasia Ibnu Sina"]);
  assert.deepEqual(
    wrapTitle("Kenapa Madu Tidak Pernah Basi"),
    ["Kenapa Madu Tidak", "Pernah Basi"]
  );
  assert.deepEqual(wrapTitle(""), []);
});

test("layoutKineticLines: menata baris menjadi blok proporsional dan menyeimbangkan kata yatim", () => {
  const layout = layoutKineticLines(["Misteri Kota Kuno", "yang Hilang Tanpa", "Jejak"]);
  assert.equal(layout.length, 3);
  assert.equal(layout[2].text, "TANPA JEJAK.");
  assert.ok(layout[0].size >= 48 && layout[0].size <= 85);
  assert.ok(layout[1].size >= 48 && layout[1].size <= 85);
  assert.ok(layout[2].size >= 48 && layout[2].size <= 85);
});

test("rankStoryboardImages: memilih gambar storyboard yang paling sesuai dengan judul", () => {
  const ranked = rankStoryboardImages({
    title: "Kenapa Madu Tidak Pernah Basi",
    input: { topic: "madu tidak basi" },
    plan: {
      scenes: [
        { index: 0, imagePrompt: "deep ocean trench at night", visualSegments: [] },
        {
          index: 3,
          imagePrompt: "ancient honey jars and honeycomb close up",
          screenText: "Madu tidak pernah basi",
          visualSegments: []
        }
      ]
    },
    assets: {
      images: [
        { sceneIndex: 0, segmentIndex: 0, path: "/images/ocean.jpg", provider: "openai", prompt: "deep ocean" },
        { sceneIndex: 3, segmentIndex: 0, path: "/images/honey.jpg", provider: "openai", prompt: "honey jars" }
      ]
    }
  });

  assert.equal(ranked[0].image.path, "/images/honey.jpg");
  assert.ok(ranked[0].score > ranked[1].score);
});

