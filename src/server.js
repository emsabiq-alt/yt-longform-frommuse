import express from "express";
import { ensureProjectDirs, paths, publicConfig, updateRuntimeSettings, config } from "./config.js";
import {
  assertReadyToRender,
  ensureLongformSceneAudio,
  ensureThumbnail,
  ensureVisualAssets,
  ffmpegAvailable,
  generateFullItem,
  renderAndPersist
} from "./pipeline.js";
import { listItems, saveItem, getItem } from "./storage.js";
import { createLongformDraft } from "./longform-story-engine.js";
import { nowIso } from "./util.js";
import { fetchSustainedNewsTopics, SUSTAINED_NEWS_CRITERIA, SUSTAINED_NEWS_MEDIA } from "./google-news-trends.js";

ensureProjectDirs();

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(paths.publicDir));
app.use("/generated", express.static(paths.generatedDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, config: publicConfig(), tools: { ffmpeg: ffmpegAvailable() } });
});

app.use("/api", requireDashboardPin);

app.get("/api/state", async (_req, res, next) => {
  try {
    res.json({ config: publicConfig(), items: await listItems() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/trends", async (_req, res, next) => {
  try {
    res.json({
      fetchedAt: new Date().toISOString(),
      criteria: SUSTAINED_NEWS_CRITERIA,
      media: SUSTAINED_NEWS_MEDIA,
      topics: await fetchSustainedNewsTopics()
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/items", async (_req, res, next) => {
  try {
    res.json({ items: await listItems() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/items/:id", async (req, res, next) => {
  try {
    const item = await getItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Item tidak ditemukan." });
      return;
    }
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (req, res, next) => {
  try {
    res.json({ config: await updateRuntimeSettings(req.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/full", async (req, res, next) => {
  try {
    res.json(await generateFullItem(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (req, res, next) => {
  try {
    const item = await createLongformDraft(req.body || {});
    await saveItem(item);
    res.json({ item });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items/:id/render", async (req, res, next) => {
  try {
    const item = await requireItem(req.params.id);
    const warnings = [];
    if (req.body?.ensureAssets !== false) {
      await ensureVisualAssets(item, { warnings, strict: true });
      await ensureLongformSceneAudio(item, { provider: req.body?.provider || item.input.ttsProvider, warnings, strict: true });
      if (config.thumbnail?.enabled) {
        await ensureThumbnail(item, { warnings });
      }
    }
    assertReadyToRender(item);
    await renderAndPersist(item);
    res.json({ item, warnings });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

// ---------- SSE: trigger run:once with realtime progress ----------
import { spawn } from "node:child_process";
import path from "node:path";

let activeRun = null;

app.get("/api/run-status", (_req, res) => {
  res.json({ running: !!activeRun, pid: activeRun?.pid || null });
});

app.post("/api/run-local", (req, res) => {
  if (activeRun) {
    res.status(409).json({ error: "Sudah ada proses berjalan." });
    return;
  }
  const body = req.body || {};
  const args = [
    "src/run-once.js",
    "--topic", body.topic || "",
    "--category", body.category || "random",
    "--duration", String(body.durationSec || config.automation.durationSec),
    "--scenes", String(body.sceneCount || config.automation.sceneCount),
    "--tts-provider", body.ttsProvider || "openai",
    "--tts-voice", body.ttsVoice || config.openai.ttsVoice,
    "--image-quality", body.imageQuality || config.openai.imageQuality,
    "--force", "true"
  ];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const proc = spawn("node", args, {
    cwd: paths.rootDir,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  activeRun = { pid: proc.pid };
  send("status", { running: true, pid: proc.pid });

  let buffer = "";
  const processLine = (line) => {
    if (line.includes("@@PROGRESS")) {
      try {
        const start = line.indexOf("@@PROGRESS") + "@@PROGRESS".length;
        const end = line.lastIndexOf("@@");
        const data = JSON.parse(line.substring(start, end).trim());
        send("progress", data);
      } catch { /* ignore parse errors */ }
    } else if (line.includes("@@LOCAL_OUTPUT")) {
      try {
        const start = line.indexOf("@@LOCAL_OUTPUT") + "@@LOCAL_OUTPUT".length;
        const end = line.lastIndexOf("@@");
        const data = JSON.parse(line.substring(start, end).trim());
        send("output", data);
      } catch { /* ignore */ }
    } else if (line.trim()) {
      send("log", { text: line });
    }
  };

  const onData = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  };

  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

  proc.on("close", (code) => {
    if (buffer.trim()) processLine(buffer);
    activeRun = null;
    send("done", { code, success: code === 0 });
    res.end();
  });

  req.on("close", () => {
    // Client disconnected — kill the process
    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
      activeRun = null;
    }
  });
});

// Serve app directory
app.use("/app", express.static(path.join(paths.rootDir, "app", "web")));

app.listen(config.port, () => {
  console.log(`YT Longform Studio running at http://localhost:${config.port}`);
  console.log(`Local Dashboard: http://localhost:${config.port}/app`);
});

async function requireItem(id) {
  const item = await getItem(id);
  if (!item) {
    const error = new Error("Item tidak ditemukan.");
    error.status = 404;
    throw error;
  }
  return item;
}

function requireDashboardPin(req, res, next) {
  const expected = String(config.dashboardPin || "123456").trim();
  const provided = String(req.headers["x-dashboard-pin"] || req.query.pin || "").trim();
  if (!expected || provided === expected) return next();
  res.status(401).json({ error: "PIN dashboard tidak valid." });
}
