import { config } from "./config.js";
import {
  requestIdeaJson as requestOpenAiIdeaJson,
  requestKnowledgeJson as requestOpenAiKnowledgeJson
} from "./openai.js";

function parseEnvelope(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/**
 * DeepSeek kadang masih membungkus JSON dengan markdown atau kalimat pendek.
 * Ambil object JSON dengan toleransi itu, tetapi tetap gagal jelas jika payload
 * benar-benar rusak agar provider fallback bisa mengambil alih.
 */
export function parseDeepSeekJson(content) {
  const raw = String(content || "").trim();
  if (!raw) throw new Error("DeepSeek mengembalikan respons kosong.");

  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch (firstError) {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // Lempar error awal dengan konteks singkat di bawah.
      }
    }
    throw new Error(`Respons DeepSeek bukan JSON valid: ${firstError.message}`);
  }
}

export async function requestDeepSeekJson(promptText, options = {}) {
  if (!config.deepseek.apiKey) throw new Error("DEEPSEEK_API_KEY belum diisi.");

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || config.deepseek.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        temperature: options.temperature ?? 0.8,
        messages: [
          {
            role: "system",
            content: options.system || "Return valid JSON only."
          },
          { role: "user", content: String(promptText || "") }
        ]
      })
    });

    const text = await response.text();
    const data = parseEnvelope(text);
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || data?.raw || response.statusText;
      throw new Error(`DeepSeek gagal: ${detail} [HTTP ${response.status}]`);
    }

    const content = data.choices?.[0]?.message?.content || "";
    return parseDeepSeekJson(content);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`DeepSeek timeout setelah ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithFallback(promptText, options) {
  const errors = [];

  if (config.deepseek.apiKey) {
    try {
      const data = await requestDeepSeekJson(promptText, options.deepseek);
      if (options.validate && !options.validate(data)) {
        throw new Error("Respons JSON tidak memiliki data yang bisa dipakai.");
      }
      console.log(`[AI] ${options.label}: DeepSeek aktif (${config.deepseek.model}).`);
      return { data, provider: "deepseek" };
    } catch (error) {
      errors.push(`DeepSeek: ${error.message}`);
      console.warn(`[AI] ${options.label}: DeepSeek gagal, mencoba fallback OpenAI: ${error.message}`);
    }
  }

  if (config.openai.apiKey) {
    try {
      const data = await options.openAi(promptText);
      if (options.validate && !options.validate(data)) {
        throw new Error("Respons JSON tidak memiliki data yang bisa dipakai.");
      }
      console.log(`[AI] ${options.label}: fallback OpenAI aktif (${config.openai.storyModel}).`);
      return { data, provider: "openai" };
    } catch (error) {
      errors.push(`OpenAI: ${error.message}`);
      console.warn(`[AI] ${options.label}: OpenAI fallback gagal: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | ") || "Tidak ada provider AI yang aktif.");
}

export function requestIdeaJsonWithFallback(promptText) {
  return requestWithFallback(promptText, {
    label: "ide/tren",
    deepseek: {
      timeoutMs: config.deepseek.ideaTimeoutMs,
      temperature: 0.92,
      system: "You are an Indonesian educational YouTube ideation analyst. Return valid JSON only."
    },
    openAi: requestOpenAiIdeaJson,
    validate: (data) => Array.isArray(data?.ideas) && data.ideas.length > 0
  });
}

export function requestTrendJsonWithFallback(promptText) {
  return requestWithFallback(promptText, {
    label: "tren",
    deepseek: {
      timeoutMs: config.deepseek.ideaTimeoutMs,
      temperature: 0.82,
      system: "You are an Indonesian YouTube trend analyst for an educational channel. Return valid JSON only."
    },
    openAi: requestOpenAiIdeaJson,
    validate: (data) => Boolean(data && (Array.isArray(data.themes) || Array.isArray(data.topKeywords)))
  });
}

export function requestKnowledgeJsonWithFallback(promptText) {
  return requestWithFallback(promptText, {
    label: "judul",
    deepseek: {
      timeoutMs: config.deepseek.ideaTimeoutMs,
      temperature: 0.72,
      system: "You are an Indonesian educational YouTube title specialist. Return valid JSON only."
    },
    openAi: requestOpenAiKnowledgeJson,
    validate: (data) => Array.isArray(data?.titles) && data.titles.length > 0
  });
}
