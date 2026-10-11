import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { estimateTotalCost } from "./cost.js";
import { requestKnowledgeJson, storyApiKey } from "./openai.js";
import { fetchWikipediaFacts } from "./wikipedia.js";
import { clamp, cleanText, createId, nowIso } from "./util.js";
import { pickFreshTopic } from "./topic-engine.js";
import { loadHistory } from "./continuity-engine.js";
import { generateViralTitle } from "./title-engine.js";
import { buildScenePattern, formatTypeDescription, formatTypeNarrativeCue, pickFormatType, resolveSceneType, sceneWordRange } from "./format-engine.js";
import { getViralAngleById, pickViralAngle, viralAngleSummary } from "./viral-angle-library.js";
import { isGenericStoryboardText, polishPlanForLayAudience, simplifyForLayAudience } from "./story-language.js";
import { normalizeSpotlight } from "./spotlight.js";
import { enrichTrendNewsItems, fetchNewsArticlesForTopic } from "./news-research.js";
import { MAX_ENRICHED_SCENES } from "./duration-control.js";

// Kontrak durasi longform, dipakai bersama config, API, workflow, dan render.
export const DEFAULT_DURATION_SEC = 1200;
export const MAX_DURATION_SEC = 1200;

// Naskah lebih pendek dari porsi ini tidak akan pernah menghasilkan video
// sepanjang target, jadi run dihentikan sebelum gambar/TTS/render dibayar.
// Ambang ini tetap di bawah minimum revisi 1.8 kata/detik.
const MIN_PUBLISHABLE_WORDS_PER_SEC = 1.4;
const MAX_NARRATION_REVISION_ATTEMPTS = 3;

const categories = [
  "vulkanologi",
  "geologi",
  "sains",
  "penemuan",
  "sejarah",
  "tubuh manusia",
  "alam semesta",
  "teknologi",
  "benda sehari-hari",
  "tokoh dunia",
  "bahasa dan budaya",
  "makanan dan dapur",
  "material dan warna",
  "peta dan navigasi",
  "suara dan musik",
  "infrastruktur tersembunyi",
  "ekologi mikro"
];

/**
 * Catatan struktur cerita per kategori agar naskah tidak monoton.
 * Setiap kategori punya fokus narasi, elemen wajib, dan variasi rencana.
 */
const CATEGORY_STORY_NOTES = {
  vulkanologi: "Fokus pada skala ancaman geologis, tekanan bawah tanah, dan misteri tektonik. Gunakan analogi konkret untuk menjelaskan magma, lempeng tektonik, dan gelombang tsunami. Tampilkan perbandingan energi letusan terhadap bom atom, data kedalaman kerak bumi, serta jejak peradaban atau fosil yang terdampak. Pastikan tensi cerita terasa mendesak, seru, dan faktual seperti dokumenter National Geographic atau Lemmino. HINDARI pertanyaan remeh/dasar anak-anak (seperti kenapa dinamakan anak, apa itu magma, dll); fokus pada dinamika teknis, anomali data, dan taruhan nyata bagi manusia dan bumi. WAJIB variasikan visual di setiap bab: jangan hanya menampilkan kawah/laut; rotasi antara instrumen seismograf BMKG/USGS, irisan penampang 3D dapur magma, data radar satelit deformasi InSAR, lapisan tephra batuan purba, kapal riset sonar bawah laut, dan simulasi penjalaran tsunami.",
  geologi: "Fokus pada pergerakan lempeng, palung samudra terdalam, batuan purba, dan perubahan bentang bumi selama jutaan tahun. Hadirkan misteri sains bumi yang nyata, terukur, dan komprehensif tanpa penjelasan kamus dasar. WAJIB variasikan visual: rotasi antara peta batimetri palung, laboratorium uji sampel mineral, citra radar sesar aktif, penampang melintang patahan bumi, dan monitoring sensor geodetik GPS.",
  sains: "Gunakan analogi konkret untuk menjelaskan mekanisme abstrak. Libatkan sejarah pembuktian, kesalahan ilmiah populer, dan aplikasi nyata di kehidupan. Variasi: bandingkan skala, urutkan proses langkah demi langkah, atau ungkap 'siapa penemu pertama'.",
  penemuan: "Ceritakan perjalanan dari masalah → percobaan → kegagalan → momen eurekah. Soroti pihak yang diuntungkan/dirugikan. Variasi: penemuan tak sengaja, penemuan yang direbut, atau penemuan yang gagal beradaptasi.",
  sejarah: "Jalin narasi kronologis dengan fokus pada dilema manusia, bukan sekadar tanggal. Gunakan perspektif tokoh pinggiran. Variasi: peristiwa terlupakan, dampak jangka panjang, propaganda versus fakta.",
  "tubuh manusia": "Hubungkan mekanisme biologis dengan pengalaman sehari-hari pembaca. Bantah mitos populer dengan data. Variasi: perbandingan dengan hewan, evolusi anggota tubuh, atau trik otak yang menipu indra.",
  "alam semesta": "Bangun rasa skala yang membuat penonton terkesima. Gunakan satuan yang mudah dibayangkan. Variasi: misteri yang belum terpecahkan, perjalanan waktu cahaya, atau fenomena langka yang akan terjadi.",
  teknologi: "Jelaskan komponen kecil dengan konsekuensi besar. Bahas etika dan dampak sosial. Variasi: teknologi mati, perlombaan antarpesaing, atau algoritma yang mengubah perilaku manusia.",
  "benda sehari-hari": "Ungkap sejarah tersembunyi di balik desain yang tampak biasa. Libatkan proses produksi. Variasi: mengapa bentuknya demikian, alternatif yang kalah populer, atau jejak sejarah peradaban.",
  "tokoh dunia": "Fokus pada satu keputusan kritis yang mengubah legasi. Gunakan kutipan atau anekdot konkret. Variasi: musuh/rival terlupakan, momen hampir gagal, atau konsekuensi tak terduga.",
  "bahasa dan budaya": "Jelaskan evolusi dari simbol/kata hingga makna modern. Hubungkan dengan peristiwa sejarah. Variasi: bahasa hampir punah, kesalahpahaman antarbudaya, atau kata yang berubah makna.",
  "makanan dan dapur": "Padukan sains kimia, sejarah globalisasi, dan tradisi kuliner. Variasi: mitos makanan, proses fermentasi, perdagangan rempah, atau industri yang menciptakan selera massa.",
  "material dan warna": "Ceritakan asal-usul bahan, proses ekstraksi, dan simbolisme budaya. Variasi: warna langka, material masa depan, dampak lingkungan, atau peran dalam seni/kekuasaan.",
  "peta dan navigasi": "Bangun pemahaman bahwa peta adalah interpretasi, bukan fakta mutlak. Variasi: distorsi peta, navigator hebat yang tersesat, batas aneh, atau teknologi rahasia.",
  "suara dan musik": "Jelaskan fisika getaran dan dampak emosional. Variasi: instrumen kuno, genre yang lahir dari konflik, rekaman bersejarah, atau fenomena suara alam misterius.",
  "infrastruktur tersembunyi": "Bawa penonton ke 'bagian lain' kota yang tidak terlihat. Variasi: jaringan bawah tanah, proyek gagal, teknologi tua yang masih bekerja, atau dampak iklim.",
  "ekologi mikro": "Ceritakan dunia mikro dengan gaya epik. Variasi: symbiosis aneh, satu spesies penghancur ekosistem, kemampuan adaptasi ekstrem, atau peran penting serangga.",
  "ekonomi dan bisnis": "Gunakan kisah nyata perusahaan/produk untuk menjelaskan konsep ekonomi. Variasi: bubble, produk gagal, strategi harga psikologis, atau pasar gelap.",
  psikologi: "Mulai dari skenario penonton bisa relate, lalu jelaskan mekanisme otak. Variasi: eksperimen kontroversial, bias kognitif, memori palsu, atau fenomena kerumunan.",
  "hewan dan tumbuhan": "Soroti 'kemampuan super' alami dan proses evolusi. Variasi: pertahanan unik, symbiosis, spesies bangkit dari kepunahan, atau tumbuhan yang mengubah sejarah.",
  "luar angkasa": "Gabungkan sensasi petualangan dengan fakta keras. Variasi: misi rahasia, kecelakaan tersembunyi, teknologi turunan, atau objek kosmis paling aneh.",
  arsitektur: "Fokus pada satu detail struktur yang mencerminkan filosofi zaman. Variasi: kode tersembunyi, bangunan gagal, pengaruh agama/kekuasaan, atau material lokal.",
  transportasi: "Ceritakan bagaimana kendaraan mengubah geografi dan gaya hidup. Variasi: kendaraan revolusioner yang gagal, rute mematikan, evolusi mesin, atau insiden yang mengubah regulasi.",
  energi: "Jelaskan sumber energi dari 'sangat lokal' hingga geopolitik. Variasi: transisi yang hampir terjadi, bencana industri, inovasi hemat energi, atau bahan bakar masa depan.",
  "matematika sehari-hari": "Temukan pola matematika di pengalaman umum. Variasi: statistik menipu, sistem satuan aneh, algoritma tak terlihat, atau bilangan yang sulit dibayangkan.",
  "misteri sejarah": "Susun narasa investigasi tanpa memaksakan kesimpulan. Variasi: artefak aneh, peristiwa yang menghilang, kode baru terpecahkan, atau kematian tokoh mencurigakan."
};

const STORY_VARIATIONS = [
  "Buka dengan paradoks atau fakta yang melawan intuisi, lalu jelaskan mekanismenya secara bertahap.",
  "Susun sebagai kisah detektif: pertanyaan besar di awal, petunjuk di tengah, jawaban yang lebih kompleks di akhir.",
  "Gunakan sudut pandang manusia biasa yang terkena dampak topik ini dalam kehidupan nyata.",
  "Ceritakan evolusi dari masa lalu ke masa kini, lalu tebak dampak masa depan.",
  "Bandingkan dua versi: mitos populer versus fakta ilmiah/sejarah.",
  "Fokus pada konflik antarpihak: penemu vs peniru, tradisi vs modern, alam vs teknologi.",
  "Ungkap tokoh/pinggiran yang berperan besar namanya terlupakan.",
  "Jelaskan proses langkah demi langkah seolah penonton ikut melakukannya.",
  "Bangun rasa skala dengan membandingkan ukuran/waktu dengan yang familiar.",
  "Tutup dengan refleksi etis atau ajakan melihat topik dari sudut baru."
];

