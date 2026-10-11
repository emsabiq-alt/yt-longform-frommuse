/**
 * YouTube Meta - membangun judul, deskripsi, dan tag siap-copy dari item.
 * Tidak memanggil API; murni menyusun dari naskah yang sudah ada.
 */

import { cleanText } from "./util.js";
import { buildChapterList } from "./longform-render.js";

function oneLine(value, max = 5000) {
  return cleanText(String(value || "").replace(/\s+/g, " "), max).trim();
}

function titleCase(value) {
  const t = oneLine(value, 100);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Hapus awalan deskriptif yang membosankan agar judul langsung menggigit. */
function cleanCuriosity(value) {
  return value
    .replace(/^(Apa Itu|Penjelasan Tentang|Pembahasan|Analisis)\s+/i, "")
    .replace(/\s*[—–-]\s*(Sebuah|Suatu)?\s*(Analisis|Pembahasan|Penjelasan|Studi).*$/i, "")
    .trim();
}

/** Judul: maksimal 65 char, singkat padat bikin penasaran. */
export function buildTitle(item) {
  const raw = oneLine(item.title || item.plan?.title || item.input?.topic || "Fakta Menarik", 100);
  let title = titleCase(cleanCuriosity(raw));
  // Potong di 65 karakter agar tampil penuh di YouTube search & mobile
  if (title.length > 65) {
    const cut = title.slice(0, 65);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 35 ? cut.slice(0, lastSpace) : cut).trim();
    // Pastikan tidak berakhir di kata sambung
    title = title.replace(/\s+(yang|dan|di|ke|dari|untuk|pada|atau|ini|itu)$/i, "").trim();
  }
  // Hapus tanda baca ganda di akhir
  title = title.replace(/[?.!]{2,}$/, (m) => m[0]);
  return title;
}

/** Tag dari kata kunci judul + kategori + trending keywords. */
export function buildTags(item) {
  const stop = new Set(["yang", "dan", "di", "ke", "dari", "untuk", "pada", "kenapa",
    "mengapa", "bisa", "adalah", "itu", "ini", "apa", "bagaimana", "padahal", "the", "of"]);
  const fromTitle = oneLine(item.title || "", 200).toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F ]+/gi, " ")
    .split(" ")
    .filter((w) => w.length > 3 && !stop.has(w));
  const base = ["edukasi", "pengetahuan", "fakta menarik", "belajar",
    oneLine(item.input?.category || "", 40)].filter(Boolean);
  const trendingKw = Array.isArray(item.input?.trendingKeywords)
    ? item.input.trendingKeywords.filter((kw) => kw && kw.length > 2 && kw.length < 40)
    : [];
  const all = [...new Set([...base, ...trendingKw.slice(0, 5), ...fromTitle])].slice(0, 18);
  return all;
}

/**
 * Deskripsi YouTube lengkap & rapi:
 * hook -> ringkasan -> poin -> timestamp opsional -> ajakan -> tag hashtag.
 */
