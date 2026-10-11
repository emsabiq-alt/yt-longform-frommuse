import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTranslationPrompt,
  normalizeLanguageList,
  normalizeLocalizations,
  parseTranslationPayload
} from "../src/youtube-localization.js";

test("normalizeLanguageList menghapus bahasa utama dan duplikat", () => {
  assert.deepEqual(
    normalizeLanguageList(["id", "en", "pt-br", "en", "hi"], "id"),
    ["en", "pt-BR", "hi"]
  );
});

test("parseTranslationPayload menerima JSON dari DeepSeek", () => {
  const result = parseTranslationPayload(
    "```json\n{\"en\":{\"title\":\"Why Ice Floats\",\"description\":\"A fact: https://example.com #Science\"}}\n```",
    ["en"]
  );
  assert.equal(result.en.title, "Why Ice Floats");
  assert.match(result.en.description, /https:\/\/example\.com/);
});

test("normalizeLocalizations mempertahankan URL dan hashtag", () => {
  const source = "Sumber: https://id.wikipedia.org/wiki/Es\n#Pengetahuan";
  const result = normalizeLocalizations({
    en: { title: "Why Ice Floats", description: "Ice is less dense." }
  }, source);
  assert.match(result.en.description, /https:\/\/id\.wikipedia\.org\/wiki\/Es/);
  assert.match(result.en.description, /#Pengetahuan/);
});

test("buildTranslationPrompt menyebut format JSON dan bahasa target", () => {
  const prompt = buildTranslationPrompt({
    title: "Kenapa Es Mengapung",
    description: "Penjelasan singkat.",
    languages: ["en", "hi"]
  });
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /English/);
  assert.match(prompt, /Hindi/);
});