function storyNoteFor(category) {
  const key = String(category || "").toLowerCase().trim();
  return CATEGORY_STORY_NOTES[key]
    || CATEGORY_STORY_NOTES[key.replace(/[^a-z0-9]/g, "")]
    || "Buat naskah dokumenter mendalam dengan banyak detail faktual, beat naratif jelas, dan kesimpulan yang membuat penonton merasa lebih tahu.";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Ekstrak SATU kalimat pertanyaan punchy dari hook GPT untuk cold open.
 * Kalau GPT tetap mengembalikan paragraf panjang, ambil kalimat tanya pertama.
 * Fallback: kalimat pertama, atau buat pertanyaan generik dari topik.
 */
function extractHookQuestion(rawHook, topic) {
  const full = cleanText(rawHook || "", 500);
  if (!full) return `Tahukah kamu tentang ${cleanText(topic, 60)}?`;

  // Pisahkan kalimat-kalimat dengan aman: tanda [.!?] yang diikuti spasi atau akhir teks
  // Tidak memotong titik di tengah desimal seperti M9.0, 7.8, atau 10.5 km.
  const matches = full.match(/.*?[.!?]+(?=\s+|$)/gs);
  const sentences = matches && matches.length ? matches.map((s) => s.trim()).filter(Boolean) : [full];

  // Prioritas 1: cari kalimat yang berakhir dengan tanda tanya.
  const question = sentences.find((s) => s.trim().endsWith("?"));
  if (question) {
    const trimmed = question.trim();
    // Kalau pertanyaan cukup pendek (≤260 char), pakai langsung utuh tanpa dipotong.
    if (trimmed.length <= 260) return trimmed;
    // Kalau sangat panjang (>260 char), potong di batas kata terakhir yang rapi lalu tambah "?"
    const short = trimmed.slice(0, 250).replace(/\s+\S*$/, "").trim();
    return short.replace(/[,.;:!?]+$/, "") + "?";
  }

  // Prioritas 2: kalimat pertama saja (bukan paragraf penuh).
  const first = sentences[0].trim();
  if (first.length <= 260) return first;
  const short = first.slice(0, 250).replace(/\s+\S*$/, "").trim();
  return short.replace(/[,.;:!?]+$/, "") + "?";
}

/**
 * Tentukan scene mana yang visualnya dipakai untuk cold open "flash-forward".
 * Field 'hook' menceritakan momen dari pertengahan/akhir cerita, jadi visualnya
 * harus dari scene itu juga — bukan selalu scene 1 seperti sebelumnya.
 * Kalau AI tidak mengisi index yang valid, jatuhkan ke scene sekitar 65% cerita
 * (perkiraan zona klimaks) daripada scene 1, karena hook TIDAK PERNAH menceritakan
 * pembukaan kronologis.
 */
function resolveFlashForwardSceneIndex(rawIndex, scenes) {
  const candidates = (scenes || []).filter((s) => s.sceneType !== "reaction" && s.sceneType !== "summary");
  if (!candidates.length) return scenes?.[0]?.index || 1;
  const requested = Number(rawIndex);
  if (Number.isInteger(requested)) {
    const match = candidates.find((s) => s.index === requested);
    if (match) return match.index;
  }
  const fallback = candidates[Math.min(candidates.length - 1, Math.round(candidates.length * 0.65))];
  return fallback.index;
}

/**
 * Membuat draft naskah video panjang (landscape 16:9) memakai OpenAI GPT.
 * @param {object} rawInput - Parameter masukan dari user
 * @returns {Promise<object>} - Objek item naskah terstruktur
 */
export async function createLongformDraft(rawInput) {
  const seed = { ...(rawInput || {}) };
  if (!cleanText(seed.topic || "", 5)) {
    const fresh = await pickFreshTopic({ category: seed.category });
    seed.topic = fresh.topic;
    if (!seed.category || seed.category === "random") seed.category = fresh.category;
    seed.angle = fresh.angle;
    seed.formatType = fresh.formatType;
    seed.viralAngleId = fresh.viralAngleId;
    seed.viralAngleLabel = simplifyForLayAudience(fresh.viralAngleLabel || "", 80);
    seed.trend = fresh.trend || null;
    console.log(`[Topic Engine] Topik otomatis (${fresh.source}): "${fresh.topic}" [${fresh.category}] [${fresh.formatType}] [${seed.viralAngleLabel || "angle acak"}]`);
  } else {
    if (!seed.angle) seed.angle = "asal-usul yang jarang diketahui";
    if (!seed.formatType || !seed.viralAngleId) {
      // Topik manual: history tetap dibaca supaya formatType/angle tidak mengulang
      // beberapa video terakhir. Jalur auto-topic sudah melakukannya di pickFreshTopic().
      const history = await loadHistory(80);
      if (!seed.formatType) seed.formatType = pickFormatType(history);
      if (!seed.viralAngleId) {
        const viralAngle = pickViralAngle(history);
        seed.viralAngleId = viralAngle.id;
        seed.viralAngleLabel = simplifyForLayAudience(viralAngle.label, 80);
      }
    }
  }

  // Grounding berita & fakta Google News (otomatis untuk tren cron maupun topik manual/evergreen)
  if (seed.trend?.newsItems?.length) {
    try {
      await enrichTrendNewsItems(seed.trend);
      console.log(`[NewsResearch] Memperkaya ${seed.trend.newsItems.length} artikel berita untuk topik tren.`);
    } catch (error) {
      console.warn(`[NewsResearch] Gagal memperkaya artikel tren: ${error.message}`);
    }
  } else if (!seed.trend && cleanText(seed.topic, 4)) {
    try {
      const autoTrend = await fetchNewsArticlesForTopic(seed.topic);
      if (autoTrend?.newsItems?.length) {
        seed.trend = autoTrend;
        console.log(`[NewsResearch] Auto-grounding berhasil: ${autoTrend.newsItems.length} artikel berita untuk "${seed.topic}".`);
      }
    } catch (error) {
      console.warn(`[NewsResearch] Auto-grounding lewati: ${error.message}`);
    }
  }

  const input = normalizeInput(seed);

  // Grounding fakta dari Wikipedia (gratis, tanpa API key). Hanya saat story AI aktif
  // karena fallback offline memakai naskah template yang tidak memanfaatkan fakta.
  let wiki = null;
  if (storyApiKey()) {
    try {
      wiki = await fetchWikipediaFacts(input.topic);
      if (wiki?.sources?.length) {
        console.log(`[Wikipedia] Grounding fakta aktif: ${wiki.sources.map((s) => s.title).join(", ")}`);
      }
    } catch (error) {
      console.warn(`[Wikipedia] Lewati grounding: ${error.message}`);
    }
  }

  let plan;
  let source = "offline";
  let promptText = "";

  if (storyApiKey()) {
    try {
      // Naskah diminta per segmen kecil (chunking), bukan sekaligus, karena
      // request raksasa sekaligus hang di 9Router. Revisi panjang naskah
      // dilakukan per segmen di dalam requestChunkedPlan().
      const chunked = await requestChunkedPlan(input, wiki);
      plan = chunked.plan;
      promptText = chunked.promptText;
      source = "openai";
    } catch (error) {
      console.warn(`[Story Longform] Gagal memanggil OpenAI, menggunakan fallback offline: ${error.message}`);
      plan = fallbackPlan(input, error.message);
    }
  } else {
    plan = fallbackPlan(input, "OPENAI_API_KEY belum aktif.");
  }

  let normalized = normalizePlan(plan, input);

  // Generate judul viral dari ringkasan konten jika diaktifkan. Title Engine
  // memilih DeepSeek lebih dulu, lalu OpenAI, lalu fallback lokal deterministik.
  if (config.automation.viralTitleEnabled) {
    try {
      const viralTitle = await generateViralTitle(normalized, input);
      if (viralTitle) {
        normalized.title = viralTitle;
      }
    } catch (error) {
      console.warn(`[Story Longform] Title engine error: ${error.message}`);
    }
  }

  // Revisi panjang naskah sudah dilakukan per segmen di dalam requestChunkedPlan()
  // (tiap segmen wajib mencapai batas bawah katanya sebelum lanjut), sehingga
  // revision loop global yang me-request seluruh naskah sekaligus tidak dipakai lagi.

  // Gerbang fail-closed: naskah fallback offline atau naskah yang tetap jauh di
  // bawah target durasi hanya menghasilkan video pendek. Berhenti di sini,
  // sebelum gambar, TTS, render, dan upload YouTube dikerjakan.
  assertNarrationLongEnough(normalized, input, source);

  // Catat sumber Wikipedia HANYA bila naskah benar-benar dari OpenAI yang di-grounding,
  // agar atribusi di deskripsi tidak menyesatkan saat fallback offline dipakai.
  if (source === "openai" && wiki?.sources?.length) {
    normalized.sources = wiki.sources;
    normalized.factSource = "wikipedia";
    normalized.researchFacts = wiki.facts;
  }

  normalized = finalizeNormalizedPlan(normalized, input);
  normalized.title = cleanText(normalized.title || input.topic || "Fakta Menarik yang Jarang Diketahui", 100);

  const narrationText = normalized.scenes
    .filter((scene) => scene.sceneType !== "reaction")
    .map((scene) => scene.narration)
    .join(" ");
  const outputText = JSON.stringify(normalized);

  const cost = estimateTotalCost({
    promptText,
    outputText,
    sceneCount: normalized.scenes.length,
    imageSize: "1536x1024", // Landscape DALL-E 3 size
    imageQuality: input.imageQuality,
    imageModel: config.openai.imageModel,
    narrationChars: narrationText.length,
    ttsProvider: input.ttsProvider,
    pricing: config.pricing
  });

  const item = {
    id: createId("tau-lf"),
    source,
    status: "draft",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    input,
    title: normalized.title,
    plan: normalized,
    assets: {
      images: [],
      clips: [],
      audio: null,
      video: null
    },
    cost
  };

  item.assets.storyboard = await writeLongformStoryboard(item);
  return item;
}

// Only new scenes are normalized. Existing narration and visual directions stay intact.
export function insertEnrichmentScenes(item, additions) {
  const original = item.plan.scenes;
  if (!Array.isArray(additions) || !additions.length || original.length + additions.length > MAX_ENRICHED_SCENES) {
    throw new Error(`Jumlah scene pengayaan kosong atau melebihi batas ${MAX_ENRICHED_SCENES} scene.`);
  }
  const anchors = new Map(original.slice(0, -1).map((scene) => [scene.index, scene]));
  const usedNarrations = new Set(original.map((scene) => String(scene.narration).toLowerCase().replace(/\s+/g, " ").trim()));
  for (const addition of additions) {
    if (!anchors.has(Number(addition.afterSceneIndex))) throw new Error("Scene pengayaan harus mengikuti scene yang ada sebelum penutup.");
    const narration = String(addition.narration || "").trim();
    const key = narration.toLowerCase().replace(/\s+/g, " ");
    if (narration.split(/\s+/).length < 35 || narration.length > 4000 || usedNarrations.has(key)) {
      throw new Error("Scene pengayaan harus berisi pembahasan baru yang lengkap, bukan salinan atau ringkasan.");
    }
    if (!addition.beatPurpose || !addition.imagePrompt || !Array.isArray(addition.visualSegments) || addition.visualSegments.length < 4) {
      throw new Error("Scene pengayaan wajib memiliki tujuan naratif dan empat arahan visual.");
    }
    usedNarrations.add(key);
  }
  const normalized = normalizePlan({ ...item.plan, scenes: [
    ...additions.map((scene) => ({ ...scene, sceneType: "image", chapter: anchors.get(Number(scene.afterSceneIndex)).chapter })),
    original.at(-1)
  ] }, { ...item.input, sceneCount: additions.length + 1 }).scenes.slice(0, -1);
  const groups = new Map();
  additions.forEach((addition, index) => {
    const anchor = Number(addition.afterSceneIndex);
    if (!groups.has(anchor)) groups.set(anchor, []);
    const extra = normalized[index];
    if (extra.narration.split(/\s+/).length < 35) throw new Error("Scene tambahan kehilangan isi setelah normalisasi; pengayaan dibatalkan.");
    groups.get(anchor).push({ ...extra, chapter: anchors.get(anchor).chapter });
  });
  const indexMap = new Map();
  const scenes = [];
  for (const scene of original) {
    indexMap.set(scene.index, scenes.length + 1);
    scenes.push({ ...scene, index: scenes.length + 1 });
    for (const extra of groups.get(scene.index) || []) scenes.push({ ...extra, index: scenes.length + 1 });
  }
  item.plan.scenes = scenes;
  // Scene lama bergeser index setelah scene baru disisipkan; ikuti agar cold open
  // flash-forward tetap merujuk scene yang sama, bukan scene lain yang kebetulan
  // menempati index lama itu sekarang.
  if (indexMap.has(item.plan.flashForwardSceneIndex)) {
    item.plan.flashForwardSceneIndex = indexMap.get(item.plan.flashForwardSceneIndex);
  }
  item.plan.longformStoryboard = buildLongformStoryboard(item.plan);
  item.input.sceneCount = scenes.length;
  item.assets.sceneAudio = (item.assets.sceneAudio || []).map((entry) => ({ ...entry, sceneIndex: indexMap.get(entry.sceneIndex) }));
  return item;
}

export async function enrichLongformDraft(item, { missingSec, rawAudioSec, request = requestKnowledgeJson }) {
  const scenes = item.plan.scenes;
  const wordCount = scenes.reduce((sum, scene) => sum + String(scene.narration).split(/\s+/).length, 0);
  const wordsToAdd = Math.max(45, Math.ceil(missingSec * wordCount / rawAudioSec));
  const count = Math.min(6, MAX_ENRICHED_SCENES - scenes.length, Math.max(1, Math.ceil(wordsToAdd / 80)));
  if (count <= 0) throw new Error(`Durasi belum terpenuhi setelah ${MAX_ENRICHED_SCENES} scene. Storyboard dipertahankan; publikasi dihentikan.`);
  const prompt = [
    "Perkaya dokumenter Bahasa Indonesia berikut dengan scene TAMBAHAN. Jangan menulis ulang, memendekkan, atau menghapus scene lama.",
    `Topik: ${item.input.topic}. Tambahkan tepat ${count} scene image, sekitar ${Math.min(wordsToAdd, count * 110)} kata baru total.`,
    "Setiap scene baru menjelaskan bukti, contoh, studi kasus, sebab-akibat, atau sudut pandang yang belum dijelaskan. Gunakan fakta dari sumber yang tersedia; jangan mengarang angka, kutipan, atau sumber.",
    "Tahun/tanggal WAJIB akurat — JANGAN menebak/mengarang tahun demi terdengar spesifik. Kalau tidak yakin persisnya, pakai frasa relatif ('beberapa tahun kemudian', 'awal abad itu') daripada tahun pasti yang bisa salah.",
    "Sisipkan pada bab yang paling relevan melalui afterSceneIndex. Jangan sisipkan setelah scene penutup. Pertahankan alur dan nama bab.",
    "Setiap scene memerlukan narration lengkap, screenText spesifik, beatPurpose, imagePrompt, visualKeywords, dan tepat 4 visualSegments dengan imagePrompt, visualKeywords, pexelsQuery, mustMatchTerms, narrativeContext (salinan 3-8 kata dari narasi).",
    "Isi spotlight {type:'keypoint'|'figure', label, sublabel, phrase} untuk fakta/nama penting, atau {type:'compare', label, value, compareLabel, compareValue, unit, phrase} kalau ada dua besaran yang benar-benar dibandingkan eksplisit di narasi (jangan mengarang angka pembanding). phrase disalin dari narasi. Isi mediaSource hanya dari sumber relevan untuk mockup phone/tablet yang sudah ada.",
    "Kembalikan JSON {scenes:[{afterSceneIndex,narration,screenText,beatPurpose,imagePrompt,visualKeywords,visualSegments,spotlight,mediaSource}]}.",
    `Sumber berita: ${JSON.stringify(item.input.trend?.newsItems || [])}`,
    `Referensi tambahan: ${JSON.stringify(item.plan.sources || [])}`,
    `Fakta riset: ${item.plan.researchFacts || "Gunakan materi sumber berita yang tersedia di atas."}`,
    `Storyboard yang harus dipertahankan: ${JSON.stringify(scenes.map(({ index, chapter, narration, beatPurpose }) => ({ index, chapter, narration, beatPurpose })))}`
  ].join("\n");
  const result = await request(prompt);
  const additions = Array.isArray(result?.scenes) ? result.scenes.slice(0, count) : [];
  if (!additions.length) throw new Error("Pengayaan harus mengembalikan setidaknya satu scene lengkap.");
  if (additions.length !== count) {
    console.warn(`[Duration] AI mengembalikan ${result.scenes.length} dari ${count} scene yang diminta; memakai ${additions.length} scene lalu mengukur ulang.`);
  }
  const maxAnchor = Math.max(1, scenes.length - 1);
  for (const a of additions) {
    const idx = Number(a.afterSceneIndex);
    if (!Number.isFinite(idx) || idx < 1 || idx > maxAnchor) {
      a.afterSceneIndex = maxAnchor;
    }
  }
  insertEnrichmentScenes(item, additions);
  item.assets.storyboard = await writeLongformStoryboard(item);
  item.updatedAt = nowIso();
  return item;
}

function normalizeInput(input) {
  const durationSec = clamp(Number(input.durationSec || DEFAULT_DURATION_SEC), 300, MAX_DURATION_SEC);
  const defaultScenes = Math.round(clamp(durationSec / 33, 8, 48));
  // Batas bawah adegan proporsional dengan durasi (~45s per scene) agar naskah AI
  // memiliki cukup wadah scene untuk mencapai ambang kata tanpa mentok batas atas kata per scene.
  const minScenesForDuration = Math.round(clamp(durationSec / 45, 8, 48));
  let sceneCount;
  if (input.dynamicScenes) {
    // Mode Ide: hitung dari volume konten artikel, dibatasi batas bawah kebutuhan durasi
    const totalWords = (input.trend?.newsItems || [])
      .reduce((sum, it) => sum + String(it.excerpt || it.headline || "").split(/\s+/).length, 0);
    const calculated = Math.ceil(totalWords / 80);
    sceneCount = clamp(Math.max(calculated || 0, minScenesForDuration), 8, 48);
  } else {
    sceneCount = clamp(Number(input.sceneCount || defaultScenes), minScenesForDuration, 48);
  }

  return {
    topic: cleanText(input.topic || "Fakta menarik yang jarang diketahui orang", 260),
    category: cleanText(input.category && input.category !== "random" ? input.category : "umum", 80),
    angle: simplifyForLayAudience(input.angle || "asal-usul yang jarang diketahui", 80),
    formatType: cleanText(input.formatType || "dokumenter_klasik", 40),
    viralAngleId: cleanText(input.viralAngleId || "", 40),
    viralAngleLabel: simplifyForLayAudience(input.viralAngleLabel || "", 80),
    trend: normalizeTrend(input.trend),
    tone: cleanText(input.tone || "narrator, serius tapi menarik, informatif, mendalam, seperti video dokumenter Vox atau Lemmino", 180),
    durationSec,
    durationLocked: input.durationLocked ?? true,
    sceneCount,
    ttsProvider: String(input.ttsProvider || "openai").toLowerCase() === "elevenlabs" ? "elevenlabs" : "openai",
    imageSize: "1536x1024", // Default landscape
    imageQuality: cleanText(input.imageQuality || config.openai.imageQuality || "low", 20),
    allowOfflineDraft: Boolean(input.allowOfflineDraft || input.allowOffline)
  };
}

function normalizeTrend(trend) {
  if (!trend || typeof trend !== "object") return null;
  const newsItems = (Array.isArray(trend.newsItems) ? trend.newsItems : [])
    .map((item) => ({
      headline: cleanText(item?.headline || item?.title || "", 240),
      outlet: cleanText(item?.outlet || item?.source || "", 100),
      url: cleanText(item?.url || "", 500),
      publishedAt: cleanText(item?.publishedAt || "", 80),
      excerpt: cleanText(item?.excerpt || "", 700),
      imageUrl: cleanText(item?.imageUrl || "", 500) || null
    }))
    .filter((item) => item.headline && item.outlet)
    .slice(0, 12);
  if (!newsItems.length) return null;
  return {
    title: cleanText(trend.title || "", 180),
    articles: Math.max(0, Number(trend.articles) || 0),
    sources: Math.max(0, Number(trend.sources) || 0),
    days: Math.max(0, Number(trend.days) || 0),
    newsItems
  };
}

function normalizedOutletKey(value) {
  return cleanText(value || "", 100).toLocaleLowerCase("id-ID");
}

function normalizedHeadlineKey(value) {
  return cleanText(value || "", 240)
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function narrationNamesOutlet(narration, outlet) {
  const narrationKey = String(narration || "").toLocaleLowerCase("id-ID");
  const outletKey = normalizedOutletKey(outlet);
  return Boolean(outletKey && narrationKey.includes(outletKey));
}

function trendPromptBlock(trend) {
  if (!trend?.newsItems?.length) return "";
  const headlines = trend.newsItems.map((item, index) => {
    const base = `${index + 1}. [${item.outlet}] ${item.headline}${item.publishedAt ? ` (${item.publishedAt})` : ""}`;
    return item.excerpt ? `${base}\n   ISI ARTIKEL: ${item.excerpt}` : base;
  }).join("\n");
  const hasExcerpts = trend.newsItems.some((it) => it.excerpt);
  return [
    "",
    `BERITA RSS TERKAIT TOPIK (${trend.title || "tren terpilih"}):`,
    headlines,
    "",
    "ATURAN SUMBER MEDIA DAN KUTIPAN (DEVICE MOCKUP OVERLAY):",
    "- Sebarkan 6-8 scene dengan referensi relevan di seluruh bab; sertakan field mediaSource: { outlet, headline, url, publishedAt } yang disalin dari item di atas agar tampil di mockup smartphone/tablet. Mockup akan muncul di atas latar video B-roll (tidak tampil bersamaan dengan foto lain di layar). Foto di dalam mockup wajib unik dan sesuai dengan narasi saat itu. Pilih hanya sumber yang relevan.",
    "- Narasi boleh menyebut nama outlet secara alami atau langsung memaparkan faktanya secara mendalam.",
    ...(hasExcerpts ? [
      "KUTIPAN LANGSUNG (WAJIB jika ISI ARTIKEL tersedia):",
      "- Jika item memiliki 'ISI ARTIKEL', gunakan kalimat atau frasa konkret dari sana untuk memperkuat narasi scene terkait.",
      "- Integrasikan kutipan secara natural tanpa tanda petik: 'Kompas melaporkan bahwa ... sehingga...' atau 'Menurut laporan Tempo, angkanya mencapai...'.",
      "- DILARANG menggunakan tanda kutip (\") dalam narration karena merusak ritme TTS; parafrasakan dengan tetap menyebut sumber.",
      "- Fakta, angka, atau nama konkret dari ISI ARTIKEL lebih diprioritaskan daripada opini atau perkiraan."
    ] : [])
  ].join("\n");
}

// ============================================================================
// Story chunking — naskah diminta per segmen kecil, bukan sekaligus.
//
// Request storyboard raksasa sekaligus terbukti HANG di 9Router
// (4x timeout 180 detik untuk 20 scene pada 2026-10-11). Request sedang
// (~1500 token output) ke endpoint yang sama sukses dalam 27 detik, jadi:
//   1. Outline: 1 request kecil -> judul, hook, ringkasan, daftar bab.
//   2. Segmen: tiap request hanya <=4 scene (<~2000 token output), membawa
//      ringkasan segmen sebelumnya agar alur nyambung & tidak berulang.
//   3. Gabung: semua scene digabung jadi satu plan lalu melewati
//      normalizePlan() yang sama seperti dulu (kontrak downstream tidak berubah).
// ============================================================================
const STORY_CHUNK_MAX_SCENES = 4;
const STORY_CHUNK_TARGET_CHAPTERS = 8;

const DEFAULT_CHAPTER_NAMES = [
  "Pembuka", "Konteks Awal", "Akar Masalah", "Bukti Pertama",
  "Fakta Lanjutan", "Sudut Pandang Lain", "Akibatnya", "Penutup"
];

function buildWikiBlock(wiki) {
  if (!wiki?.facts) return "";
  return [
    "",
    "FAKTA REFERENSI DARI WIKIPEDIA (jadikan dasar fakta, jangan dibantah):",
    wiki.facts,
    "Aturan: nama/tanggal/angka/tempat IKUTI referensi ini. Boleh menyusun ulang jadi narasi menarik + analogi. Jangan mengarang angka/nama yang tidak ada di referensi. Isi factCheckNote bahwa fakta inti dirujuk dari Wikipedia."
  ].join("\n");
}

/**
 * Prompt outline: 1 request kecil (output ~500 token) untuk kerangka cerita.
 * Rentang scene per bab dihitung lokal (deterministik), AI hanya memberi
 * nama + fokus tiap bab agar tidak ada celah/overlap scene.
 */
export function buildOutlinePrompt(input, wiki = null) {
  const categoryNote = simplifyForLayAudience(storyNoteFor(input.category), 400);
  const viralAngle = getViralAngleById(input.viralAngleId);
  const viralBlock = simplifyForLayAudience(
    viralAngleSummary(viralAngle) || `${input.viralAngleLabel || "angle viral"}: kemas topik agar terasa punya konflik, misteri, taruhan, atau akibat yang jelas.`,
    900
  );
  return [
    "Buat KERANGKA (outline) video dokumenter horizontal (16:9) Bahasa Indonesia untuk channel BanyakTau.",
    `Topik: ${input.topic}`,
    `Kategori: ${input.category}. ${categoryNote}`,
    `Sudut pandang: ${input.angle}`,
    `Format: ${simplifyForLayAudience(formatTypeDescription(input.formatType), 300)}`,
    `Kemasan viral: ${simplifyForLayAudience(input.viralAngleLabel || viralAngle?.label || "", 120)}`,
    `${viralBlock}`,
    `Total scene video ini: ${input.sceneCount} scene, durasi ${input.durationSec} detik.`,
    `Bagi cerita menjadi ${STORY_CHUNK_TARGET_CHAPTERS} bab berurutan (contoh alur: pertanyaan utama, konteks awal, akar masalah/sebab, bukti pertama, fakta/data lanjutan, sudut pandang pembanding, dampak/akibat, jawaban dan kesimpulan). Sesuaikan susunan dengan topik.`,
    "Setiap bab: nama singkat yang SPESIFIK sesuai topik (bukan 'Bab 1'), dan 1-2 kalimat fokus pembahasan yang membedakannya dari bab lain.",
    buildWikiBlock(wiki),
    trendPromptBlock(input.trend),
    "",
    "Kembalikan JSON valid saja dengan format:",
    "{ title, hook, flashForwardSceneIndex, summary, importantPoints:[string], factCheckNote, chapterPlan:[{ name, focus }] }",
    "title: judul singkat maksimal 60 karakter, spesifik, memancing penasaran (judul final disempurnakan terpisah).",
    "hook: SATU-DUA kalimat teaser 'flash-forward' 15-25 kata — ungkap SPESIFIK satu momen/fakta paling mengejutkan dari PERTENGAHAN/AKHIR cerita (angka/nama/akibat konkret), tanpa menjelaskan sebabnya. BUKAN pertanyaan generik, BUKAN ringkasan topik.",
    "flashForwardSceneIndex: perkiraan nomor scene (1..N) di paruh kedua cerita yang visualnya paling menggambarkan hook.",
    "summary: ringkasan 2-3 kalimat. importantPoints: 3-5 poin kunci.",
    `chapterPlan: TEPAT ${STORY_CHUNK_TARGET_CHAPTERS} bab berurutan, masing-masing { name, focus }. Bab terakhir adalah penutup/kesimpulan.`
  ].filter(Boolean).join("\n");
}

/**
 * Normalisasi daftar bab dari outline AI. Kalau AI mengembalikan sampah,
 * pakai 8 nama bab bawaan agar pipeline tetap jalan (fail-soft di level bab,
 * bukan mematikan seluruh run).
 */
export function normalizeChapterPlan(raw, input) {
  const list = (Array.isArray(raw) ? raw : [])
    .map((c) => ({
      name: cleanText(c?.name || "", 80),
      focus: cleanText(c?.focus || "", 240)
    }))
    .filter((c) => c.name);
  if (list.length >= 2) return list.slice(0, 9);
  console.warn(`[Story Longform] Outline bab tidak valid, memakai ${DEFAULT_CHAPTER_NAMES.length} bab bawaan.`);
  return DEFAULT_CHAPTER_NAMES.map((name) => ({ name, focus: "" }));
}

/**
 * Bagi 1..sceneCount menjadi rentang bab yang berurutan tanpa celah/overlap.
 */
export function distributeChapterRanges(sceneCount, chapterCount) {
  const ranges = [];
  let start = 1;
  for (let i = 0; i < chapterCount; i++) {
    const size = Math.max(1, Math.ceil((sceneCount - start + 1) / (chapterCount - i)));
    const end = Math.min(sceneCount, start + size - 1);
    ranges.push({ sceneStart: start, sceneEnd: end });
    start = end + 1;
  }
  return ranges;
}

/**
 * Susun spesifikasi tiap scene (index global, tipe dari pola format, bab,
 * target kata) lalu kelompokkan menjadi segmen-segmen kecil.
 */
export function buildSceneSegments(input, chapters) {
  const pattern = buildScenePattern(input.sceneCount, input.formatType);
  const words = sceneWordRange(input.sceneCount, input.formatType, input.durationSec);
  const ranges = distributeChapterRanges(input.sceneCount, chapters.length);
  const specs = [];
  ranges.forEach((range, ci) => {
    for (let index = range.sceneStart; index <= range.sceneEnd; index++) {
      const sceneType = pattern[index - 1] || "image";
      specs.push({
        index,
        sceneType,
        chapter: chapters[ci].name,
        focus: chapters[ci].focus,
        opensChapter: index === range.sceneStart,
        wordMin: sceneType === "reaction" ? 0 : sceneType === "summary" ? words.summaryMin : words.imageMin,
        wordMax: sceneType === "reaction" ? 16 : sceneType === "summary" ? words.summaryMax : words.imageMax
      });
    }
  });
  const segments = [];
  for (let i = 0; i < specs.length; i += STORY_CHUNK_MAX_SCENES) {
    segments.push(specs.slice(i, i + STORY_CHUNK_MAX_SCENES));
  }
  return segments;
}

/**
 * Prompt untuk satu segmen (<=4 scene). Aturan inti dari prompt raksasa lama
 * dipadatkan di sini; ukuran prompt boleh besar, yang dibatasi hanya output.
 */
export function buildChunkPrompt(input, wiki, segment, prevContext, revisionNote = "") {
  const viralAngle = getViralAngleById(input.viralAngleId);
  const openerRule = segment.some((s) => s.opensChapter && s.sceneType !== "reaction")
    ? "Scene yang MEMBUKA bab baru WAJIB membuka narasi dengan pertanyaan atau ajakan menebak di 1-2 kalimat pertama (jawabannya diungkap bertahap sepanjang bab, bukan di kalimat berikutnya)."
    : "";
  const sceneLines = segment.map((spec) => {
    if (spec.sceneType === "reaction") {
      return `- Scene ${spec.index} (reaction): SATU kalimat pertanyaan penasaran 8-16 kata, WAJIB diakhiri TANDA TANYA. Contoh: "Tapi benarkah letusan purba ini yang memicu zaman es?". DILARANG mengisi screenText/narasi dengan label seperti "Fakta 1". Tanpa visualKeywords, imagePrompt, visualSegments. Isi reactionCue: heran/kaget/skeptis/menemukan petunjuk/setuju.`;
    }
    const tail = spec.sceneType === "summary"
      ? ` screenText WAJIB "Ringkasan Inti". Narasi berupa kesimpulan yang menutup seluruh video.`
      : ` screenText SPESIFIK sesuai fakta scene (bukan label generik). Tulis beatPurpose ("menjawab: ...").`;
    return `- Scene ${spec.index} (${spec.sceneType}, bab "${spec.chapter}"): narasi ${spec.wordMin}-${spec.wordMax} kata.${tail}`;
  }).join("\n");
  return [
    "Tulis naskah SEGMEN video dokumenter horizontal (16:9) Bahasa Indonesia untuk channel BanyakTau. HANYA scene dalam daftar di bawah — jangan menulis scene di luar daftar.",
    `Topik: ${input.topic}`,
    `Kategori: ${input.category} | Sudut pandang: ${input.angle}`,
    `Tone: ${input.tone}`,
    `Kemasan viral: ${simplifyForLayAudience(input.viralAngleLabel || viralAngle?.label || "", 120)}`,
    `Fokus bab segmen ini: ${segment.map((s) => `"${s.chapter}"`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}${segment[0].focus ? ` — ${segment[0].focus}` : ""}`,
    "",
    `SEGMEN INI: scene ${segment[0].index}-${segment[segment.length - 1].index} dari total ${input.sceneCount} scene.`,
    prevContext
      ? `SUDAH DIBAHAS DI SEGMEN SEBELUM (DILARANG mengulang poin/fakta/angka ini dengan kata lain — tiap scene wajib info BARU):\n${prevContext}`
      : `Ini segmen PERTAMA: scene 1 harus membuat penonton tidak bisa pergi — fakta mengejutkan yang melawan intuisi, statistik kontroversial, atau pertanyaan spesifik yang harus terjawab. DILARANG membuka dengan "Halo semuanya" atau perkenalan channel.`,
    "",
    "ATURAN BAHASA (WAJIB):",
    "- Gaya populer dinamis seperti Lemmino/Vox/Veritasium. Sapa penonton dengan 'kamu', bukan 'Anda'.",
    "- Kalimat pendek-sedang (rata-rata di bawah 20 kata), aktif, hangat. Variasikan pola pembuka kalimat antar scene.",
    "- Narasi MENGALIR untuk TTS: DILARANG titik koma (;), titik tiga (...), tanda kurung, tanda kutip. Pakai koma/kata sambung.",
    "- Angka & satuan ditulis dengan kata-kata ('tiga puluh derajat Celcius'). Hindari singkatan/simbol (%, Rp, AI, 3D, &).",
    "- DILARANG kata: implikasi, mekanisme, signifikan, fundamental, kompleksitas, eksponensial, korelasi, paradigma, esensial, krusial, dinamika.",
    "- DILARANG membahas fakta elementer/trivia anak SD (definisi kamus, etimologi nama sepele). Penonton dewasa & cerdas.",
    "- Setiap fakta rumit langsung disusul satu perbandingan sehari-hari yang bisa dibayangkan.",
    "- Tahun/angka HANYA bila yakin benar; kalau ragu pakai frasa relatif ('awal abad ke-20'). Jangan mengarang angka.",
    openerRule,
    "",
    "DAFTAR SCENE SEGMEN INI (ikuti TEPAT nomor, tipe, dan rentang kata):",
    sceneLines,
    "",
    "STRUKTUR TIAP SCENE: satu klaim inti + satu bukti/contoh/angka konkret yang mendukungnya.",
    "",
    "VISUAL (scene image/summary saja):",
    `- visualSegments: TEPAT ${VISUAL_SEGMENT_COUNT} sub-visual berurutan mengikuti alur narasi (awal, tengah-awal, tengah-akhir, akhir). Tiap sub-visual: { imagePrompt, visualKeywords, pexelsQuery, mustMatchTerms, narrativeContext }.`,
    "- pexelsQuery: frasa Inggris 3-7 kata yang KONKRET (contoh bagus: 'seismograph needle earthquake recording'; contoh terlarang: 'ocean waves aerial'). mustMatchTerms: 1-3 istilah Inggris konkret yang benar-benar disebut di narrativeContext.",
    "- narrativeContext: 3-8 kata DISALIN PERSIS (verbatim) dari narasi scene itu, urut sesuai kemunculan (sub-visual 1 dari awal narasi ... sub-visual 4 dari akhir).",
    "- imagePrompt: ilustrasi sinematik 16:9 tanpa teks/tulisan. Rotasikan sudut pandang (peta/satelit, diagram 3D, instrumen/data, arsip/artefak, aksi lapangan); scene pembuka tiap bab tampil beda warna/lokasi/subjek dari bab sebelumnya.",
    "- spotlight (opsional, hanya untuk fakta kunci): { type:'keypoint'|'figure'|'compare', label (maks 5 kata), sublabel, phrase (4-8 kata disalin persis dari narasi) }.",
    "- mediaSource (bila relevan dengan berita di bawah): { outlet, headline, url, publishedAt } — JANGAN mengarang sumber.",
    buildWikiBlock(wiki),
    trendPromptBlock(input.trend),
    revisionNote,
    "",
    "Kembalikan JSON valid SAJA: { scenes:[{ index, sceneType, narration, screenText, visualKeywords, imagePrompt, visualSegments, chapter, beatPurpose, reactionCue, spotlight, mediaSource }] }"
  ].filter(Boolean).join("\n");
}

/**
 * Ringkas narasi segmen yang sudah selesai menjadi konteks anti-pengulangan
 * untuk segmen berikutnya (dihitung lokal, tanpa request AI tambahan).
 */
export function condenseSegmentContext(segScenes, maxChars = 900) {
  const text = (segScenes || [])
    .filter((s) => s && s.sceneType !== "reaction")
    .map((s) => {
      const sentences = String(s.narration || "").match(/.*?[.!?]+(?=\s+|$)/gs) || [];
      const short = sentences.slice(0, 2).join(" ").trim() || String(s.narration || "").slice(0, 160);
      return `Scene ${s.index} (${s.chapter || "?"}): ${cleanText(short, 220)}`;
    })
    .join("\n");
  return text.slice(-maxChars);
}

/**
 * Minta satu segmen ke story API dengan revisi panjang per-segmen
 * (menggantikan revision loop global yang me-request seluruh naskah sekaligus).
 * Melempar bila segmen gagal setelah MAX_NARRATION_REVISION_ATTEMPTS percobaan
 * -> ditangkap createLongformDraft -> fallback offline (kontrak lama).
 */
export async function requestChunkScenes(input, wiki, segment, prevContext, requestFn = requestKnowledgeJson, onPrompt = null) {
  const segLabel = `scene ${segment[0].index}-${segment[segment.length - 1].index}`;
  const minWords = segment.reduce((sum, spec) => sum + spec.wordMin, 0);
  let lastWords = 0;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_NARRATION_REVISION_ATTEMPTS; attempt++) {
    try {
      const revisionNote = attempt > 1 ? [
        "",
        "REVISI WAJIB:",
        `Percobaan revisi ${attempt}/${MAX_NARRATION_REVISION_ATTEMPTS}. Segmen sebelumnya hanya ${lastWords} kata (minimal ${minWords} kata narasi).`,
        "Tulis ulang segmen ini lebih panjang. Setiap scene image/summary WAJIB mencapai batas bawah kata yang diminta. Jangan mengembalikan segmen sebelum minimum tercapai."
      ].join("\n") : "";
      const prompt = buildChunkPrompt(input, wiki, segment, prevContext, revisionNote);
      if (typeof onPrompt === "function") onPrompt(prompt);
      const result = await requestFn(prompt);
      const byIndex = new Map(
        (Array.isArray(result?.scenes) ? result.scenes : []).map((s) => [Number(s?.index), s])
      );
      const missing = segment.filter((spec) => {
        const s = byIndex.get(spec.index);
        return !s || !String(s?.narration || "").trim();
      });
      if (missing.length) {
        throw new Error(`AI tidak mengembalikan scene ${missing.map((m) => m.index).join(", ")}.`);
      }
      lastWords = segment.reduce((sum, spec) => {
        if (spec.sceneType === "reaction") return sum;
        return sum + String(byIndex.get(spec.index)?.narration || "").split(/\s+/).filter(Boolean).length;
      }, 0);
      if (lastWords < minWords) {
        console.warn(`[Story Longform] Segmen ${segLabel} terlalu pendek (${lastWords} < ${minWords} kata), revisi ${attempt}/${MAX_NARRATION_REVISION_ATTEMPTS}...`);
        continue;
      }
      return segment.map((spec) => ({
        ...byIndex.get(spec.index),
        index: spec.index,
        sceneType: spec.sceneType,
        chapter: spec.chapter
      }));
    } catch (error) {
      lastError = error;
      console.warn(`[Story Longform] Segmen ${segLabel} percobaan ${attempt}/${MAX_NARRATION_REVISION_ATTEMPTS} gagal: ${error.message}`);
    }
  }
  throw new Error(`Segmen ${segLabel} gagal setelah ${MAX_NARRATION_REVISION_ATTEMPTS} percobaan: ${lastError?.message || "unknown"}`);
}

/**
 * Orkestrasi chunking: outline -> segmen per bab -> gabung jadi satu plan
 * mentah (format SAMA seperti output request raksasa dulu).
 * @returns {Promise<{plan: object, promptText: string}>}
 */
export async function requestChunkedPlan(input, wiki, requestFn = requestKnowledgeJson) {
  const prompts = [];
  console.log(`[Story Longform] Meminta outline ${input.sceneCount} scene untuk topik: "${input.topic}"...`);
  const outlinePrompt = buildOutlinePrompt(input, wiki);
  prompts.push(outlinePrompt);
  const outline = await requestFn(outlinePrompt);
  const chapters = normalizeChapterPlan(outline?.chapterPlan, input);
  const segments = buildSceneSegments(input, chapters);
  console.log(`[Story Longform] Outline OK (${chapters.length} bab). Meminta naskah dalam ${segments.length} segmen kecil...`);

  const allScenes = [];
  const contextParts = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segLabel = `segmen ${i + 1}/${segments.length} (scene ${seg[0].index}-${seg[seg.length - 1].index})`;
    const prevContext = contextParts.join("\n").slice(-1500);
    const segScenes = await requestChunkScenes(input, wiki, seg, prevContext, requestFn, (p) => prompts.push(p));
    allScenes.push(...segScenes);
    contextParts.push(condenseSegmentContext(segScenes));
    const segWords = segScenes
      .filter((s) => s.sceneType !== "reaction")
      .reduce((sum, s) => sum + String(s.narration || "").split(/\s+/).filter(Boolean).length, 0);
    console.log(`[Story Longform] ${segLabel} OK (${segWords} kata).`);
  }

  return {
    plan: {
      title: outline?.title,
      hook: outline?.hook,
      flashForwardSceneIndex: outline?.flashForwardSceneIndex,
      summary: outline?.summary,
      importantPoints: outline?.importantPoints,
      factCheckNote: outline?.factCheckNote,
      scenes: allScenes
    },
    promptText: prompts.join("\n\n")
  };
}

