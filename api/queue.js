import {
  buildQueueItem,
  clientError,
  dispatchWorkflow,
  methodAllowed,
  readBody,
  readStateFile,
  removeById,
  requireAuth,
  sendError,
  sendJson,
  uploadStateFile,
  upsertById
} from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST", "DELETE"])) return;
  if (!requireAuth(req, res)) return;

  try {
    if (req.method === "GET") {
      sendJson(res, 200, await readStateFile("queue.json"));
      return;
    }

    if (req.method === "DELETE") {
      const body = await readBody(req);
      const id = String(body.id || "");
      if (!id) throw clientError("id wajib diisi untuk menghapus.", 400);
      const queue = removeById(await readStateFile("queue.json"), id);
      await uploadStateFile("queue.json", queue);
      sendJson(res, 200, { ok: true, queue });
      return;
    }

    const body = await readBody(req);
    const item = buildQueueItem(body);
    const queue = upsertById(await readStateFile("queue.json"), item);
    await uploadStateFile("queue.json", queue);

    if (body.run_now === true || body.run_now === "true") {
      const dynamicScenes = item.dynamicScenes === true;
      // ponytail: workflow_dispatch tidak punya input tren terpisah; pakai envelope JSON sampai kontrak workflow boleh ditambah.
      const envelope = item.trend ? { topic: item.topic, trend: item.trend } : null;
      if (envelope && dynamicScenes) envelope.dynamicScenes = true;
      await dispatchWorkflow({
        topic: envelope ? JSON.stringify(envelope) : item.topic,
        category: item.category || "random",
        format_type: item.formatType || "",
        duration: String(item.durationSec),
        scenes: dynamicScenes ? "" : String(item.sceneCount),
        tts_provider: item.ttsProvider,
        tts_voice: item.ttsVoice,
        image_quality: item.imageQuality,
        resolution: item.resolution || "1080p",
        force: "true"
      });
      item.status = "dispatched";
      const updated = upsertById(queue, item);
      await uploadStateFile("queue.json", updated);
    }

    sendJson(res, 200, item);
  } catch (error) {
    sendError(res, error, 400);
  }
}