export function buildDescription(item) {
  const hook = oneLine(item.plan?.hook || "", 400);
  const summary = oneLine(item.plan?.summary || "", 600);
  const points = (item.plan?.importantPoints || [])
    .slice(0, 6)
    .map((p) => `\u2705 ${oneLine(p, 140)}`)
    .filter(Boolean)
    .join("\n");

  const chapters = buildChapters(item);
  const sources = buildSourcesBlock(item);
  let mediaAttribution = buildMediaAttributionBlock(item);
  const tags = buildTags(item);
  const hashtags = tags.slice(0, 6).map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");

  const chaptersBlock = chapters ? `Bab:\n${chapters}` : "";
  const pointsBlock = points ? `Yang akan kamu pahami:\n${points}` : "";
  const ctaBlock = [
    "Tonton sampai habis supaya gambaran lengkapnya nyambung.",
    "Kalau bermanfaat, like dan subscribe untuk video pengetahuan lainnya."
  ].join("\n");

  // Blok wajib penonton & SEO yang TIDAK BOLEH dipotong:
  // Hook, Poin, BAB / TIMESTAMPS, CTA, Sumber, Hashtags
  let activeSummary = summary;

  const assemble = (sum, attr) => {
    const top = [
      hook || item.title,
      sum,
      pointsBlock,
      chaptersBlock,
      ctaBlock
    ].filter(Boolean).join("\n\n");

    const bottom = [
      sources,
      attr,
      hashtags
    ].filter(Boolean).join("\n\n");

    return [top, bottom].filter(Boolean).join("\n\n");
  };

  let desc = assemble(activeSummary, mediaAttribution);

  // Jika melebihi batas 4900 karakter YouTube:
  // 1. Pangkas mediaAttribution terlebih dahulu
  if (desc.length > 4900 && mediaAttribution) {
    const overflow = desc.length - 4900;
    const targetAttrLen = Math.max(150, mediaAttribution.length - overflow - 40);
    mediaAttribution = mediaAttribution.slice(0, targetAttrLen).trim() + "\n...dan aset berlisensi lainnya.";
    desc = assemble(activeSummary, mediaAttribution);
  }

  // 2. Jika masih melebihi batas, pangkas ringkasan (summary)
  if (desc.length > 4900 && activeSummary) {
    const overflow = desc.length - 4900;
    const targetSumLen = Math.max(80, activeSummary.length - overflow - 20);
    activeSummary = activeSummary.slice(0, targetSumLen).trim() + "...";
    desc = assemble(activeSummary, mediaAttribution);
  }

  return desc.slice(0, 4900);
}

/**
 * Blok atribusi sumber fakta. Wikipedia berlisensi CC BY-SA sehingga wajib
 * dicantumkan saat naskah memakai faktanya. Kosong bila tidak ada sumber.
 */
export function buildSourcesBlock(item) {
  const rawSources = Array.isArray(item.plan?.sources) ? item.plan.sources : [];
  const seen = new Set();
  const valid = [];
  for (const source of rawSources) {
    const url = oneLine(source?.url, 300);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    valid.push({ title: oneLine(source?.title, 160), url });
    if (valid.length >= 5) break;
  }
  if (!valid.length) return "";
  const lines = valid.map((s) => `• ${s.title ? `${s.title}: ` : ""}${s.url}`).join("\n");
  return `Sumber & referensi fakta:\n${lines}\nSebagian fakta dirangkum dari Wikipedia (lisensi CC BY-SA).`;
}

/**
 * Atribusi visual berlisensi terbuka (Wikimedia Commons, Openverse, Wikidata, Pixabay).
 * Semua aset tetap dicantumkan agar asal-usul media dapat diaudit.
 * Dibatasi maksimal 10 entri agar tidak meluap menghabiskan jatah karakter deskripsi.
 */
const ATTRIBUTION_PROVIDERS = new Set(["wikimedia", "openverse", "wikidata", "pixabay"]);