function normalizeMediaSource(value, narration, trend) {
  if (!value || typeof value !== "object") return null;
  const outlet = cleanText(value.outlet || value.source || "", 100);
  const headline = cleanText(value.headline || value.title || "", 240);
  if (!outlet && !headline) return null;

  if (trend?.newsItems?.length) {
    const match = trend.newsItems.find((item) =>
      (outlet && normalizedOutletKey(item.outlet) === normalizedOutletKey(outlet))
        || (headline && normalizedHeadlineKey(item.headline) === normalizedHeadlineKey(headline))
        || (outlet && String(item.outlet || item.source || "").toLowerCase().includes(outlet.toLowerCase()))
    );
    if (match) return { ...match };
  }
  return { outlet: outlet || "Media Terkait", headline: headline || "" };
}

/**
 * Normalisasi visualSegments dari output AI.
 * Jika AI mengembalikan array visualSegments yang valid, bersihkan dan validasi.
 * Jika tidak, auto-split dari imagePrompt dan visualKeywords scene menjadi 4 segmen (grid 2x2).
 * @param {Array|null} rawSegments - visualSegments dari AI
 * @param {string} sceneImagePrompt - imagePrompt fallback level scene
 * @param {string} sceneVisualKeywords - visualKeywords fallback level scene
 * @param {string} topic - topik utama
 * @param {number} index - index scene (0-based)
 * @param {{allowScenePexelsIntent?: boolean}} [options] - Izinkan keyword level scene menjadi intent Pexels.
 * @returns {Array} - Array of { imagePrompt, visualKeywords, pexelsQuery, mustMatchTerms, narrativeContext }
 */
