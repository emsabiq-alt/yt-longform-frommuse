/**
 * Wikidata P18 — foto resmi untuk NAMA TOKOH, tanpa menebak lewat pencarian teks.
 *
 * Kenapa jalur ini terpisah dari pencarian Commons biasa: mencari "Ibnu Sina" di
 * Commons mengembalikan apa saja yang judulnya memuat kata itu (masjid, sekolah,
 * jalan, sampul buku). Wikidata memetakan entitas → foto (property P18) secara
 * eksplisit, jadi hasilnya foto orangnya, bukan benda yang dinamai sepertinya.
 *
 * Bahaya utamanya ambiguitas: "Ibnu Sina" cocok ke Q8011 (polimatik Persia),
 * Q25471295 (politisi Indonesia), dan Q125233024 (madrasah di Malang). Karena
 * itu kandidat WAJIB lolos uji "ini manusia" (P31 → Q5) sebelum P18 diambil.
 * Tidak lolos → null, biar pipeline jatuh ke jalur pencarian biasa.
 *
 * Gratis, tanpa API key. Wajib User-Agent deskriptif (kebijakan Wikimedia).
 */

import { config } from "./config.js";

const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const COMMONS_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath/";

// Entitas yang jelas BUKAN orang meski namanya memuat nama tokoh. Penolak murah
// sebelum verifikasi P31 yang butuh request kedua.
const NON_PERSON_HINTS = [
  "sekolah", "school", "madrasah", "universitas", "university", "institut",
  "rumah sakit", "hospital", "masjid", "mosque", "yayasan", "foundation",
  "jalan", "street", "bandara", "airport", "kawah", "crater", "asteroid",
  "film", "movie", "album", "lagu", "song", "buku", "book", "novel",
  "perusahaan", "company", "klinik", "apotek", "pesantren", "kampus"
];

function timeout() {
  return AbortSignal.timeout(config.wikimedia.timeoutMs);
}

function headers() {
  return {
    "User-Agent": config.wikimedia.userAgent,
    "Api-User-Agent": config.wikimedia.userAgent,
    Accept: "application/json"
  };
}

/**
 * Nama orang, bukan kalimat: 2-4 kata, diawali huruf kapital, tanpa angka.
 * Penyaring murah supaya tidak setiap label memicu request jaringan.
 */
export function looksLikePersonName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 48 || /\d/.test(text)) return false;
  const words = text.split(" ");
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(word));
}

function isNonPersonDescription(description) {
  const text = String(description || "").toLowerCase();
  return NON_PERSON_HINTS.some((hint) => text.includes(hint));
}

/**
 * Cari kandidat entitas untuk sebuah nama. Bahasa Indonesia dulu, lalu Inggris
 * sebagai cadangan karena banyak tokoh non-Indonesia tidak punya label lokal.
 */
export async function searchWikidataEntity(name, options = {}) {
  const query = String(name || "").replace(/\s+/g, " ").trim();
  if (!query) return [];
  const fetchImpl = options.fetchImpl || fetch;
  const language = options.language || "id";
  const url = new URL(WIKIDATA_API_URL);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", query);
  url.searchParams.set("language", language);
  url.searchParams.set("uselang", language);
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", "5");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetchImpl(url, { headers: headers(), signal: timeout() });
  if (!response.ok) throw new Error(`Wikidata search HTTP ${response.status}`);
  const data = await response.json();
  return (data?.search || []).map((entry) => ({
    id: String(entry.id || ""),
    label: String(entry.label || ""),
    description: String(entry.description || "")
  })).filter((entry) => /^Q\d+$/.test(entry.id));
}

/**
 * Verifikasi entitas benar-benar manusia (P31 → Q5) lalu ambil P18.
 * Keduanya dari satu request wbgetentities agar hemat.
 */
export async function fetchEntityImage(entityId, options = {}) {
  if (!/^Q\d+$/.test(String(entityId || ""))) return null;
  const fetchImpl = options.fetchImpl || fetch;
  const url = new URL(WIKIDATA_API_URL);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", entityId);
  url.searchParams.set("props", "claims");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetchImpl(url, { headers: headers(), signal: timeout() });
  if (!response.ok) throw new Error(`Wikidata entity HTTP ${response.status}`);
  const data = await response.json();
  const claims = data?.entities?.[entityId]?.claims;
  if (!claims) return null;

  const instanceOf = (claims.P31 || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
  if (!instanceOf.includes("Q5")) return null;

  const filename = (claims.P18 || [])
    .map((claim) => claim?.mainsnak?.datavalue?.value)
    .find((value) => typeof value === "string" && value.trim());
  return filename ? filename.trim() : null;
}

/**
 * Nama tokoh → URL file Commons beserta metadata atribusinya.
 * Mengembalikan null pada nama ambigu, entitas non-manusia, tokoh tanpa foto,
 * atau error jaringan — pemanggil lanjut ke jalur pencarian biasa.
 */
export async function findPersonImage(name, options = {}) {
  if (!looksLikePersonName(name)) return null;
  const searchEntity = options.searchEntity || searchWikidataEntity;
  const entityImage = options.entityImage || fetchEntityImage;

  let candidates = [];
  try {
    candidates = await searchEntity(name, options);
    if (!candidates.length) {
      candidates = await searchEntity(name, { ...options, language: "en" });
    }
  } catch (error) {
    console.warn(`[Wikidata] Search "${name}" gagal: ${error.message}`);
    return null;
  }

  for (const candidate of candidates.slice(0, 3)) {
    if (isNonPersonDescription(candidate.description)) continue;
    let filename;
    try {
      filename = await entityImage(candidate.id, options);
    } catch (error) {
      console.warn(`[Wikidata] Entity ${candidate.id} gagal: ${error.message}`);
      continue;
    }
    if (!filename) continue;
    return {
      entityId: candidate.id,
      label: candidate.label || name,
      description: candidate.description,
      filename,
      // Special:FilePath meredirect ke upload.wikimedia.org sehingga tetap lolos
      // pemeriksaan host di downloadWikimediaMedia.
      url: `${COMMONS_FILEPATH}${encodeURIComponent(filename)}?width=${config.wikimedia.imageWidth}`,
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`
    };
  }
  return null;
}


