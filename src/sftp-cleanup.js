/**
 * SFTP/FTP cleanup — menjaga folder hosting tidak penuh.
 *
 * Dua aturan (digabung):
 *   1. UPLOADED: item yang sudah terupload ke YouTube → hapus aset video + gambar-nya
 *      setelah CLEANUP_UPLOADED_AGE_DAYS hari sejak publishedAt (default 1 = "esok harinya").
 *   2. AGE SWEEP: file apa pun di folder videos/images/audio/clips yang lebih tua dari
 *      CLEANUP_MAX_AGE_DAYS hari (default 7) → hapus.
 *
 * Yang TIDAK pernah disentuh: folder `thumbnails/` dan `state/` (items.json/memory.json).
 * Riwayat (items.json) dibiarkan utuh — hanya file media di hosting yang dibersihkan.
 *
 * Env:
 *   CLEANUP_MAX_AGE_DAYS=7  CLEANUP_UPLOADED_AGE_DAYS=1
 *   CLEANUP_DRY_RUN=true    (hanya laporan, tidak menghapus)
 *   CLEANUP_SWEEP_DIRS=videos,images,audio,clips
 *   PUBLIC_BASE_URL, kredensial SFTP/FTP (lihat remote.js)
 */
import { remoteConfig, assertRemoteConfig, withRemoteClient, publicBaseUrl } from "./remote.js";

const DAY_MS = 86_400_000;

function posNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

const MAX_AGE_DAYS = posNum(process.env.CLEANUP_MAX_AGE_DAYS, 7);
const UPLOADED_AGE_DAYS = posNum(process.env.CLEANUP_UPLOADED_AGE_DAYS, 1);
const DRY_RUN = isTruthy(process.env.CLEANUP_DRY_RUN);
const SWEEP_DIRS = String(process.env.CLEANUP_SWEEP_DIRS || "videos,images,audio,clips")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** Ambil nama file (segmen terakhir) dari URL/path aset. */
function basenameFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const last = noQuery.substring(noQuery.lastIndexOf("/") + 1);
  try { return decodeURIComponent(last); } catch { return last; }
}

/** Folder remote tempat aset berada, berdasar URL (videos/images/audio/clips/thumbnails). */
function dirFromUrl(value) {
  const raw = String(value || "");
  const m = raw.match(/\/(videos|images|audio|clips|thumbnails)\//);
  return m ? m[1] : "";
}

async function fetchItems(base) {
  if (!base) return [];
  const url = `${base.replace(/\/+$/g, "")}/state/items.json`;
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) {
      console.warn(`[cleanup] items.json tidak terbaca (HTTP ${res.status}) — lanjut age-sweep saja.`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(`[cleanup] gagal fetch items.json: ${error.message} — lanjut age-sweep saja.`);
    return [];
  }
}

function fmtBytes(bytes) {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function main() {
  const cfg = assertRemoteConfig();
  const base = publicBaseUrl();
  const now = Date.now();

  console.log(`[cleanup] driver=${cfg.driver} root=${cfg.remoteDir}`);
  console.log(`[cleanup] aturan: uploaded>${UPLOADED_AGE_DAYS}h hapus video+gambar | semua file>${MAX_AGE_DAYS}h di [${SWEEP_DIRS.join(", ")}]`);
  console.log(`[cleanup] mode: ${DRY_RUN ? "DRY-RUN (tidak menghapus)" : "LIVE (menghapus)"}`);

  // Aturan 1 — kumpulkan nama file aset milik item yang sudah diupload & cukup umur.
  const items = await fetchItems(base);
  const uploadedTargets = { videos: new Set(), images: new Set() };
  let uploadedItemCount = 0;
  for (const it of items) {
    const yt = it?.publish?.youtube?.url;
    if (!yt) continue;
    const ts = Date.parse(it.publish.youtube.publishedAt || it.updatedAt || it.createdAt || "");
    if (!Number.isFinite(ts)) continue;
    if (now - ts < UPLOADED_AGE_DAYS * DAY_MS) continue;
    uploadedItemCount += 1;
    const vid = basenameFromUrl(it.assets?.video?.url);
    if (vid && dirFromUrl(it.assets?.video?.url) === "videos") uploadedTargets.videos.add(vid);
    for (const img of it.assets?.images || []) {
      const name = basenameFromUrl(img?.url);
      if (name && dirFromUrl(img?.url) === "images") uploadedTargets.images.add(name);
    }
  }
  console.log(`[cleanup] item uploaded & >${UPLOADED_AGE_DAYS}h: ${uploadedItemCount} (target ${uploadedTargets.videos.size} video, ${uploadedTargets.images.size} gambar)`);

  const summary = { deleted: 0, bytes: 0, failed: 0, byDir: {} };

  await withRemoteClient(cfg, async (client) => {
    for (const dir of SWEEP_DIRS) {
      let entries;
      try {
        entries = await client.list(dir);
      } catch {
        continue; // folder belum ada → skip
      }
      const dirStat = { deleted: 0, bytes: 0, scanned: 0 };
      for (const entry of entries) {
        if (!entry.isFile) continue;
        dirStat.scanned += 1;
        const mtime = entry.modifiedAt ? new Date(entry.modifiedAt).getTime() : 0;
        const tooOld = mtime > 0 && now - mtime >= MAX_AGE_DAYS * DAY_MS;
        const uploadedHit = uploadedTargets[dir]?.has(entry.name);
        if (!tooOld && !uploadedHit) continue;

        const reason = uploadedHit ? "uploaded" : "age";
        const remotePath = `${dir}/${entry.name}`;
        if (DRY_RUN) {
          console.log(`[cleanup][DRY] would delete ${remotePath} (${fmtBytes(entry.size)}, ${reason})`);
          dirStat.deleted += 1; dirStat.bytes += entry.size || 0;
          continue;
        }
        try {
          await client.remove(remotePath);
          dirStat.deleted += 1; dirStat.bytes += entry.size || 0;
          console.log(`[cleanup] deleted ${remotePath} (${fmtBytes(entry.size)}, ${reason})`);
        } catch (error) {
          summary.failed += 1;
          console.warn(`[cleanup] GAGAL hapus ${remotePath}: ${error.message}`);
        }
      }
      summary.byDir[dir] = dirStat;
      summary.deleted += dirStat.deleted;
      summary.bytes += dirStat.bytes;
      console.log(`[cleanup] ${dir}: ${dirStat.deleted}/${dirStat.scanned} file ${DRY_RUN ? "akan dihapus" : "dihapus"} (${fmtBytes(dirStat.bytes)})`);
    }
  });

  console.log(`[cleanup] SELESAI — ${summary.deleted} file ${DRY_RUN ? "akan dibebaskan" : "dihapus"}, ${fmtBytes(summary.bytes)} dibebaskan${summary.failed ? `, ${summary.failed} gagal` : ""}.`);
}

main().catch((error) => {
  console.error(`[cleanup] ERROR: ${error.message}`);
  process.exit(1);
});