const GENERIC_PEXELS_TERMS = new Set([
  "activity", "aerial", "angle", "background", "camera", "cinematic",
  "close", "close-up", "closeup", "closeups", "detail", "documentary", "drone", "establishing",
  "footage", "horizontal", "landscape", "macro", "medium", "modern",
  "motion", "overview", "people", "professional", "scene", "shot", "slow",
  "stock", "texture", "up", "video", "view", "visual", "wide",
  "wide-angle", "working"
]);

const PEXELS_QUERY_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but",
  "by", "for", "from", "in", "into", "is", "it", "its", "of", "on",
  "or", "that", "the", "their", "these", "this", "those", "to", "was",
  "were", "with"
]);

const MEANINGLESS_PEXELS_TERMS = new Set([
  "false", "nan", "none", "null", "true", "undefined", "unknown"
]);

const MEANINGLESS_PEXELS_QUERIES = new Set([
  "n a", "no query", "not available", "object object"
]);

const UNSAFE_PEXELS_SINGULARS = new Set([
  "atlas", "bias", "business", "chaos", "cosmos", "economics", "ethics",
  "headquarters", "lens", "mathematics", "means", "news", "physics",
  "politics", "series", "species"
]);

const PEXELS_IRREGULAR_PLURAL_FORMS = new Map([
  ["analyses", "analysis"],
  ["biases", "bias"],
  ["buses", "bus"],
  ["campuses", "campus"],
  ["crises", "crisis"],
  ["focuses", "focus"],
  ["gases", "gas"],
  ["lenses", "lens"],
  ["statuses", "status"],
  ["theses", "thesis"],
  ["viruses", "virus"]
]);

