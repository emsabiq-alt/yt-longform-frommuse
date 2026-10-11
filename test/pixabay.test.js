import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPixabayQueryPlan,
  pickBestPixabayVideoFile,
  searchPixabayVideos,
  searchPixabayImages,
  fetchPixabayMediaForScene
} from "../src/pixabay.js";
import { buildMediaAttributionBlock, buildDescription } from "../src/youtube-meta.js";
import { ensurePixabayMedia } from "../src/pipeline.js";
import { config } from "../src/config.js";

test("pickBestPixabayVideoFile: memilih varian video landscape 720p/1080p terbaik", () => {
  const hit = {
    id: 101,
    videos: {
      tiny: { url: "https://cdn.pixabay.com/tiny.mp4", width: 480, height: 270 },
      small: { url: "https://cdn.pixabay.com/small.mp4", width: 960, height: 540 },
      medium: { url: "https://cdn.pixabay.com/medium.mp4", width: 1920, height: 1080 },
      large: { url: "https://cdn.pixabay.com/large.mp4", width: 3840, height: 2160 }
    }
  };

  const best = pickBestPixabayVideoFile(hit);
  assert.ok(best);
  assert.equal(best.url, "https://cdn.pixabay.com/medium.mp4");
  assert.equal(best.height, 1080);
});

test("buildPixabayQueryPlan: membersihkan dan memprioritaskan keyword konkret", () => {
  const scene = {
    pexelsQuery: "ancient volcano eruption smoke",
    visualKeywords: "volcano lava, mountain landscape, disaster"
  };

  const plan = buildPixabayQueryPlan(scene, "Danau Toba Letusan Supervolcano");
  assert.ok(plan.length >= 2);
  assert.equal(plan[0], "ancient volcano eruption smoke");
  assert.match(plan[1], /volcano lava/);
});

test("searchPixabayVideos: mengirim parameter query dan safesearch dengan benar", async () => {
  let requestedUrl = "";
  const mockFetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        total: 10,
        hits: [
          {
            id: 202,
            user: "NatureCam",
            tags: "ocean, waves, blue",
            duration: 15,
            pageURL: "https://pixabay.com/videos/id-202/",
            videos: {
              medium: { url: "https://cdn.pixabay.com/ocean.mp4", width: 1920, height: 1080 }
            }
          }
        ]
      })
    };
  };

  const hits = await searchPixabayVideos("ocean waves", { fetchImpl: mockFetch, apiKey: "test-key" });
  assert.equal(hits.length, 1);
  assert.match(requestedUrl, /q=ocean(\+|%20)waves/);
  assert.match(requestedUrl, /safesearch=true/);
  assert.match(requestedUrl, /key=test-key/);
});

test("buildMediaAttributionBlock: mencantumkan kredit Pixabay lengkap dengan tautan lisensi", () => {
  const item = {
    assets: {
      clips: [
        {
          provider: "pixabay",
          pixabayId: 244754,
          title: "turtle, ocean, wildlife",
          creator: "PaulsAdventures",
          license: "Pixabay Content License",
          licenseUrl: "https://pixabay.com/service/license-summary/",
          sourceUrl: "https://pixabay.com/videos/turtle-ocean-244754/"
        }
      ],
      images: []
    }
  };

  const block = buildMediaAttributionBlock(item);
  assert.match(block, /Kredit media berlisensi terbuka:/);
  assert.match(block, /turtle, ocean, wildlife/);
  assert.match(block, /PaulsAdventures/);
  assert.match(block, /Pixabay Content License/);
  assert.match(block, /https:\/\/pixabay\.com\/videos\/turtle-ocean-244754\//);
  assert.match(block, /https:\/\/pixabay\.com\/service\/license-summary\//);
});

test("ensurePixabayMedia: mengisi slot yang belum memiliki media", async () => {
  const originalEnabled = config.pixabay.enabled;
  config.pixabay.enabled = true;

  try {
    const item = {
      id: "tau-lf-test",
      plan: {
        scenes: [
          {
            index: 1,
            sceneType: "image",
            visualKeywords: "forest drone aerial",
            visualSegments: [
              { visualKeywords: "forest drone aerial", narrativeContext: "hutan lebat" }
            ]
          }
        ]
      },
      assets: {
        clips: [],
        images: []
      }
    };

    const mockFetchMedia = async () => ({
      sceneIndex: 1,
      segmentIndex: 0,
      provider: "pixabay",
      pixabayId: 777,
      title: "forest drone aerial",
      creator: "ForestGuy",
      license: "Pixabay Content License",
      licenseUrl: "https://pixabay.com/service/license-summary/",
      sourceUrl: "https://pixabay.com/videos/forest-777/",
      duration: 10,
      path: "generated/clips/tau-lf-test-scene-01-seg-0-pixabay-777.mp4",
      url: "/generated/clips/tau-lf-test-scene-01-seg-0-pixabay-777.mp4"
    });

    const mockFileExists = async () => true;

    await ensurePixabayMedia(item, {
      fetchMedia: mockFetchMedia,
      fileExists: mockFileExists,
      persistItem: async () => {}
    });

    assert.equal(item.assets.clips.length, 1);
    assert.equal(item.assets.clips[0].provider, "pixabay");
    assert.equal(item.assets.clips[0].pixabayId, 777);
  } finally {
    config.pixabay.enabled = originalEnabled;
  }
});
