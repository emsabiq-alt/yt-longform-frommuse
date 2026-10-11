import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateOpenAiSpeech, normalizeImageQuality, requestKnowledgeJson } from "../src/openai.js";
import { config, DOCUMENTARY_TTS_INSTRUCTIONS, paths } from "../src/config.js";

const chatBody = (payload) => JSON.stringify({
  choices: [{ message: { content: JSON.stringify(payload) } }]
});

// Retry-After: 0 membuat jeda retry 0ms, jadi test tidak menunggu detik nyata.
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (typeof next === "function") return next();
    return next;
  };
  return calls;
}

function tooManyRequests() {
  return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
    status: 429,
    headers: { "Retry-After": "0" }
  });
}

async function withStub(responses, fn) {
  const originalFetch = globalThis.fetch;
  const originalKey = config.openai.apiKey;
  config.openai.apiKey = "test-key";
  const calls = stubFetch(responses);
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
    config.openai.apiKey = originalKey;
  }
}

test("openAiFetch: 429 dicoba ulang lalu sukses", async () => {
  await withStub(
    [tooManyRequests, tooManyRequests, () => new Response(chatBody({ ok: 1 }), { status: 200 })],
    async (calls) => {
      assert.deepEqual(await requestKnowledgeJson("prompt"), { ok: 1 });
      assert.equal(calls.length, 3);
    }
  );
});

test("openAiFetch: 5xx dicoba ulang lalu sukses", async () => {
  await withStub(
    [
      () => new Response("upstream down", { status: 503, headers: { "Retry-After": "0" } }),
      () => new Response(chatBody({ ok: 2 }), { status: 200 })
    ],
    async (calls) => {
      assert.deepEqual(await requestKnowledgeJson("prompt"), { ok: 2 });
      assert.equal(calls.length, 2);
    }
  );
});

test("openAiFetch: 429 terus-menerus berhenti di 3 percobaan, bukan loop", async () => {
  await withStub([tooManyRequests], async (calls) => {
    await assert.rejects(() => requestKnowledgeJson("prompt"), /Rate limit reached/);
    assert.equal(calls.length, 3);
  });
});

test("openAiFetch: 400 tidak dicoba ulang", async () => {
  await withStub(
    [() => new Response(JSON.stringify({ error: { message: "invalid prompt" } }), { status: 400 })],
    async (calls) => {
      await assert.rejects(() => requestKnowledgeJson("prompt"), /invalid prompt/);
      assert.equal(calls.length, 1);
    }
  );
});

// Timeout tidak di-retry: request yang sudah diproses server tetap ditagih.
test("openAiFetch: timeout gagal cepat dengan pesan jelas", async () => {
  await withStub(
    [() => { const error = new Error("aborted"); error.name = "TimeoutError"; throw error; }],
    async (calls) => {
      await assert.rejects(() => requestKnowledgeJson("prompt"), /tidak merespons dalam \d+s/);
      assert.equal(calls.length, 1);
    }
  );
});

test("openAiFetch: error jaringan dicoba ulang", async () => {
  let attempts = 0;
  await withStub(
    [() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return new Response(chatBody({ ok: 3 }), { status: 200 });
    }],
    async (calls) => {
      assert.deepEqual(await requestKnowledgeJson("prompt"), { ok: 3 });
      assert.equal(calls.length, 2);
    }
  );
});

async function withSpeechStub(options, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-speech-test-"));
  const originalOpenAi = { ...config.openai };
  const originalAudioDir = paths.audioDir;
  paths.audioDir = dir;
  Object.assign(config.openai, {
    ttsModel: "gpt-4o-mini-tts",
    ttsSpeed: 1.08,
    ttsInstructions: DOCUMENTARY_TTS_INSTRUCTIONS,
    ...options.config
  });
  try {
    await withStub(options.responses || [() => new Response("audio-bytes")], fn);
  } finally {
    Object.assign(config.openai, originalOpenAi);
    paths.audioDir = originalAudioDir;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("OpenAI speech mengirim speed dan gaya dokumenter serta menyimpan audio", async () => {
  await withSpeechStub({}, async (calls) => {
    const audio = await generateOpenAiSpeech({ itemId: "pacing", text: "Mengapa kapal baja bisa mengapung?", voice: "cedar" });
    const body = JSON.parse(calls[0].init.body);
    assert.match(calls[0].url, /\/audio\/speech$/);
    assert.equal(body.speed, 1.08);
    assert.equal(body.instructions, DOCUMENTARY_TTS_INSTRUCTIONS);
    assert.equal(body.input, "Mengapa kapal baja bisa mengapung?");
    assert.equal(audio.speed, 1.08);
    assert.equal(await fs.readFile(audio.path, "utf8"), "audio-bytes");
  });
});

test("OpenAI speech memakai speed 1.10 dan instruksi khusus pada fallback voice", async () => {
  await withSpeechStub({
    config: { ttsSpeed: 1.10 },
    responses: [
      () => new Response(JSON.stringify({ error: { message: "Invalid voice", param: "voice" } }), { status: 400 }),
      () => new Response("fallback-audio")
    ]
  }, async (calls) => {
    const audio = await generateOpenAiSpeech({ itemId: "fallback", text: "Satu bukti mengubah penjelasan ini.", voice: "invalid-voice", instructions: "Jelaskan dengan tenang." });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const body = JSON.parse(call.init.body);
      assert.equal(body.speed, 1.10);
      assert.equal(body.instructions, "Jelaskan dengan tenang.");
    }
    assert.equal(JSON.parse(calls[1].init.body).voice, "nova");
    assert.equal(audio.voice, "nova");
    assert.equal(audio.speed, 1.10);
  });
});

test("OpenAI speech mempertahankan speed pada model lama tanpa instructions", async () => {
  for (const ttsModel of ["tts-1", "tts-1-hd"]) {
    await withSpeechStub({ config: { ttsModel } }, async (calls) => {
      await generateOpenAiSpeech({ itemId: "legacy", text: "Narasi dokumenter." });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.model, ttsModel);
      assert.equal(body.speed, 1.08);
      assert.equal(Object.hasOwn(body, "instructions"), false);
    });
  }
});

test("normalizeImageQuality: memetakan nilai lama dan memvalidasi gpt-image vs dall-e", () => {
  // gpt-image-1 / gpt-image-1-mini
  assert.equal(normalizeImageQuality("standard", "gpt-image-1-mini"), "medium");
  assert.equal(normalizeImageQuality("hd", "gpt-image-1-mini"), "high");
  assert.equal(normalizeImageQuality("low", "gpt-image-1-mini"), "low");
  assert.equal(normalizeImageQuality("medium", "gpt-image-1-mini"), "medium");
  assert.equal(normalizeImageQuality("high", "gpt-image-1-mini"), "high");
  assert.equal(normalizeImageQuality("auto", "gpt-image-1-mini"), "auto");
  assert.equal(normalizeImageQuality("unknown-val", "gpt-image-1-mini"), "low");

  // DALL-E models
  assert.equal(normalizeImageQuality("low", "dall-e-3"), "standard");
  assert.equal(normalizeImageQuality("standard", "dall-e-3"), "standard");
  assert.equal(normalizeImageQuality("high", "dall-e-3"), "hd");
  assert.equal(normalizeImageQuality("hd", "dall-e-3"), "hd");
});