function pexelsTokenMatchForms(token) {
  const normalized = String(token || "").toLowerCase().replace(/[’']/g, "");
  const forms = new Set(normalized ? [normalized] : []);
  if (PEXELS_IRREGULAR_PLURAL_FORMS.has(normalized)) {
    forms.add(PEXELS_IRREGULAR_PLURAL_FORMS.get(normalized));
    return forms;
  }
  if (
    normalized.length <= 3
    || UNSAFE_PEXELS_SINGULARS.has(normalized)
    || normalized.endsWith("ss")
    || normalized.endsWith("us")
    || normalized.endsWith("is")
  ) {
    return forms;
  }
  if (normalized.length > 4 && normalized.endsWith("ies")) {
    forms.add(`${normalized.slice(0, -3)}y`);
    return forms;
  }
  if (normalized.length > 4 && /(ches|shes|xes|zes|sses)$/.test(normalized)) {
    forms.add(normalized.slice(0, -2));
    return forms;
  }
  if (normalized.endsWith("s")) {
    forms.add(normalized.slice(0, -1));
  }
  return forms;
}

function isGenericPexelsToken(token) {
  const normalized = String(token || "").toLowerCase();
  return [...pexelsTokenMatchForms(normalized)].some((form) => (
    GENERIC_PEXELS_TERMS.has(form)
  )) || /^\d+$/.test(normalized);
}

function isConcretePexelsToken(token) {
  const normalized = String(token || "").toLowerCase();
  return Boolean(normalized)
    && !isGenericPexelsToken(normalized)
    && !PEXELS_QUERY_STOPWORDS.has(normalized)
    && !MEANINGLESS_PEXELS_TERMS.has(normalized)
    && /[\p{L}]/u.test(normalized);
}

function isGenericPexelsPhraseToken(token, position, tokens) {
  const normalized = String(token || "").toLowerCase();
  const previous = position > 0
    ? String(tokens[position - 1] || "").toLowerCase()
    : "";
  return normalized === "ups" && previous === "close";
}

function concretePexelsQueryTokens(tokens) {
  return tokens.filter((token, position, allTokens) => (
    isConcretePexelsToken(token)
    && !isGenericPexelsPhraseToken(token, position, allTokens)
  ));
}

function pexelsTokensOverlap(left, right) {
  const leftForms = pexelsTokenMatchForms(left);
  return [...pexelsTokenMatchForms(right)].some((form) => leftForms.has(form));
}

function sanitizePexelsQuery(value) {
  if (typeof value !== "string") return "";
  const tokens = cleanText(value, 120)
    .replace(/[|,;/]+/g, " ")
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  const query = tokens.join(" ");
  if (
    !concretePexelsQueryTokens(tokens).length
    || MEANINGLESS_PEXELS_QUERIES.has(query.toLowerCase())
  ) {
    return "";
  }
  return query;
}

function normalizeMustMatchTerms(rawTerms, pexelsQuery) {
  const queryTokens = sanitizePexelsQuery(pexelsQuery)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const concreteQueryTokens = concretePexelsQueryTokens(queryTokens)
    .filter((token, position, tokens) => tokens.indexOf(token) === position);
  const provided = Array.isArray(rawTerms)
    ? rawTerms
    : typeof rawTerms === "string"
      ? rawTerms.split(",")
      : [];
  const normalized = [];
  for (const candidate of provided) {
    const term = sanitizePexelsQuery(candidate).toLowerCase();
    const tokens = term.split(/\s+/).filter(isConcretePexelsToken);
    if (!term) continue;
    for (const token of tokens) {
      const queryToken = concreteQueryTokens.find((queryCandidate) => (
        pexelsTokensOverlap(token, queryCandidate)
      ));
      if (queryToken && !normalized.includes(queryToken)) normalized.push(queryToken);
      if (normalized.length >= 3) break;
    }
    if (normalized.length >= 3) break;
  }
  for (const queryToken of concreteQueryTokens) {
    if (normalized.length >= 3) break;
    if (!normalized.includes(queryToken)) normalized.push(queryToken);
  }
  return normalized;
}

const SEGMENT_ANGLE_VARIATIONS = [
  ["wide establishing shot", "overview aerial landscape"],
  ["close up detail macro", "detail texture close up"],
  ["medium shot people activity", "people working professional"],
  ["over the shoulder perspective", "perspective depth detail"]
];

export const VISUAL_SEGMENT_COUNT = 4;

export function normalizeVisualSegments(rawSegments, sceneImagePrompt, sceneVisualKeywords, topic, index, options = {}) {
  const allowScenePexelsIntent = options.allowScenePexelsIntent
    ?? Boolean(cleanText(sceneVisualKeywords || "", 150));
  // Jika AI mengembalikan array valid dengan ≥2 item, bersihkan dan pakai (pad ke 4 bila kurang).
  if (Array.isArray(rawSegments) && rawSegments.length >= 2) {
    const segments = rawSegments.slice(0, VISUAL_SEGMENT_COUNT).map((seg) => {
      const segmentKeywords = cleanText(seg?.visualKeywords || "", 150);
      const visualKeywords = segmentKeywords || cleanText(sceneVisualKeywords || "", 150);
      const hasExplicitQuery = Object.prototype.hasOwnProperty.call(seg || {}, "pexelsQuery");
      const pexelsQuery = hasExplicitQuery
        ? sanitizePexelsQuery(seg?.pexelsQuery)
        : sanitizePexelsQuery(segmentKeywords || (allowScenePexelsIntent ? sceneVisualKeywords : ""));
      return {
        imagePrompt: cleanText(seg?.imagePrompt || sceneImagePrompt, 500),
        visualKeywords,
        pexelsQuery,
        mustMatchTerms: pexelsQuery ? normalizeMustMatchTerms(seg?.mustMatchTerms, pexelsQuery) : [],
        narrativeContext: cleanText(seg?.narrativeContext || "", 200)
      };
    });
    // Pad ke 4 segmen dengan variasi angle dari segmen terakhir agar grid 2x2 selalu penuh.
    while (segments.length < VISUAL_SEGMENT_COUNT) {
      const base = segments[segments.length - 1];
      const angle = SEGMENT_ANGLE_VARIATIONS[segments.length % SEGMENT_ANGLE_VARIATIONS.length];
      segments.push({
        ...base,
        imagePrompt: cleanText(`${base.imagePrompt}, ${angle[0]}`, 500),
        mustMatchTerms: [...(base.mustMatchTerms || [])],
        // narrativeContext TIDAK diwarisi: frasa yang sama pada dua segmen membuat
        // computeSegmentDurations() menemukan batas waktu identik (non-monoton),
        // lalu seluruh scene jatuh ke pembagian rata dan sinkron audio-visual hilang.
        narrativeContext: ""
      });
    }
    return segments;
  }

  // Auto-split: buat 4 segmen dari scene-level prompt.
  // Variasikan angle visual agar setiap segmen tidak identik.
  const segCount = VISUAL_SEGMENT_COUNT;
  const segments = [];
  const pexelsQuery = allowScenePexelsIntent ? sanitizePexelsQuery(sceneVisualKeywords) : "";
  const mustMatchTerms = pexelsQuery ? normalizeMustMatchTerms([], pexelsQuery) : [];
  for (let i = 0; i < segCount; i++) {
    const angleLabel = SEGMENT_ANGLE_VARIATIONS[i]?.[0] || "cinematic angle";
    const angleKeywords = SEGMENT_ANGLE_VARIATIONS[i]?.[1] || "documentary footage";
    segments.push({
      imagePrompt: sceneImagePrompt
        ? `${sceneImagePrompt}, ${angleLabel}, horizontal 16:9`
        : fallbackImagePrompt(topic, index) + `, ${angleLabel}`,
      visualKeywords: sceneVisualKeywords
        ? `${sceneVisualKeywords} ${angleKeywords}`.trim().slice(0, 150)
        : `${angleKeywords} documentary`,
      pexelsQuery,
      mustMatchTerms: [...mustMatchTerms],
      narrativeContext: ""
    });
  }
  return segments;
}

function normalizePlan(plan, input) {
  const rawScenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : [];
  const durations = distributeDurations(input.durationSec, input.sceneCount);

  const scenes = rawScenes.slice(0, input.sceneCount).map((scene, index) => {
    const duration = durations[index] || 20;
    const sceneType = resolveSceneType(scene?.sceneType, index, input.sceneCount, input.formatType);
    if (sceneType !== "reaction" && String(scene?.narration || "").trim().length > 4000) {
      throw new Error("Narasi scene terlalu panjang untuk satu TTS. Pecah menjadi scene tambahan, jangan potong naskah.");
    }
    const reactionLine = sceneType === "reaction" ? normalizeReactionNarration(scene, index) : "";
    const screenText = sceneType === "summary"
      ? "Ringkasan Inti"
      : sceneType === "reaction"
        ? reactionLine
        : cleanText(scene?.screenText || `Babak ${index + 1}`, 100);
    const narration = sceneType === "reaction"
      ? reactionLine
      : cleanText(scene?.narration || `Ini adalah bagian penjelasan untuk babak ke-${index + 1}.`, 4000);
    const rawSceneVisualKeywords = sceneType === "reaction" ? "" : cleanText(scene?.visualKeywords || "", 150);
    const sceneVisualKeywords = sceneType === "reaction" ? "" : rawSceneVisualKeywords || fallbackKeywords(index);
    const sceneImagePrompt = sceneType === "reaction" ? "" : cleanText(scene?.imagePrompt || fallbackImagePrompt(input.topic, index), 500);
    return {
      index: index + 1,
      sceneType,
      durationSec: duration,
      narration,
      screenText,
      visualKeywords: sceneVisualKeywords,
      imagePrompt: sceneImagePrompt,
      visualSegments: sceneType === "reaction" ? [] : normalizeVisualSegments(
        scene?.visualSegments,
        sceneImagePrompt,
        sceneVisualKeywords,
        input.topic,
        index,
        { allowScenePexelsIntent: Boolean(rawSceneVisualKeywords) }
      ),
      chapter: cleanText(scene?.chapter || chapterName(index, input.sceneCount), 80),
      beatPurpose: cleanText(scene?.beatPurpose || beatPurpose(index, input.sceneCount), 180),
      reactionCue: cleanText(scene?.reactionCue || reactionCue(index), 120),
      reactionText: sceneType === "reaction" ? reactionLine : "",
      // Opsional; render akan membuang kartu yang frasanya tidak ketemu di audio.
      spotlight: sceneType === "image" ? normalizeSpotlight(scene?.spotlight) : null,
      mediaSource: sceneType === "image" ? normalizeMediaSource(scene?.mediaSource, narration, input.trend) : null
    };
  });

  // Jika scene kurang dari target
  while (scenes.length < input.sceneCount) {
    const index = scenes.length;
    const sceneType = resolveSceneType("", index, input.sceneCount, input.formatType);
    const fbKeywords = sceneType === "reaction" ? "" : fallbackKeywords(index);
    const fbImagePrompt = sceneType === "reaction" ? "" : fallbackImagePrompt(input.topic, index);
    const extraReaction = sceneType === "reaction" ? fallbackReactionNarration(index) : "";
    scenes.push({
      index: index + 1,
      sceneType,
      durationSec: durations[index] || 20,
      narration: sceneType === "reaction"
        ? extraReaction
        : `Ini adalah bagian penjelasan tambahan untuk babak ke-${index + 1}.`,
      screenText: sceneType === "summary"
        ? "Ringkasan Inti"
        : sceneType === "reaction"
          ? extraReaction
          : fallbackScreenText(index, input.sceneCount),
      reactionText: extraReaction,
      visualKeywords: fbKeywords,
      imagePrompt: fbImagePrompt,
      visualSegments: sceneType === "reaction" ? [] : normalizeVisualSegments(
        null,
        fbImagePrompt,
        fbKeywords,
        input.topic,
        index,
        { allowScenePexelsIntent: false }
      ),
      chapter: chapterName(index, input.sceneCount),
      beatPurpose: beatPurpose(index, input.sceneCount),
      reactionCue: reactionCue(index),
      spotlight: null,
      mediaSource: null
    });
  }

  const summary = completeSummary(plan?.summary, plan?.importantPoints, input.topic);
  const summaryScene = scenes.at(-1);
  if (summaryScene) {
    summaryScene.sceneType = "summary";
    summaryScene.screenText = "Ringkasan Inti";
    summaryScene.narration = completeSummaryNarration(summaryScene.narration, summary);
    summaryScene.spotlight = null;
    summaryScene.mediaSource = null;
  }

  let normalized = {
    title: cleanText(plan?.title || input.topic, 100),
    hook: extractHookQuestion(plan?.hook, input.topic),
    flashForwardSceneIndex: resolveFlashForwardSceneIndex(plan?.flashForwardSceneIndex, scenes),
    summary,
    importantPoints: Array.isArray(plan?.importantPoints) ? plan.importantPoints.map(p => cleanText(p, 220)).slice(0, 8) : ["Poin utama pertama."],
    factCheckNote: cleanText(plan?.factCheckNote || "Konten disusun dengan bantuan AI dan belum diverifikasi manual. Periksa ulang fakta penting sebelum dipublikasikan.", 300),
    scenes
  };
  return finalizeNormalizedPlan(normalized, input);
}

function distributeDurations(totalSec, count) {
  const base = Math.floor(totalSec / count);
  const remainder = totalSec % count;
  const list = Array(count).fill(base);
  for (let i = 0; i < remainder; i++) {
    list[i] += 1;
  }
  return list;
}

function fallbackPlan(input, errorMsg = "") {
  const count = input.sceneCount;
  const scenes = [];
  for (let i = 0; i < count; i++) {
    const sceneType = resolveSceneType("", i, count, input.formatType);
    const fbKw = sceneType === "reaction" ? "" : fallbackKeywords(i);
    const fbIp = sceneType === "reaction" ? "" : fallbackImagePrompt(input.topic, i);
    const reactionLine = sceneType === "reaction" ? fallbackReactionNarration(i) : "";
    scenes.push({
      index: i + 1,
      sceneType,
      narration: sceneType === "reaction"
        ? reactionLine
        : fallbackNarration(input.topic, i, count, errorMsg),
      screenText: sceneType === "summary"
        ? "Ringkasan Inti"
        : sceneType === "reaction"
          ? reactionLine
          : fallbackScreenText(i, count),
      reactionText: reactionLine,
      visualKeywords: fbKw,
      imagePrompt: fbIp,
      visualSegments: sceneType === "reaction" ? [] : normalizeVisualSegments(
        null,
        fbIp,
        fbKw,
        input.topic,
        i,
        { allowScenePexelsIntent: false }
      ),
      chapter: chapterName(i, count),
      beatPurpose: beatPurpose(i, count),
      reactionCue: reactionCue(i)
    });
  }
  return {
    title: cleanText(input.topic, 100),
    hook: `Mengapa ${input.topic} menjadi pelajaran penting hari ini?`,
    flashForwardSceneIndex: resolveFlashForwardSceneIndex(null, scenes),
    summary: `Pembahasan ini menelusuri ${input.topic} mulai dari latar belakang, sebab, hingga dampaknya, lalu menutup dengan intisari yang mudah diingat.`,
    importantPoints: [
      `Latar belakang penting seputar ${input.topic}.`,
      `Sebab atau cara kerja utama di balik ${input.topic}.`,
      `Dampak serta pelajaran yang bisa diambil dari ${input.topic}.`
    ],
    scenes
  };
}

export function buildLongformStoryboard(plan) {
  return (plan.scenes || []).map((scene) => ({
    sceneIndex: scene.index,
    sceneType: scene.sceneType || "image",
    chapter: scene.chapter || chapterName(Number(scene.index || 1) - 1, plan.scenes.length),
    durationSec: scene.durationSec,
    screenText: scene.screenText,
    narrativePurpose: scene.beatPurpose || "",
    visualKeywords: scene.visualKeywords,
    visualPrompt: scene.imagePrompt,
    visualSegments: scene.visualSegments || [],
    reactionCue: scene.reactionCue || "",
    mediaSource: scene.mediaSource || null,
    spotlight: scene.spotlight || null,
    narration: scene.narration || "",
    narrationPreview: cleanText(scene.narration, 240)
  }));
}

function finalizeNormalizedPlan(plan, input) {
  const polished = polishPlanForLayAudience(plan, input);
  polished.longformStoryboard = buildLongformStoryboard(polished);
  return polished;
}

function normalizedSceneType(value, index, total) {
  // Legacy function kept for any external callers; delegates to format-aware resolveSceneType
  if (index === total - 1) return "summary";
  return (index + 1) % 3 === 0 && index < total - 2 ? "reaction" : "image";
}

function normalizeReactionNarration(scene, index) {
  const candidates = [
    scene?.reactionText,
    firstSentence(scene?.narration),
    scene?.screenText
  ];
  let text = candidates
    .map((value) => cleanText(value, 180))
    .find((val) => val && !isGenericStoryboardText(val) && !/^(fakta|hal yang berubah|babak|scene|bagian)\b/i.test(val))
    || fallbackReactionNarration(index);

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 16) text = words.slice(0, 16).join(" ");
  if (words.length < 5) text = fallbackReactionNarration(index);
  if (!/[?]$/.test(text.trim())) {
    text = `${text.replace(/[.!]+$/g, "")}?`;
  }
  return text;
}

function firstSentence(value) {
  return String(value || "").match(/^[^.!?]+[.!?]?/)?.[0] || "";
}

function fallbackReactionNarration(index) {
  const lines = [
    "Tapi kenapa tanda penting ini sempat diabaikan?",
    "Lalu, apa yang sebenarnya terjadi setelah itu?",
    "Di sinilah ceritanya mulai berbalik. Apa penyebab utamanya?",
    "Pertanyaannya, apa dampak paling mengejutkan yang terjadi?",
    "Tapi benarkah dampaknya sebesar yang diperkirakan?",
    "Lalu, bagaimana awal mula semua ini bisa terjadi?"
  ];
  return lines[index % lines.length];
}

function completeSummary(summary, importantPoints, topic) {
  const cleaned = cleanText(summary || "", 700);
  if (/[.!?]$/.test(cleaned) && cleaned.length >= 80) return cleaned;
  const points = Array.isArray(importantPoints)
    ? importantPoints.map((point) => cleanText(point, 180).replace(/[.!?]+$/g, "")).filter(Boolean).slice(0, 3)
    : [];
  const fallback = points.length
    ? points.join(". ")
    : `Pembahasan ini menunjukkan inti penting dari ${topic} dan alasan dampaknya masih relevan.`;
  const value = cleaned.length >= 80 ? cleaned : fallback;
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function completeSummaryNarration(sceneNarration, summary) {
  const sceneText = cleanText(sceneNarration || "", 4000);
  const summaryText = cleanText(summary || "", 700);
  const sceneWords = sceneText.split(/\s+/).filter(Boolean).length;
  if (sceneWords >= 50 && /[.!?]$/.test(sceneText)) return sceneText;

  const combined = [sceneText, summaryText]
    .filter(Boolean)
    .filter((value, index, values) => values.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index)
    .join(" ");
  return combined || "Ringkasan inti belum tersedia.";
}

/**
 * Tolak naskah yang tidak mungkin memenuhi durasi target.
 *
 * Sebelumnya naskah fallback offline (~600 kata) — dan naskah AI yang tetap jauh
 * lebih pendek dari target — tetap dirender lalu diunggah, sehingga permintaan
 * video puluhan menit berakhir menjadi video ~5 menit.
 *
 * @throws {Error} status 422 bila naskah terlalu pendek untuk dipublikasikan.
 */
export function assertNarrationLongEnough(plan, input, source) {
  if (input?.allowOfflineDraft || input?.allowOffline) return;
  const words = narrationWordCount(plan);
  const targetWords = Math.round(input.durationSec * MIN_PUBLISHABLE_WORDS_PER_SEC);
  // Bila durationLocked aktif, pipeline akan memperkaya storyboard (enrichLongformDraft)
  // hingga pas durasi target sebelum render/publikasi. Draft awal hanya perlu
  // mencukupi fondasi scene narasi yang sehat (minimal ~30 kata/scene narasi atau ~55% target kata).
  const minimumWords = input?.durationLocked
    ? Math.min(targetWords, Math.max(300, Math.round(targetWords * 0.55)))
    : targetWords;
  if (source === "openai" && words >= minimumWords) return;

  const reason = source === "openai"
    ? `Naskah AI hanya ${words} kata, minimal ${minimumWords} kata untuk video ${input.durationSec} detik${input?.durationLocked ? " (sebelum pengayaan)" : ""}.`
    : `Naskah fallback offline tidak layak publikasi (${words} kata, minimal ${minimumWords} kata).`;
  const error = new Error(`${reason} Run dihentikan sebelum aset dibuat agar video pendek tidak terunggah.`);
  error.status = 422;
  throw error;
}

function narrationWordCount(plan) {
  return (plan.scenes || [])
    .filter((scene) => scene.sceneType !== "reaction")
    .reduce((sum, scene) => sum + String(scene.narration || "").split(/\s+/).filter(Boolean).length, 0);
}

export async function writeLongformStoryboard(item) {
  const storyboardDir = path.join(paths.generatedDir, "storyboards");
  await fs.mkdir(storyboardDir, { recursive: true });
  const filename = `${item.id}-longform-storyboard.json`;
  const outputPath = path.join(storyboardDir, filename);
  await fs.writeFile(outputPath, `${JSON.stringify({
    id: item.id,
    title: item.title,
    topic: item.input.topic,
    category: item.input.category,
    durationSec: item.input.durationSec,
    durationControl: item.assets.durationControl,
    hook: item.plan.hook,
    flashForwardSceneIndex: item.plan.flashForwardSceneIndex,
    sceneCount: item.plan.scenes.length,
    formatType: item.input.formatType,
    angle: item.input.angle,
    sources: Array.isArray(item.plan.sources) ? item.plan.sources : [],
    storyboard: item.plan.longformStoryboard || buildLongformStoryboard(item.plan)
  }, null, 2)}\n`, "utf8");
  return {
    path: outputPath,
    url: `/generated/storyboards/${filename}`,
    count: item.plan.scenes.length
  };
}

function chapterName(index, total) {
  const position = (index + 1) / Math.max(1, total);
  if (position <= 0.12) return "Pembuka";
  if (position <= 0.25) return "Konteks Awal";
  if (position <= 0.38) return "Akar Masalah";
  if (position <= 0.50) return "Bukti Pertama";
  if (position <= 0.62) return "Fakta Lanjutan";
  if (position <= 0.75) return "Sudut Pandang Lain";
  if (position <= 0.88) return "Akibatnya";
  return "Penutup";
}

function beatPurpose(index, total) {
  const position = (index + 1) / Math.max(1, total);
  if (position <= 0.16) return "Membuat penonton paham pertanyaan utamanya.";
  if (position <= 0.42) return "Membuka data, sejarah, atau sebab penting.";
  if (position <= 0.68) return "Menjelaskan masalah utama dengan contoh konkret.";
  if (position <= 0.88) return "Memperlihatkan akibat dan perubahan yang terjadi.";
  return "Menutup cerita dengan intisari yang mudah diingat.";
}

function reactionCue(index) {
  const cues = [
    "ekspresi heran singkat",
    "mengangguk karena fakta masuk akal",
    "mimik skeptis ketika data terasa mengejutkan",
    "ekspresi menemukan petunjuk",
    "reaksi kaget tanpa suara"
  ];
  return cues[index % cues.length];
}

function fallbackScreenText(index, total) {
  const labels = ["Awal Masalah", "Fakta Terlewat", "Bukti Baru", "Angka Penting", "Pilihan Sulit", "Akibatnya", "Arah Berubah", "Pelajaran"];
  return `${labels[index % labels.length]} ${Math.min(total, index + 1)}`;
}

function fallbackKeywords(index) {
  const keywords = [
    "documentary investigation office archive",
    "vintage technology factory research",
    "business meeting strategy failure",
    "macro close up documents evidence",
    "city night timelapse industry change",
    "museum display invention history"
  ];
  return keywords[index % keywords.length];
}

function fallbackImagePrompt(topic, index) {
  return [
    `horizontal cinematic documentary scene about ${topic}`,
    `story beat ${index + 1}`,
    "editorial knowledge video visual, realistic lighting, no text, no watermark"
  ].join(", ");
}

function fallbackNarration(topic, index, total, errorMsg) {
  const intro = index === 0
    ? `Bayangkan sebuah keputusan kecil yang pelan-pelan mengubah arah sebuah cerita besar. Dalam topik ${topic}, bagian paling menarik bukan cuma apa yang terjadi, tetapi kenapa banyak orang baru menyadarinya setelah dampaknya terasa.`
    : `Pada bagian ke-${index + 1}, kita masuk ke bagian berikutnya dari ${topic}. Di sini, pola yang terlihat sederhana mulai menunjukkan sebab dan akibat yang lebih mudah dipahami.`;
  const context = `Kuncinya adalah membaca urutan peristiwa: siapa yang punya pilihan, informasi apa yang mereka abaikan, dan bagaimana keputusan itu menciptakan akibat baru.`;
  const close = index === total - 1
    ? `Dari sini, pelajarannya jelas: fakta besar sering muncul dari detail kecil yang terus berulang sampai akhirnya tidak bisa diabaikan.`
    : `Bagian ini menjadi pijakan untuk memahami bab berikutnya, karena satu detail saja bisa mengubah cara kita melihat keseluruhan cerita.`;
  const apiNote = errorMsg ? "" : "";
  return cleanText(`${intro} ${context} ${close} ${apiNote}`, 1200);
}
