import {
  check,
  clean,
  configSummary,
  getRecentRuns,
  methodAllowed,
  readState,
  remoteConfig,
  remoteMissingEnv,
  requireAuth,
  sendError,
  sendJson
} from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET", "POST"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const state = await readState();
    const runs = await getRecentRuns(1);
    const remote = remoteConfig();
    const missingRemote = remoteMissingEnv(remote);
    const cfg = configSummary();

    const pin = clean(process.env.AUTO_DASHBOARD_PIN);
    const checks = [
      check("Dashboard PIN", Boolean(pin), "PIN aktif"),
      check("PIN kuat", pin.length >= 12, pin.length >= 12 ? "panjang memadai" : "Disarankan PIN ≥ 12 karakter acak (anti brute-force).", false),
      check("Session secret", Boolean(clean(process.env.DASHBOARD_SESSION_SECRET)), clean(process.env.DASHBOARD_SESSION_SECRET) ? "diset" : "opsional: set DASHBOARD_SESSION_SECRET untuk token sesi mandiri.", false),
      check("PUBLIC_BASE_URL", Boolean(cfg.publicBaseUrl), cfg.publicBaseUrl || "belum diset"),
      check(`${remote.label} credential`, missingRemote.length === 0, missingRemote.length ? `missing: ${missingRemote.join(", ")}` : "untuk update queue & state"),
      check("Workflow token", Boolean(clean(process.env.GH_REPO_SECRET_TOKEN || process.env.GITHUB_TOKEN)), "untuk tombol Generate"),
      check("YouTube upload", cfg.youtubeEnabled, cfg.youtubeEnabled ? `limit ${cfg.youtubeDailyUploadLimit}/hari` : "YOUTUBE_UPLOAD_ENABLED=false", false),
      check("state/items.json", Array.isArray(state.items), `${(state.items || []).length} video terbaca`),
      check("Workflow API", runs.length > 0, runs[0]?.html_url || "belum ada run terbaca", false),
      check("Repo & workflow", true, `${cfg.repo} · ${cfg.workflow}`)
    ];

    sendJson(res, 200, { checks, config: cfg });
  } catch (error) {
    sendError(res, error, 500);
  }
}