export function buildMediaAttributionBlock(item) {
  const rawAssets = [
    ...(item.assets?.clips || []),
    ...(item.assets?.images || [])
  ].filter((asset) => (
    ATTRIBUTION_PROVIDERS.has(String(asset?.provider || ""))
    && oneLine(asset.sourceUrl, 400)
  ));
  const seen = new Set();
  const assets = [];
  for (const asset of rawAssets) {
    const isPixabay = asset.provider === "pixabay";
    const pageId = !isPixabay ? oneLine(asset.wikimediaPageId, 40) : "";
    const sourceUrl = pageId
      ? `https://commons.wikimedia.org/?curid=${encodeURIComponent(pageId)}`
      : oneLine(asset.sourceUrl, 300);
    const key = pageId || sourceUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    assets.push({
      title: oneLine(asset.title || asset.pixabayTags || asset.wikimediaPageTitle || (isPixabay ? "Media Pixabay" : "Media berlisensi terbuka"), 80),
      creator: oneLine(asset.creator || (isPixabay ? (asset.user || "Kontributor Pixabay") : "Kontributor Wikimedia Commons"), 80),
      license: oneLine(asset.license || (isPixabay ? "Pixabay Content License" : "Lisensi pada halaman sumber"), 50),
      licenseUrl: oneLine(asset.licenseUrl || (isPixabay ? "https://pixabay.com/service/license-summary/" : ""), 300),
      sourceUrl
    });
  }
  if (!assets.length) return "";

  // Batasi daftar media agar tidak membengkak ribuan karakter di deskripsi YouTube
  const maxDisplayed = 10;
  const displayedAssets = assets.slice(0, maxDisplayed);
  const lines = displayedAssets.map((asset) => (
    `• ${asset.title} — ${asset.creator} — ${asset.license} — ${asset.sourceUrl}`
  ));
  if (assets.length > maxDisplayed) {
    lines.push(`• ...dan ${assets.length - maxDisplayed} media berlisensi terbuka lainnya.`);
  }

  const licenseLinks = [];
  const seenLicenses = new Set();
  for (const asset of assets) {
    if (!asset.licenseUrl) continue;
    const key = `${asset.license}|${asset.licenseUrl}`;
    if (seenLicenses.has(key)) continue;
    seenLicenses.add(key);
    licenseLinks.push(`• ${asset.license}: ${asset.licenseUrl}`);
  }
  // Judul menyesuaikan isi: tetap "Wikimedia Commons" selama semua aset dari
  // Commons (menjaga deskripsi lama tidak berubah), jadi generik begitu ada
  // sumber lain seperti Flickr atau museum lewat Openverse.
  const commonsOnly = assets.every((asset) => asset.sourceUrl.includes("commons.wikimedia.org"));
  return [
    commonsOnly ? "Kredit media Wikimedia Commons:" : "Kredit media berlisensi terbuka:",
    lines.join("\n"),
    "Media dipotong, diubah ukuran, atau disesuaikan untuk video ini.",
    licenseLinks.length ? `Tautan lisensi:\n${licenseLinks.join("\n")}` : ""
  ].filter(Boolean).join("\n");
}

/** Timestamp bab dari timeline render (kalau ada) atau estimasi storyboard. */
export function buildChapters(item) {
  const render = Array.isArray(item.assets?.video?.chapters) ? item.assets.video.chapters : null;
  if (render?.length) {
    return render.map((c) => `${c.time} ${c.label}`).join("\n");
  }

  // Fallback ke estimasi storyboard jika belum dirender / item.assets.video.chapters kosong
  const scenes = Array.isArray(item.plan?.scenes) ? item.plan.scenes : [];
  if (scenes.length >= 3) {
    const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.durationSec) || 30), 0);
    let cursor = 0;
    const timedScenes = scenes.map((s) => {
      const st = cursor;
      cursor += Number(s.durationSec) || 30;
      return { ...s, startSec: st };
    });
    const fallbackList = buildChapterList(timedScenes, 0, totalDuration);
    if (fallbackList.length >= 3) {
      return fallbackList.map((c) => `${c.time} ${c.label}`).join("\n");
    }
  }

  return "";
}

/** Bundel lengkap untuk disimpan/ditampilkan. */
export function buildYoutubeMeta(item) {
  return {
    title: buildTitle(item),
    description: buildDescription(item),
    tags: buildTags(item)
  };
}

/** Teks siap-copy (blok untuk file .txt / konsol). */
export function formatMetaForCopy(item) {
  const meta = buildYoutubeMeta(item);
  return [
    "===== JUDUL =====",
    meta.title,
    "",
    "===== DESKRIPSI =====",
    meta.description,
    "",
    "===== TAG (pisahkan koma) =====",
    meta.tags.join(", "),
    ""
  ].join("\n");
}
