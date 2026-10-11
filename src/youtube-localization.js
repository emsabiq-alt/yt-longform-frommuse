import { config } from "./config.js";

const DEFAULT_LANGUAGE = "id";
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

const LANGUAGE_LABELS = {
  en: "English",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese",
  hi: "Hindi",
  bn: "Bengali",
  ar: "Arabic",
  fr: "French",
  ja: "Japanese",
  de: "German",
  tr: "Turkish",
  ko: "Korean",
  zh: "Chinese"
};

function clean(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeLanguage(value) {
  const parts = clean(value, 20).split("-");
  const language = (parts.shift() || "").toLowerCase();
  const region = parts.join("-").toUpperCase();
  return region ? `${language}-${region}` : language;
}

export function normalizeLanguageList(languages, defaultLanguage = DEFAULT_LANGUAGE) {
  const primary = normalizeLanguage(defaultLanguage) || DEFAULT_LANGUAGE;
  const source = Array.isArray(languages) ? languages : String(languages || "").split(",");
  const seen = new Set([primary]);
  return source.map(normalizeLanguage).filter((language) => {
    if (!/^[a-z]{2,3}(?:-[A-Z]{2,4})?$/.test(language) || seen.has(language)) return false;
    seen.add(language);
    return true;
  });
}

export function buildTranslationPrompt({ title, description, languages }) {
  const languageRows = languages.map((language) => (
    `- ${language}: ${LANGUAGE_LABELS[language] || language}`
  )).join("\n");
  return [
    "You translate YouTube metadata for a factual educational video.",
    "The source metadata is Indonesian. Translate naturally for native viewers, preserving the original meaning and a compelling but accurate tone.",
    "Return JSON only, with exactly one object per requested language and exactly these fields: title and description.",
    "Do not add explanations, markdown fences, emojis, or new claims.",
    "Keep every URL (http/https), hashtag, timestamp, media credit, and source link unchanged. Do not translate or modify URLs.",
    "Keep titles concise (ideally under 70 characters) and descriptions readable.",
    "Requested languages:",
    languageRows,
    "",
    `SOURCE_TITLE: ${clean(title, MAX_TITLE_LENGTH)}`,
    "SOURCE_DESCRIPTION:",
    clean(description, MAX_DESCRIPTION_LENGTH)
  ].join("\n");
}

export function parseTranslationPayload(content, languages) {
  const raw = String(content || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(unfenced);
  } catch (error) {
    throw new Error(`Respons DeepSeek bukan JSON valid: ${error.message}`);
  }

  const result = {};
  for (const language of languages) {
    const row = parsed?.[language];
    const title = clean(row?.title, MAX_TITLE_LENGTH);
    const description = clean(row?.description, MAX_DESCRIPTION_LENGTH);
    if (!title || !description) continue;
    result[language] = { title, description };
  }
  if (!Object.keys(result).length) {
    throw new Error("DeepSeek tidak mengembalikan judul/deskripsi terjemahan.");
  }
  return result;
}

function protectedTokens(source) {
  return [...new Set([
    ...(String(source || "").match(/https?:\/\/[^\s)]+/g) || []),
    ...(String(source || "").match(/#[\p{L}\p{N}_-]+/gu) || [])
  ])];
}

function preserveTokens(source, translated) {
  let output = clean(translated, MAX_DESCRIPTION_LENGTH);
  const missing = protectedTokens(source).filter((token) => !output.includes(token));
  if (missing.length) {
    output = `${output}\n\n${missing.join(" ")}`.slice(0, MAX_DESCRIPTION_LENGTH).trim();
  }
  return output;
}

export function normalizeLocalizations(localizations, sourceDescription = "") {
  const output = {};
  for (const [rawLanguage, value] of Object.entries(localizations || {})) {
    const language = normalizeLanguage(rawLanguage);
    const title = clean(value?.title, MAX_TITLE_LENGTH);
    const description = preserveTokens(sourceDescription, value?.description);
    if (!language || language === DEFAULT_LANGUAGE || !title || !description) continue;
    output[language] = { title, description };
  }
  return output;
}

function chunk(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function requestDeepSeekBatch({ title, description, languages }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.deepseek.timeoutMs);
  try {
    const response = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.deepseek.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        response_format: { type: "json_object" },
        temperature: 0.35,
        messages: [
          {
            role: "system",
            content: "You are a precise multilingual YouTube metadata translator. Output valid JSON only."
          },
          { role: "user", content: buildTranslationPrompt({ title, description, languages }) }
        ]
      })
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || data?.raw || response.statusText;
      throw new Error(`DeepSeek gagal: ${detail} [HTTP ${response.status}]`);
    }
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = parseTranslationPayload(content, languages);
    return {
      ok: true,
      localizations: normalizeLocalizations(parsed, description)
    };
  } catch (error) {
    const message = error?.name === "AbortError"
      ? `DeepSeek timeout setelah ${config.deepseek.timeoutMs} ms.`
      : error.message;
    return { ok: false, reason: message, localizations: {} };
  } finally {
    clearTimeout(timer);
  }
}

export async function translateYoutubeMetadata({ title, description, languages } = {}) {
  if (!config.youtube.localizationEnabled) {
    return { ok: true, skipped: true, reason: "Lokalisasi YouTube dinonaktifkan.", localizations: {} };
  }
  if (!config.deepseek.apiKey) {
    return { ok: true, skipped: true, reason: "DEEPSEEK_API_KEY belum diisi.", localizations: {} };
  }

  const requested = normalizeLanguageList(
    languages || config.youtube.localizationLanguages,
    config.youtube.defaultLanguage
  );
  if (!requested.length) {
    return { ok: true, skipped: true, reason: "Tidak ada bahasa lokalisasi yang diminta.", localizations: {} };
  }

  const combined = {};
  const errors = [];
  const batches = chunk(requested, config.deepseek.languagesPerRequest);
  for (const batch of batches) {
    const result = await requestDeepSeekBatch({ title, description, languages: batch });
    if (!result.ok) {
      errors.push(result.reason);
      continue;
    }
    Object.assign(combined, result.localizations);
  }

  const languagesReturned = Object.keys(combined);
  if (errors.length) {
    return {
      ok: false,
      skipped: false,
      model: config.deepseek.model,
      languages: languagesReturned,
      reason: `${errors.length}/${batches.length} batch DeepSeek gagal: ${errors.join("; ")}`,
      localizations: combined
    };
  }
  return {
    ok: true,
    skipped: false,
    model: config.deepseek.model,
    languages: languagesReturned,
    localizations: combined
  };
}
