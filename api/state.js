import { configSummary, getRecentRuns, getRunJobs, methodAllowed, readState, requireAuth, sendError, sendJson } from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["GET"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const [state, recentRuns] = await Promise.all([readState(), getRecentRuns()]);
    const latestRun = recentRuns[0] || null;

    let activeRun = null;
    if (latestRun) {
      const isLive = latestRun.status === "in_progress" || latestRun.status === "queued";
      const liveJobs = isLive ? await getRunJobs(latestRun.id) : [];
      activeRun = buildActiveRun(latestRun, liveJobs);
    }

    const items = (state.items || []).slice().sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    sendJson(res, 200, {
      config: configSummary(),
      activeRun,
      recentRuns,
      items,
      queue: state.queue || [],
      stats: buildStats(items, configSummary().timezone)
    });
  } catch (error) {
    sendError(res, error, 500);
  }
}

function buildStats(items, timezone) {
  const uploaded = items.filter((it) => it?.publish?.youtube?.url).length;
  const rendered = items.filter((it) => it?.status === "rendered" || it?.assets?.video?.url).length;
  const failed = items.filter((it) => it?.publish?.errors?.youtube).length;
  const today = localDayKey(new Date(), timezone);
  const todayCount = items.filter((it) => localDayKey(new Date(it.createdAt || it.updatedAt || 0), timezone) === today).length;
  const totalCost = items.reduce((sum, it) => sum + Number(it?.cost?.totalUsd || 0), 0);
  const totalDuration = items.reduce((sum, it) => sum + Number(it?.assets?.video?.durationSec || 0), 0);
  return {
    total: items.length,
    rendered,
    uploaded,
    failed,
    todayCount,
    totalCostUsd: Number(totalCost.toFixed(4)),
    totalDurationSec: Math.round(totalDuration)
  };
}

function localDayKey(date, timezone = "Asia/Bangkok") {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function buildActiveRun(run, liveJobs) {
  const allSteps = liveJobs.flatMap((job) => (job.steps || []).map((step) => ({ ...step, jobName: job.name })));
  const total = allSteps.length;
  const completed = allSteps.filter((s) => s.status === "completed").length;
  const inProgress = allSteps.filter((s) => s.status === "in_progress");
  const progress = total ? Math.round((completed / total) * 100) : null;
  const status = run.status === "in_progress" || run.status === "queued" ? "running" : run.conclusion || run.status;

  const sortedSteps = [...allSteps].sort((a, b) => String(a.started_at || "").localeCompare(String(b.started_at || "")));
  const stepLogs = sortedSteps
    .filter((step) => step.status !== "queued" && step.started_at)
    .flatMap((step) => {
      const lines = [{ at: step.started_at, level: "running", text: `${step.jobName} → ${step.name}` }];
      if (step.status === "completed") {
        const seconds = step.completed_at && step.started_at
          ? Math.max(0, Math.round((new Date(step.completed_at) - new Date(step.started_at)) / 1000)) : null;
        const failed = step.conclusion === "failure" || step.conclusion === "cancelled";
        lines.push({
          at: step.completed_at || step.started_at,
          level: failed ? "error" : "done",
          text: `${step.jobName} → ${step.name} ${step.conclusion || "done"}${seconds !== null ? ` (${seconds}s)` : ""}`
        });
      }
      return lines;
    });

  const headerLog = { at: run.created_at, level: "system", text: `${run.name || "Workflow"} ${run.status}${run.conclusion ? `/${run.conclusion}` : ""}` };
  const currentStep = inProgress[0] || null;
  const detail = currentStep ? `Sedang: ${currentStep.jobName} → ${currentStep.name}`
    : status === "running" ? "Workflow di-trigger, menunggu runner." : run.display_title || run.html_url;

  return {
    id: String(run.id),
    name: run.name || "Workflow",
    title: run.display_title || "",
    status,
    conclusion: run.conclusion || "",
    startedAt: run.created_at,
    finishedAt: run.status === "completed" ? run.updated_at : "",
    htmlUrl: run.html_url,
    detail,
    progress,
    totalSteps: total,
    completedSteps: completed,
    logs: [headerLog, ...stepLogs],
    error: run.conclusion === "failure" ? "GitHub Actions gagal. Buka link run untuk detail." : ""
  };
}
