import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchWikimediaMediaForScene,
  isAllowedWikimediaLicense,
  parseWikimediaPages,
  scoreWikimediaCandidate,
  selectWikimediaCandidate,
  stripWikimediaHtml
} from "../src/wikimedia.js";

function candidate(overrides = {}) {
  return {
    pageId: 10,
    pageTitle: "File:Saturn V launch.jpg",
    title: "Saturn V launch",
    description: "NASA Saturn V rocket launch during Apollo mission",
    categories: "Apollo program|Saturn V",
    creator: "NASA",
    license: "Public domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Saturn_V_launch.jpg",
    originalUrl: "https://upload.wikimedia.org/example.jpg",
    thumbnailUrl: "https://upload.wikimedia.org/example-thumb.jpg",
    downloadUrl: "https://upload.wikimedia.org/example-thumb.jpg",
    mime: "image/jpeg",
    thumbMime: "image/jpeg",
    mediaType: "image",
    width: 1920,
    height: 1080,
    size: 500_000,
    ...overrides
  };
}

test("lisensi Wikimedia: default konservatif untuk penggunaan YouTube", () => {
  assert.equal(isAllowedWikimediaLicense("Public domain"), true);
  assert.equal(isAllowedWikimediaLicense("CC0"), true);
  assert.equal(isAllowedWikimediaLicense("CC BY 4.0"), true);
  assert.equal(isAllowedWikimediaLicense("CC BY-SA 4.0"), false);
  assert.equal(isAllowedWikimediaLicense("CC BY-SA 4.0", { allowShareAlike: true }), true);
  assert.equal(isAllowedWikimediaLicense("GFDL 1.2"), false);
  assert.equal(isAllowedWikimediaLicense("CC BY-NC 4.0"), false);
});

test("stripWikimediaHtml: membersihkan markup dan entity sebelum atribusi", () => {
  assert.equal(
    stripWikimediaHtml("<a href='/wiki/NASA'>NASA</a> &amp; partner"),
    "NASA & partner"
  );
});

test("parseWikimediaPages: memakai thumbnail gambar dan metadata atribusi", () => {
  const parsed = parseWikimediaPages([{
    pageid: 42,
    title: "File:Saturn V launch.jpg",
    imageinfo: [{
      url: "https://upload.wikimedia.org/original.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Saturn_V_launch.jpg",
      thumburl: "https://upload.wikimedia.org/thumb.jpg",
      mime: "image/jpeg",
      thumbmime: "image/jpeg",
      mediatype: "BITMAP",
      width: 3000,
      height: 2000,
      size: 900_000,
      extmetadata: {
        LicenseShortName: { value: "Public domain" },
        Artist: { value: "<b>NASA</b>" },
        ImageDescription: { value: "Saturn V <i>launch</i>" }
      }
    }]
  }]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].pageId, 42);
  assert.equal(parsed[0].downloadUrl, "https://upload.wikimedia.org/thumb.jpg");
  assert.equal(parsed[0].creator, "NASA");
  assert.equal(parsed[0].description, "Saturn V launch");
});

test("scoreWikimediaCandidate: menolak hasil tidak relevan dan video terlalu besar", () => {
  const relevant = scoreWikimediaCandidate(candidate(), {
    query: "Saturn V launch",
    mustMatchTerms: ["saturn", "launch"],
    minRelevance: 0.2,
    maxVideoBytes: 120 * 1024 * 1024
  });
  assert.equal(relevant.eligible, true);
  assert.ok(relevant.score > 0);

  const irrelevant = scoreWikimediaCandidate(candidate({
    title: "Portrait of a painter",
    description: "Oil painting in museum",
    categories: "Portrait paintings"
  }), {
    query: "Saturn V launch",
    mustMatchTerms: ["saturn", "launch"],
    minRelevance: 0.2
  });
  assert.equal(irrelevant.eligible, false);
  assert.equal(irrelevant.rejectionReason, "no-query-match");

  const tooLarge = scoreWikimediaCandidate(candidate({
    mediaType: "video",
    mime: "video/webm",
    thumbMime: "",
    downloadUrl: "https://upload.wikimedia.org/launch.webm",
    size: 500 * 1024 * 1024
  }), {
    query: "Saturn V launch",
    maxVideoBytes: 120 * 1024 * 1024
  });
  assert.equal(tooLarge.eligible, false);
  assert.equal(tooLarge.rejectionReason, "video-too-large");
});

test("selectWikimediaCandidate: relevansi menang dan lisensi ShareAlike dilewati", () => {
  const selected = selectWikimediaCandidate([
    candidate({ pageId: 1, license: "CC BY-SA 4.0" }),
    candidate({ pageId: 2, title: "Saturn V launch NASA" }),
    candidate({
      pageId: 3,
      title: "Unrelated city traffic",
      description: "cars and buses",
      categories: "Traffic"
    })
  ], {
    query: "Saturn V launch",
    mustMatchTerms: ["saturn", "launch"],
    minRelevance: 0.2,
    allowShareAlike: false
  });

  assert.equal(selected.candidate.pageId, 2);
});

test("fetchWikimediaMediaForScene: menghasilkan metadata siap pipeline", async () => {
  let downloaded = null;
  const media = await fetchWikimediaMediaForScene({
    itemId: "apollo-video",
    scene: {
      index: 2,
      segmentIndex: 1,
      pexelsQuery: "Saturn V launch",
      mustMatchTerms: ["saturn", "launch"],
      visualKeywords: "Saturn V rocket launch"
    },
    usedPageIds: new Set(),
    searchMedia: async () => [candidate({ pageId: 88 })],
    downloadMedia: async (url, outputPath) => {
      downloaded = { url, outputPath };
      return outputPath;
    }
  });

  assert.equal(media.provider, "wikimedia");
  assert.equal(media.mediaType, "image");
  assert.equal(media.wikimediaPageId, 88);
  assert.equal(media.sceneIndex, 2);
  assert.equal(media.segmentIndex, 1);
  assert.match(media.path, /wikimedia-88-/);
  assert.equal(downloaded.url, "https://upload.wikimedia.org/example-thumb.jpg");
});
