/**
 * Emitter progres terstruktur untuk dipantau aplikasi lokal.
 * Mencetak baris yang mudah diparse: @@PROGRESS <json>@@
 *
 * stage  : kunci tahap (script|images|audio|thumbnail|render|upload|publish|done)
 * label  : teks tahap untuk ditampilkan
 * percent: 0-100 progres tahap saat ini (boleh null)
 * detail : keterangan singkat (mis. "scene 3/14")
 * overall: 0-100 progres total (opsional)
 */

const STAGE_WEIGHTS = {
  script: 8,
  images: 30,
  audio: 30,
  thumbnail: 4,
  render: 20,
  upload: 5,
  publish: 3
};
const STAGE_ORDER = ["script", "images", "audio", "thumbnail", "render", "upload", "publish"];

function overallPercent(stage, percent) {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx < 0) return null;
  let base = 0;
  for (let i = 0; i < idx; i += 1) base += STAGE_WEIGHTS[STAGE_ORDER[i]] || 0;
  const within = (STAGE_WEIGHTS[stage] || 0) * (Math.max(0, Math.min(100, Number(percent || 0))) / 100);
  return Math.round(base + within);
}

export function reportProgress(stage, label, percent = null, detail = "") {
  const overall = overallPercent(stage, percent ?? 100);
  const payload = { stage, label, percent: percent === null ? null : Math.round(percent), detail, overall, at: Date.now() };
  process.stdout.write(`@@PROGRESS ${JSON.stringify(payload)}@@\n`);
}

export function reportStageDone(stage, label) {
  reportProgress(stage, label, 100, "selesai");
}
