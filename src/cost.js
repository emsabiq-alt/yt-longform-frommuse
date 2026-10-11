// Harga per gambar (USD). Dimensi pertama = IMAGE_MODEL, karena gpt-image-1
// ~4x lebih mahal dari gpt-image-1-mini pada kualitas yang sama.
// Sumber: platform.openai.com/docs/models/gpt-image-1{,-mini} (per image).
const imageUsd = {
  "gpt-image-1-mini": {
    "1024x1024": { low: 0.005, medium: 0.011, high: 0.036 },
    "1024x1536": { low: 0.006, medium: 0.015, high: 0.052 },
    "1536x1024": { low: 0.006, medium: 0.015, high: 0.052 }
  },
  "gpt-image-1": {
    "1024x1024": { low: 0.011, medium: 0.042, high: 0.167 },
    "1024x1536": { low: 0.016, medium: 0.063, high: 0.25 },
    "1536x1024": { low: 0.016, medium: 0.063, high: 0.25 }
  }
};

const DEFAULT_IMAGE_MODEL = "gpt-image-1-mini";

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

/**
 * @param {string} size - mis. "1536x1024"
 * @param {string} quality - low | medium | high (nilai lain → low)
 * @param {string} [model] - IMAGE_MODEL; tak dikenal → gpt-image-1-mini
 */
export function estimateImageUsd(size, quality, model = DEFAULT_IMAGE_MODEL) {
  const byModel = imageUsd[model] || imageUsd[DEFAULT_IMAGE_MODEL];
  const bySize = byModel[size] || byModel["1024x1536"];
  return bySize[quality] ?? bySize.low;
}

export function estimateTtsUsd(chars, provider, pricing) {
  const count = Math.max(0, Number(chars || 0));
  if (provider === "elevenlabs") return roundUsd((count / 1000) * pricing.elevenlabsTtsUsdPer1KChars);
  return roundUsd((count / 1_000_000) * pricing.openaiTtsUsdPer1MChars);
}

export function estimateVideoUsd(seconds, pricing) {
  return roundUsd(Math.max(0, Number(seconds || 0)) * pricing.videoUsdPerSecond);
}

export function estimateTotalCost({ promptText, outputText, sceneCount, imageSize, imageQuality, imageModel, narrationChars, ttsProvider, pricing }) {
  const inputTokens = estimateTokens(promptText);
  const outputTokens = estimateTokens(outputText);
  const storyUsd = (inputTokens / 1_000_000) * pricing.storyInputUsdPer1MTokens
    + (outputTokens / 1_000_000) * pricing.storyOutputUsdPer1MTokens;
  const imageUnitUsd = estimateImageUsd(imageSize, imageQuality, imageModel);
  const imageTotalUsd = sceneCount * imageUnitUsd;
  const ttsUsd = estimateTtsUsd(narrationChars, ttsProvider, pricing);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    storyUsd: roundUsd(storyUsd),
    imageUnitUsd: roundUsd(imageUnitUsd),
    imageUsd: roundUsd(imageTotalUsd),
    ttsUsd,
    totalUsd: roundUsd(storyUsd + imageTotalUsd + ttsUsd)
  };
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(5));
}
