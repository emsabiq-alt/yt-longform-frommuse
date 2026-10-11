import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { estimateTotalCost } from "./cost.js";
import { requestKnowledgeJson } from "./openai.js";
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

  // Grounding fakta dari Wikipedia (gratis, tanpa API key). Hanya saat OpenAI aktif
  // karena fallback offline memakai naskah template yang tidak memanfaatkan fakta.
  let wiki = null;
  if (config.openai.apiKey) {
    try {
      wiki = await fetchWikipediaFacts(input.topic);
      if (wiki?.sources?.length) {
        console.log(`[Wikipedia] Grounding fakta aktif: ${wiki.sources.map((s) => s.title).join(", ")}`);
      }
    } catch (error) {
      console.warn(`[Wikipedia] Lewati grounding: ${error.message}`);
    }
  }

  const promptText = buildPrompt(input, wiki);
  let plan;
  let source = "offline";

  if (config.openai.apiKey) {
    try {
      console.log(`[Story Longform] Meminta naskah AI untuk topik: "${input.topic}" (${input.durationSec}s, ${input.sceneCount} scenes)...`);
      plan = await requestKnowledgeJson(promptText);
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

  const selectedTitle = normalized.title;
  const words = sceneWordRange(input.sceneCount, input.formatType, input.durationSec);
  // Bila durationLocked aktif, pengayaan audio (enrichLongformDraft) akan menambal durasi
  // hingga target tercapai. Revisi draft awal hanya dipicu bila narasi jauh di bawah fondasi scene.
  const minimumNarrationWords = input.durationLocked
    ? Math.min(words.minimumWords, Math.max(words.narratedScenes * 35, Math.round(words.minimumWords * 0.55)))
    : words.minimumWords;
  for (let attempt = 1;
    config.openai.apiKey && narrationWordCount(normalized) < minimumNarrationWords && attempt <= MAX_NARRATION_REVISION_ATTEMPTS;
    attempt++) {
    const currentWords = narrationWordCount(normalized);
    try {
      const expandedPlan = await requestKnowledgeJson([
        promptText,
        "",
        "REVISI WAJIB:",
        `Percobaan revisi ${attempt}/${MAX_NARRATION_REVISION_ATTEMPTS}. Naskah sebelumnya hanya ${currentWords} kata.`,
        `Tulis ulang dengan minimal ${minimumNarrationWords} kata narasi yang benar-benar dibacakan TTS. Jangan mengembalikan naskah sebelum jumlah minimum tercapai.`,
        `Hitung minimum ini hanya dari ${words.narratedScenes} scene image dan summary. Scene reaction juga dibacakan TTS, tetapi tetap pendek dan tidak dihitung dalam minimum narasi utama ini.`,
        `Karena itu setiap scene image HARUS ${words.imageMin}-${words.imageMax} kata dan scene summary ${words.summaryMin}-${words.summaryMax} kata. Jangan menulis lebih pendek dari batas bawah itu.`,
        `Pertahankan tepat jumlah scene dan pola format ${input.formatType}, dengan scene terakhir summary.`
      ].join("\n"));
      normalized = normalizePlan(expandedPlan, input);
      // Revisi panjang naskah tidak boleh menghapus judul yang sudah dipilih
      // Title Engine saat respons revisi AI tidak menyertakan title.
      normalized.title = selectedTitle || normalized.title;
    } catch (error) {
      console.warn(`[Story Longform] Revisi panjang naskah ${attempt}/${MAX_NARRATION_REVISION_ATTEMPTS} gagal: ${error.message}`);
    }
  }

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

function buildPrompt(input, wiki = null) {
  const categoryNote = simplifyForLayAudience(storyNoteFor(input.category), 700);
  const variation = simplifyForLayAudience(pick(STORY_VARIATIONS), 400);
  const formatDesc = simplifyForLayAudience(formatTypeDescription(input.formatType), 500);
  const formatCue = simplifyForLayAudience(formatTypeNarrativeCue(input.formatType), 500);
  const scenePattern = buildScenePattern(input.sceneCount, input.formatType).join(", ");
  const words = sceneWordRange(input.sceneCount, input.formatType, input.durationSec);
  const viralAngle = getViralAngleById(input.viralAngleId);
  const viralBlock = simplifyForLayAudience(
    viralAngleSummary(viralAngle) || `${input.viralAngleLabel || "angle viral"}: Gunakan kemasan yang membuat topik terasa punya konflik, misteri, taruhan, atau akibat yang jelas.`,
    1400
  );
  const wikiBlock = wiki?.facts
    ? [
        "",
        "FAKTA REFERENSI DARI WIKIPEDIA (jadikan dasar fakta, jangan dibantah):",
        wiki.facts,
        "Aturan pemakaian fakta di atas:",
        "- Untuk nama, tanggal, angka, dan tempat, IKUTI referensi ini; jangan menyebut data yang bertentangan.",
        "- Boleh menyusun ulang menjadi narasi yang menarik serta menambah analogi, transisi, dan konteks umum yang aman.",
        "- Jika sebuah detail tidak ada di referensi, hindari mengarang angka atau nama spesifik yang belum tentu benar.",
        "- Isi factCheckNote bahwa fakta inti dirujuk dari Wikipedia dan tetap perlu verifikasi akhir sebelum publikasi."
      ].join("\n")
    : "";
  const trendBlock = trendPromptBlock(input.trend);
  return [
    `FORMAT VIDEO: ${input.formatType}. ${formatDesc}`,
    `PANDUAN NARASI FORMAT: ${formatCue}`,
    `POLA SCENE WAJIB: ${scenePattern}. Scene terakhir wajib summary.`,
    "Buat naskah video dokumenter horizontal landscape (16:9) dalam Bahasa Indonesia untuk channel BanyakTau.",
    "Video berdurasi panjang, jadi bahasanya harus runtut, kaya informasi, dan tetap mudah diikuti orang awam.",
    "GAYA BAHASA DAN PENYAJIAN (WAJIB DIPATUHI):",
    "  - Gunakan gaya bahasa populer yang dinamis, seru, dan berbobot layaknya video essay kelas dunia seperti Lemmino, Vox, atau Veritasium.",
    "  - DILARANG MEMBAHAS FAKTA ELEMENTER / TRIVIA ANAK SEKOLAH DASAR:",
    "    * Penonton adalah orang dewasa dan penggemar sains yang cerdas. JANGAN buang waktu dengan etimologi nama sepele (contoh terlarang: 'kenapa Anak Krakatau disebut anak?', 'kenapa pulau ini dinamakan X?'), definisi dasar kamus ('apa itu gunung api?', 'apa itu tsunami?', 'kenapa magma panas?'), atau fakta umum yang sudah diketahui semua orang.",
    "    * Jangan pernah memasukkan pertanyaan atau adegan yang terdengar seperti buku pelajaran SD.",
    "  - GAYA PERTANYAAN WAJIB KOMPREHENSIF DAN MEMICU PENASARAN TINGGI (HIGH STAKES):",
    "    * Jangan gunakan pertanyaan polos/dangkal di judul, pembuka bab, beatPurpose, maupun scene reaction.",
    "    * Ajukan pertanyaan yang menantang akal sehat, anomali fisika/geologi, paradoks sains, atau kalkulasi ancaman berskala besar.",
    "    * Contoh SALAH (terlalu basic): 'Kenapa Anak Krakatau disebut anak?', 'Apa itu lempeng bumi?', 'Bagaimana gunung meletus?'",
    "    * Contoh BENAR (komprehensif & mendalam): 'Bagaimana reruntuhan letusan 1883 melahirkan kubah magma baru di bawah laut?', 'Mengapa patahan samudra ini mampu menahan tekanan lempeng selama ratusan tahun sebelum melepaskannya sekaligus?', 'Berapa ratus triliun meter kubik gas bertekanan tinggi yang terperangkap di dapur magma?'",
    "  - HINDARI istilah akademis, sosiologis, atau teoritis yang berbelit-belit dan terkesan klise. Pakai benda, kejadian, angka, dan contoh yang konkret.",
    "  - Penonton ingin tahu fakta unik dan jawabannya secara langsung, sederhana, dan konkret.",
    "  - Buat narasi yang to-the-point, jelas, dan fokus pada fakta unik/informasi 'daging' yang memancing rasa penasaran penonton.",
    "  - Tulis seperti sedang bercerita ke teman yang penasaran: kalimat pendek-sedang (rata-rata di bawah 20 kata), aktif, dan hangat. Sapa penonton dengan 'kamu' bila perlu, jangan 'Anda'.",
    "  - Setiap fakta rumit WAJIB langsung disusul satu perbandingan sehari-hari yang bisa dibayangkan (ukuran, berat, waktu, harga, jarak) — misal 'setebal rambut manusia', 'selama satu episode sinetron', 'seberat dua ekor gajah'.",
    "  - Variasikan panjang dan bentuk kalimat antar scene. Jangan setiap scene dibuka dengan pola yang sama; kalimat seragam membuat penonton bosan meski isinya benar.",
    "  - Kata asing atau istilah teknis boleh dipakai maksimal sekali per scene, dan wajib dijelaskan dalam kalimat yang sama dengan bahasa sehari-hari.",
    "  - DILARANG memakai kata: implikasi, mekanisme, signifikan, fundamental, kompleksitas, eksponensial, korelasi, paradigma, esensial, krusial, dinamika, konteks sosial. Ganti dengan padanan sehari-hari.",
    "Hindari gaya bahasa lebay atau pembuka Shorts yang berisik. Penonton video panjang mencari detail faktual ('isinya daging semua').",
    "Struktur cerita harus punya pembuka yang kuat, isi yang maju langkah demi langkah, bagian paling penting yang terasa jelas, dan penutup yang mudah diingat.",
    "Setiap scene harus berisi narasi yang dibacakan oleh TTS dan teks layar (screenText) yang sinkron. Tulis narasi agar mudah dibaca TTS: angka dan satuan ditulis dengan kata-kata (misal 'tiga puluh derajat Celcius', 'seribu kilometer per jam'), hindari singkatan dan simbol seperti %, Rp, AI, 3D, &, kecuali sangat umum.",
    "PENTING UNTUK TTS: Tulis narasi sebagai kalimat-kalimat yang MENGALIR KONTINU. HINDARI titik koma (;), titik tiga (...), tanda kurung, dan tanda kutip karena memicu jeda panjang saat dibacakan. Gunakan koma atau kata sambung ('dan', 'lalu', 'sementara', 'karena') untuk menghubungkan klausa. Satu kalimat = satu napas bicara yang mulus.",
    "Scene reaction WAJIB berupa satu kalimat PERTANYAAN penasaran / cliffhanger singkat (8-16 kata) yang DIAKHIRI DENGAN TANDA TANYA (?). Contoh: 'Tapi benarkah letusan purba ini yang memicu zaman es?' atau 'Lalu apa yang sebenarnya disembunyikan di balik peristiwa ini?'. DILARANG KERAS mengisi screenText atau narration scene reaction dengan judul babak, nomor scene, atau label konsep generik seperti 'Fakta 1', 'Fakta Perubahan', 'Babak 24', dsb. Teks pertanyaan ini yang akan muncul langsung di layar.",
    "Narasi scene reaction juga dibacakan TTS. Buat pertanyaan singkat yang langsung mengantar ke informasi berikutnya tanpa meminta jeda hening.",
    `Setiap scene image wajib memiliki ${words.imageMin}-${words.imageMax} kata narasi. Scene summary wajib memiliki ${words.summaryMin}-${words.summaryMax} kata narasi.`,
    "Scene reaction tidak memerlukan visualKeywords atau imagePrompt. Isi reactionCue dengan ekspresi yang cocok: heran, kaget, skeptis, menemukan petunjuk, atau setuju.",
    "Scene terakhir wajib bertipe summary dengan screenText 'Ringkasan Inti' dan narasi kesimpulan yang tidak kosong.",
    "Buat storyboard longform mendalam: delapan hingga sembilan bab yang berurutan, contoh urutan: pertanyaan utama, konteks awal, akar masalah/sebab, bukti pertama, fakta/data lanjutan, sudut pandang pembanding, dampak/akibat, lalu jawaban dan kesimpulan. Sesuaikan susunan dengan format dan topik, tapi tetap pecah jadi 8-9 bab agar tiap bab punya fokus sempit dan thumbnail chapter YouTube lebih bervariasi.",
    "Perkaya setiap bab dengan bukti, contoh konkret, detail sebab-akibat, atau batas penjelasan yang didukung sumber. Pertahankan kedalaman pembahasan; jangan meringkas bab menjadi satu kalimat untuk mengejar jumlah scene.",
    "Storyboard tidak boleh memakai judul layar generik berulang. Tulis screenText yang spesifik sesuai fakta scene, bukan label konsep umum.",
    "",
    "ANTI-PENGULANGAN NARASI (WAJIB DIPATUHI):",
    "- Jaga pembahasan padat sesuai durasi target. Dahulukan penjelasan inti dan bukti yang relevan; hilangkan pengantar panjang, basa-basi, dan rangkuman berulang di tengah cerita.",
    "- Penuhi anggaran kata dengan informasi terverifikasi yang membantu menjawab topik. Jangan menambah pengulangan, klaim rekaan, atau pertanyaan pengulur waktu untuk mengejar durasi.",
    "- Setiap scene WAJIB menambahkan informasi, fakta, data, contoh, atau cara melihat BARU yang BELUM PERNAH disebut di scene manapun sebelumnya.",
    "- DILARANG mengulang poin yang sama dengan kata-kata berbeda. Jika scene 3 sudah menjelaskan 'kebijakan yang menghambat', scene 4 TIDAK BOLEH mengatakan 'regulasi yang tidak efektif' karena itu poin yang sama.",
    "- Setiap scene harus membuat penonton berkata 'wah saya baru tahu ini'. Hindari informasi yang sudah umum diketahui.",
    "- Gunakan DATA SPESIFIK: angka, tahun, nama orang/tempat/organisasi, perbandingan konkret. Jangan narasi generik yang bisa ditempelkan ke topik apapun.",
    "- AKURASI TAHUN/ANGKA WAJIB: sebutkan tahun/tanggal/angka HANYA jika kamu benar-benar yakin itu fakta sejarah yang tepat (didukung sumber di atas atau pengetahuan umum yang solid). JANGAN mengarang atau menebak tahun demi terdengar spesifik — satu tahun yang salah merusak kredibilitas seluruh video. Kalau ragu-ragu persisnya, gunakan frasa relatif yang tetap konkret (misal 'awal abad ke-20', 'beberapa dekade setelah itu', 'menjelang akhir Perang Dunia Kedua') daripada tahun pasti yang berisiko keliru.",
    "- Progresi narasi: scene awal = latar belakang unik, scene tengah = cara kerja/bukti/data baru di setiap scene, scene akhir = arti atau akibat yang belum dibahas.",
    "- Jangan memakai screenText atau beatPurpose yang sama persis di dua scene berbeda. Gunakan chapter yang sama untuk beberapa scene berurutan yang membahas satu bagian cerita; ubah chapter hanya ketika pembahasan berpindah.",
    "",
    "KNOWLEDGE BEAT (WAJIB untuk setiap scene image/summary):",
    "- Setiap scene harus menjawab TEPAT SATU pertanyaan implisit. Tulis pertanyaan itu di field beatPurpose (misal beatPurpose: 'menjawab: kenapa kapal besi bisa mengapung?').",
    "- Struktur narasi tiap scene: SATU klaim inti + SATU bukti/contoh/angka konkret yang mendukungnya. Jangan menumpuk tiga klaim dangkal dalam satu scene; lebih baik satu klaim yang dibuktikan tuntas.",
    "- Hubungkan scene dengan akibat, bukti, atau gagasan berikutnya secara alami. Gunakan pertanyaan lanjutan hanya bila membantu alur; jangan menutup setiap scene dengan cliffhanger yang berulang.",
    "",
    "PEMBUKA BAB (RETENSI):",
    "- Scene PERTAMA dari setiap chapter baru (field chapter berubah) WAJIB membuka dengan pertanyaan atau ajakan menebak di 1-2 kalimat pertama narasinya (misal 'Coba tebak berapa lama waktu yang dibutuhkan...' atau 'Pertanyaannya, kenapa hal itu bisa terjadi?').",
    "- Jawaban pertanyaan pembuka bab TIDAK boleh langsung diberikan di kalimat berikutnya; ungkap secara bertahap sepanjang bab itu.",
    "- Scene reaction yang berada di batas bab difungsikan sebagai checkpoint tebakan: pertanyaan singkat yang jawabannya dibuka di scene sesudahnya.",
    "",
    "SPOTLIGHT (WAJIB diisi pada scene image yang memenuhi syarat, target 18-22 scene tersebar dari awal sampai bab terakhir):",
    "- Untuk scene yang punya satu fakta paling layak diingat (angka, tahun, nama tokoh, atau istilah kunci), tambahkan field spotlight.",
    "- Format: spotlight: { type:'keypoint'|'figure'|'compare', label, sublabel, phrase } (keypoint/figure) atau { type:'compare', label, value, compareLabel, compareValue, unit, phrase } (compare).",
    "- label = fakta itu sendiri, maksimal 5 kata (misal '1.200 kilometer per jam' atau 'Ibnu Sina'). sublabel = penjelas singkat maksimal 6 kata (misal peran/jabatan tokoh), boleh kosong.",
    "- type 'figure' WAJIB dipakai jika label adalah nama orang/tokoh yang disebut di narration; selain itu gunakan 'keypoint'.",
    "- type 'figure': SELALU isi sublabel dengan jabatan/peran tokoh (misal 'Menteri ESDM', 'Gubernur Jawa Barat', 'Direktur Utama PLN').",
    "- type 'compare' dipakai KHUSUS saat narasi membandingkan dua besaran secara eksplisit (dua nama/subjek + dua angka, atau pola 'X kali lebih besar/dahsyat/panjang dari Y'): isi label (nama subjek pertama, maks 3 kata), value (angka subjek pertama), compareLabel (nama subjek pembanding, maks 3 kata), compareValue (angka subjek pembanding), unit (satuan singkat seperti 'km', 'hari', 'ton'; untuk pola 'X kali lebih besar dari Y' pakai value=X, compareValue=1, unit='x'). Kedua angka WAJIB benar-benar disebut/tersirat eksplisit di narasi; JANGAN mengarang angka pembanding kalau narasi tidak menyebutnya — kalau ragu, pakai 'keypoint' saja.",
    "- phrase = potongan 4-8 kata yang DISALIN PERSIS dari narration scene itu, tepat pada bagian saat nama tokoh atau fakta tersebut diucapkan. Jangan parafrase; kalau tidak bisa menyalin persis, hilangkan field spotlight untuk scene itu.",
    "- Jangan memberi spotlight pada scene reaction atau summary.",
    "",
    "MOCKUP GADGET (SMARTPHONE / TABLET OVERLAY):",
    "- Sebarkan 6-8 scene dengan referensi relevan di seluruh bab. Sertakan mediaSource dari sumber yang tersedia agar tampil memakai template mockup smartphone/tablet milik pengguna. Mockup akan muncul di atas latar video B-roll (tidak tampil bersamaan dengan gambar lain di layar). Foto tokoh, benda, atau dokumen di dalam mockup wajib unik dan sesuai dengan narasi saat itu. Jangan mengarang sumber atau menempelkan artikel yang tidak relevan.",
    `CATATAN KATEGORI (${input.category}): ${categoryNote}`,
    `VARIASI CERITA UNTUK NASKAH INI: ${variation}`,
    `KEMASAN VIRAL UTAMA:\n${viralBlock}`,
    "Gunakan kemasan viral ini sebagai tulang punggung judul, hook 30 detik pertama, dan transisi antar babak. Jangan hanya menempelkannya di judul.",
    "Kembalikan JSON valid saja dengan format:",
    "{ title, hook, flashForwardSceneIndex, summary, importantPoints:[string], factCheckNote, scenes:[{ index, sceneType:'image'|'reaction'|'summary', durationSec, narration, screenText, visualKeywords, imagePrompt, visualSegments:[{ imagePrompt, visualKeywords, pexelsQuery, mustMatchTerms:[string], narrativeContext }], chapter, beatPurpose, reactionCue, spotlight, mediaSource:{ outlet, headline, url, publishedAt } }] }",
    "",
    "JUDUL (cadangan): Buat judul singkat (maksimal 60 karakter), spesifik dengan subjek konkret yang jelas, dan memancing rasa penasaran tanpa terasa template. Judul final akan disempurnakan terpisah, jadi cukup sediakan satu judul layak pakai.",
    "",
    "FIELD 'hook' DALAM JSON (teaser 'flash-forward'):",
    "Field 'hook' adalah SATU-DUA kalimat teaser pembuka (cold open) sebelum intro. WAJIB gaya 'flash-forward':",
    "ungkapkan secara SPESIFIK satu momen/fakta paling mengejutkan yang baru terungkap di PERTENGAHAN atau AKHIR cerita",
    "(bukan pertanyaan generik pembuka, bukan ringkasan topik). Sebutkan detail konkret (angka, nama, akibat) dari",
    "momen itu sendiri, TAPI jangan langsung menjelaskan sebab/jawabannya — itu tugas isi video, bukan hook.",
    "WAJIB: maksimal 15-25 kata, kalimat utuh berdiri sendiri, boleh berbentuk pertanyaan ATAU pernyataan tegas.",
    "Contoh bagus (flash-forward, merujuk fakta spesifik dari tengah/akhir cerita): 'Yang tidak diduga, satu dokumen yang hampir dibuang ini ternyata membalikkan seluruh hasil penyelidikan.' atau 'Bagaimana bisa satu keputusan ini berakhir dengan kerugian satu triliun rupiah dalam semalam?'",
    "Contoh buruk (setup generik, bukan flash-forward): 'Bayangkan Anda datang ke warung kopi yang selalu penuh. Data antrian menunjukkan waktu tunggu...' (terlalu panjang) atau 'Apa yang membuat topik ini menarik?' (tidak spesifik, tidak merujuk momen konkret).",
    "Field 'hook' BERBEDA dari narasi scene 1. Scene 1 boleh panjang; field 'hook' HARUS singkat.",
    "",
    "FIELD 'flashForwardSceneIndex' DALAM JSON:",
    "Angka index scene (field 'index' di array scenes, BUKAN reaction/summary) yang visualnya paling menggambarkan momen yang diceritakan di 'hook'. Pilih scene dari PARUH KEDUA cerita (sekitar 60-85% posisi), bukan scene 1, karena hook menceritakan sesuatu yang baru terungkap belakangan.",
    "",
    "NARASI SCENE 1 (30 DETIK PERTAMA):",
    "Scene 1 HARUS membuat penonton TIDAK BISA meninggalkan video. Gunakan salah satu teknik hook yang kuat dan relevan:",
    "  - Fakta mengejutkan yang melawan intuisi, tetapi sebutkan subjeknya secara jelas",
    "  - Statistik kontroversial dengan sumber jelas",
    "  - Pertanyaan spesifik yang membuat penonton HARUS tahu jawabannya",
    "  - Skenario 'bagaimana jika' yang dramatis dan masuk akal",
    "  - Kontras tajam antara yang dipercaya publik dan bukti yang muncul",
    "  - Detail kecil yang ternyata membuka masalah besar",
    "JANGAN PERNAH mulai dengan 'Halo semuanya', 'Selamat datang', atau perkenalan channel.",
    "Langsung masuk ke inti yang membuat penasaran. Hook menentukan 70% retensi penonton.",
    "",
    `Topik Utama: ${input.topic}`,
    `Kategori: ${input.category}`,
    `Sudut Pandang: ${input.angle}`,
    `Kemasan Viral: ${simplifyForLayAudience(input.viralAngleLabel || viralAngle?.label || input.viralAngleId || "acak", 80)}`,
    `Tone Narasi: ${input.tone}`,
    `Durasi Total: ${input.durationSec} detik`,
    `Jumlah Scene: ${input.sceneCount}`,
    `Target Jumlah Kata: sekitar ${words.targetWords} kata bahasa Indonesia secara keseluruhan.`,
    wikiBlock,
    trendBlock,
    "",
    "PENTING: pexelsQuery pada setiap visualSegment adalah query utama untuk MENCARI VIDEO STOCK di Pexels. visualKeywords tetap wajib sebagai fallback kompatibilitas.",
    "ATURAN DIVERSIFIKASI VISUAL & B-ROLL (UNIVERSAL UNTUK SEMUA TOPIK — ANTI-MONOTON):",
    "  - DILARANG KERAS mengulang jenis subjek/latar visual yang sama lebih dari 2 scene di seluruh naskah video.",
    "    (Contoh terlarang: jika topik tentang laut jangan tampilkan ombak laut terus-menerus; jika tentang komputer jangan hanya ruang kantor/laptop; jika tentang sejarah jangan hanya lukisan monokrom).",
    "  - Di setiap bab (chapter), WAJIB merotasi 5 PILAR PERSPEKTIF VISUAL DOKUMENTER berikut secara bergantian sesuai topik:",
    "    1. PILAR PETA, SKALA MAKRO & LANSKAP KONTEKS:",
    "       * Geologi/Alam: Peta batimetri dasar samudra, citra satelit resolusi tinggi, jalur patahan lempeng.",
    "       * Sejarah/Militer: Peta rute pelayaran kuno, peta pergerakan ekspedisi, tata letak benteng/kota.",
    "       * Teknologi/Industri: Peta jaringan kabel serat optik bawah laut, peta satelit orbit GPS, tata letak megastruktur.",
    "       * Astronomi: Peta lintasan orbit planet, citra teleskop ruang angkasa, peta konstelasi bintang.",
    "    2. PILAR DIAGRAM TEKNIS 3D, SKEMA & IRISAN ANATOMI:",
    "       * Geologi/Bumi: Penampang melintang kerak bumi, kantong dapur magma di mantel bumi, zona patahan tektonik.",
    "       * Sains/Fisika: Diagram penampang mesin jet turbofan, irisan reaktor nuklir, mekanisme gaya apung hidrostatik.",
    "       * Biologi/Medis: Penampang melintang organ/sel tubuh, struktur heliks molekul DNA, kristalografi virus.",
    "       * Teknologi: Skema mikroskopis transistor chip silikon, arsitektur aliran data sistem terdistribusi.",
    "    3. PILAR INSTRUMEN PENGUKURAN, DATA & LAYAR MONITOR:",
    "       * Sains/Bumi: Jarum seismograf analog mencatat tremor, sensor buoy tsunami, monitor radar stasiun cuaca/geofisika.",
    "       * Medis/Kimia: Tampilan mikroskop elektron, jarum osiloskop gelombang frekuensi, monitor EKG, grafik spektrometri massa.",
    "       * Teknologi/Siber: Layar konsol terminal kode baris hijau/cyan, antarmuka ruang kendali misi (mission control), dashboard telemetri.",
    "       * Ekonomi/Sosial: Grafik fluktuasi indeks bursa saham, data statistik perbandingan, dokumen register sensus.",
    "    4. PILAR ARSIP SEJARAH ASLI, MANUSKRIP & ARTEFAK FISIK:",
    "       * Sejarah/Misteri: Lembaran naskah kuno bersejarah, kliping surat kabar litografi abad ke-19, foto arsip hitam-putih, relief prasasti batu.",
    "       * Penemuan: Sketsa gambar paten asli penemu, buku catatan jurnal eksperimen laboratorium, prototipe mesin awal.",
    "       * Alam/Bumi: Lapisan batuan purba (tephra/sedimen), sampel inti bor silinder geologi, fosil terawetkan, batu meteorit.",
    "    5. PILAR AKSI DINAMIS LAPANGAN, EKSPERIMEN & B-ROLL MANUSIA:",
    "       * Riset: Ahli sains melakukan uji reaksi kimia di tabung reaksi, arkeolog membersihkan artefak dengan kuas, geolog meneliti tebing batuan.",
    "       * Operasional Nyata: Lengan robot perakitan pabrik otomasi, teknisi di ruang server atau menara transmisi, kapal riset beroperasi di laut lepas.",
    "       * Simulasi/Uji Coba: Pengujian aerodinamika terowongan angin, simulasi permodelan komputer, tim evakuasi darurat.",
    "  - pexelsQuery dan visualKeywords HARUS KONKRET, SPESIFIK, dan LANGSUNG MENGACU pada instrumen, data, atau aksi yang dibahas di narasi scene:",
    "    * Contoh BAGUS: 'seismograph needle earthquake recording', 'microscope cells laboratory analysis', 'jet engine turbine cross section', 'ancient parchment manuscript map', 'satellite earth radar display', 'computer server room technician', 'geologist inspecting rock cliff'.",
    "    * Contoh BURUK & TERLARANG: 'ocean waves aerial' (generik), 'water surface' (membosankan), 'modern office meeting' (clutter), 'abstract technology' (tidak bermakna).",
    "  - mustMatchTerms WAJIB berupa kata benda teknis/objek konkret yang benar-benar ada di narrativeContext (misal: ['seismograph'], ['turbine'], ['microscope'], ['satellite'], ['manuscript'], ['chip'], ['drill'], ['radar']), BUKAN kata umum filler.",
    "FALLBACK IMAGE PROMPT (imagePrompt) untuk scene image/summary wajib menggambarkan ilustrasi 16:9 sinematik yang artistik tanpa teks/tulisan di dalamnya.",
    "",
    "VISUAL SEGMENTS (WAJIB untuk scene image/summary, TIDAK untuk reaction):",
    "Durasi tiap scene mengikuti panjang narasinya. Siapkan beberapa gambar/video yang berganti sesuai alur narasi.",
    `Setiap scene image/summary WAJIB punya array 'visualSegments' berisi TEPAT ${VISUAL_SEGMENT_COUNT} sub-visual berurutan.`,
    "Pergantian sub-visual mengikuti kalimat narasi; sisipkan detail, sumber dalam mockup, dan spotlight yang relevan agar adegan panjang tetap hidup.",
    "Keempat sub-visual itu HARUS membentuk PROGRESI VISUAL yang mengikuti seluruh urutan narasi scene:",
    "  - Sub-visual 1 = apa yang terlihat saat kalimat pembuka scene dibacakan.",
    "  - Sub-visual 2 = bukti/detail pertama di bagian tengah awal.",
    "  - Sub-visual 3 = perkembangan/konflik/data di bagian tengah akhir.",
    "  - Sub-visual 4 = penutup/akibat/kesimpulan bagian akhir narasi scene.",
    "KONTINUITAS: keempat sub-visual harus terasa seperti satu rangkaian cerita — subjek utama, lokasi, atau objek kunci yang sama berlanjut antar sub-visual (berubah sudut pandang, jarak, atau momen), BUKAN 4 gambar acak yang tidak berhubungan.",
    "Setiap sub-visual menggambarkan APA yang harus TERLIHAT di layar saat bagian narasi itu dibacakan.",
    "narrativeContext (SANGAT PENTING untuk sinkronisasi): WAJIB berupa potongan frasa 3-8 kata yang DISALIN PERSIS (verbatim) dari teks narration scene itu, sesuai urutan kemunculannya. Sistem memakai frasa ini untuk mengganti gambar TEPAT saat frasa itu diucapkan oleh narator. Jangan memparafrase, jangan menerjemahkan, jangan mengarang frasa yang tidak ada di narration.",
    "  - narrativeContext sub-visual 1 diambil dari bagian AWAL narration, sub-visual 2-3 dari bagian TENGAH, sub-visual 4 dari bagian AKHIR, tanpa saling mendahului.",
    "Setiap sub-visual juga WAJIB punya pexelsQuery dan mustMatchTerms untuk pencarian stock video:",
    "  - pexelsQuery: satu frasa pencarian stock dalam bahasa Inggris, konkret, idealnya 3-7 kata.",
    "  - mustMatchTerms: array berisi 1-3 istilah subjek bahasa Inggris yang wajib tampak relevan pada hasil.",
    "  - mustMatchTerms WAJIB berupa terjemahan Inggris dari benda/pelaku yang BENAR-BENAR disebut di narrativeContext sub-visual itu. Kalau frasanya berbunyi 'rongga udara di dalam lambung', mustMatchTerms-nya ['ship', 'hull'], bukan ['ocean'].",
    "  - Jangan isi pexelsQuery dengan konsep abstrak atau kata generik seperti 'documentary footage'.",
    "Contoh scene tentang 'cermin lift untuk aksesibilitas' (perhatikan progresi + kontinuitas subjek lift; narrativeContext di contoh ini adalah frasa yang memang muncul verbatim di narration scene-nya):",
    "  visualSegments: [",
    "    { imagePrompt: 'wheelchair user approaching modern elevator, horizontal cinematic', visualKeywords: 'wheelchair elevator entrance', pexelsQuery: 'wheelchair user entering elevator', mustMatchTerms: ['wheelchair', 'elevator'], narrativeContext: 'cermin membantu pengguna kursi roda' },",
    "    { imagePrompt: 'wheelchair user inside elevator facing mirror, medium shot', visualKeywords: 'wheelchair inside elevator mirror', pexelsQuery: 'wheelchair user inside elevator', mustMatchTerms: ['wheelchair', 'elevator'], narrativeContext: 'posisi masuk tanpa bisa berbalik' },",
    "    { imagePrompt: 'elevator mirror reflection showing buttons panel, close up', visualKeywords: 'elevator buttons panel mirror', pexelsQuery: 'elevator mirror buttons panel', mustMatchTerms: ['elevator', 'buttons'], narrativeContext: 'melihat tombol lewat pantulan cermin' },",
    "    { imagePrompt: 'modern accessible elevator interior wide angle', visualKeywords: 'modern elevator interior design', pexelsQuery: 'modern accessible elevator interior', mustMatchTerms: ['elevator'], narrativeContext: 'standar aksesibilitas internasional' }",
    "  ]",
    "Setiap sub-visual HARUS relevan dengan bagian narasi yang sedang dibacakan saat itu.",
    "Field visualKeywords dan imagePrompt di level scene tetap wajib diisi sebagai fallback.",
    "",
    "CHAPTER THUMBNAIL DIVERSITY (WAJIB):",
    "Setiap kali scene memulai chapter baru (field 'chapter' berbeda dari scene sebelumnya), imagePrompt scene itu HARUS:",
    "  - Menampilkan WARNA DOMINAN yang berbeda dari chapter sebelumnya (mis. biru → oranye → hijau → merah → kuning).",
    "  - Menampilkan LOKASI atau SETTING yang berbeda (mis. ruang sidang → pantai → kota → hutan → laboratorium).",
    "  - Menampilkan SUBJEK UTAMA yang berbeda (bukan hanya sudut pandang berbeda dari objek yang sama).",
    "Tujuannya: YouTube mengambil frame pertama tiap chapter sebagai thumbnail chapter. Jika semua chapter opener terlihat sama (tone gelap, stock footage serupa), semua thumbnail chapter akan identik dan membingungkan penonton.",
    "Pastikan imagePrompt dan visualSegments[0].imagePrompt dari chapter opener secara visual mencolok berbeda dari chapter opener sebelumnya."
  ].join("\n");
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
