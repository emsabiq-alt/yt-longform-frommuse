import { clampNum, clampStr, clean, dispatchWorkflow, makeId, methodAllowed, normalizeTrendInput, readBody, requireAuth, sendError, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const body = await readBody(req);
    const ttsProviderRaw = clean(body.ttsProvider || "openai").toLowerCase();
    const ttsProvider = ttsProviderRaw === "elevenlabs" || ttsProviderRaw === "groq" ? ttsProviderRaw : "openai";
    const defaultTtsVoice = ttsProvider === "elevenlabs"
      ? process.env.ELEVENLABS_VOICE_ID || "wUrGnU2Kx934kbDdOWDo"
      : ttsProvider === "groq"
        ? process.env.GROQ_TTS_VOICE || "troy"
        : process.env.OPENAI_TTS_VOICE || "nova";
    const topic = clampStr(body.topic || "", 300);
    const trend = normalizeTrendInput(body.trendContext || body.trend);
    const dynamicScenes = body.dynamicScenes === true || body.dynamicScenes === "true";
    // Embed trend + dynamicScenes flag inside topic JSON envelope for story engine
    let topicInput = topic;
    if (trend) {
      const envelope = { topic, trend };
      if (dynamicScenes) envelope.dynamicScenes = true;
      topicInput = JSON.stringify(envelope);
    }
    const durationNum = clampNum(body.durationSec || body.duration || process.env.YT_DURATION_SEC || 1200, 300, 1200, 1200);
    const defaultScenes = Math.round(durationNum / 33);
    const rawScenes = body.sceneCount || body.scenes || process.env.YT_SCENE_COUNT || defaultScenes;
    const inputs = {
      topic: topicInput,
      category: clampStr(body.category || "random", 80),
      format_type: clampStr(body.formatType || body.format_type || "", 40),
      duration: String(durationNum),
      scenes: dynamicScenes ? "" : String(clampNum(rawScenes, 8, 48, defaultScenes)),
      tts_provider: ttsProvider,
      tts_voice: clampStr(body.ttsVoice || defaultTtsVoice, 80),
      image_quality: clampStr(body.imageQuality || "low", 20),
      resolution: clampStr(body.resolution || "1080p", 10),
      force: body.force === true || body.force === "true" ? "true" : "false"
    };

    const dispatch = await dispatchWorkflow(inputs);
    sendJson(res, 200, {
      id: makeId("run"),
      status: "queued",
      startedAt: new Date().toISOString(),
      result: { status: "workflow_dispatch_queued", ...dispatch },
      logs: [{ at: new Date().toISOString(), level: "system", text: "Workflow ter-trigger. Refresh beberapa detik lagi untuk memantau progres." }]
    });
  } catch (error) {
    sendError(res, error, 400);
  }
}
