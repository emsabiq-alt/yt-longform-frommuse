/**
 * Topic Engine - pemilih topik mandiri untuk video longform.
 *
 * Tujuan: setiap kali topik dikosongkan, sistem memikirkan sendiri topik
 * BARU yang belum pernah dibuat (anti-duplikat), dengan variasi kategori,
 * sudut pandang, dan formatType. Tidak lagi default ke satu topik tertentu.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config, paths } from "./config.js";
import { requestIdeaJsonWithFallback } from "./deepseek.js";
import { cleanText } from "./util.js";
import { FORMAT_TYPES, pickFormatType } from "./format-engine.js";
import { loadHistory, checkFreshness, pickFreshIdeaFromBatch } from "./continuity-engine.js";
import { buildTrendingContext, formatTrendingForPrompt } from "./youtube-trends.js";
import { fetchTopSustainedNewsTopic } from "./google-news-trends.js";
import { pickViralAngle, viralAnglePromptList, viralAngleSummary } from "./viral-angle-library.js";
import { simplifyForLayAudience } from "./story-language.js";

export const TOPIC_CATEGORIES = [
  "vulkanologi", "geologi",
  "sains", "penemuan", "sejarah", "tubuh manusia", "alam semesta",
  "teknologi", "benda sehari-hari", "tokoh dunia", "bahasa dan budaya",
  "makanan dan dapur", "material dan warna", "peta dan navigasi",
  "suara dan musik", "infrastruktur tersembunyi", "ekologi mikro",
  "ekonomi dan bisnis", "psikologi", "hewan dan tumbuhan", "luar angkasa",
  "arsitektur", "transportasi", "energi", "matematika sehari-hari", "misteri sejarah"
];

const SPACE_CATEGORY = "luar angkasa";
const VOLCANO_CATEGORY = "vulkanologi";

/**
 * Banyak sudut pandang per kategori agar cerita tidak itu-itu saja.
 * Setiap kategori punya 6–10 cara membahas topik.
 */
const CATEGORY_ANGLES = {
  vulkanologi: [
    "zona subduksi dan patahan megathrust samudra yang terkunci",
    "letusan supervolcano purba dan dampaknya bagi iklim global",
    "letusan bersejarah yang mengubah iklim dunia dan kelaparan massal",
    "api biru, gas beracun, dan danau kawah asam paling mematikan di dunia",
    "misteri dapur magma puluhan kilometer di bawah kerak bumi",
    "tsunami vulkanik akibat longsoran dinding kaldera bawah laut",
    "kelahiran pulau vulkanik baru dari perut samudra",
    "anomali hidrotermal dan semburan lumpur panas tak berujung",
    "simulasi skenario kiamat jika kaldera purba meletus lagi hari ini",
    "ancaman piroklastik kilat di gunung api aktif dekat pemukiman padat",
    "bagaimana ilmuwan memetakan kantung magma tanpa menyedotnya",
    "jejak peradaban manusia purba yang terputus oleh abu vulkanik"
  ],
  geologi: [
    "pergerakan lempeng tektonik yang mengoyak benua",
    "palung samudra terdalam dan fenomena dasar samudra",
    "patahan sesar aktif yang mengintai kota-kota besar",
    "pembentukan batuan purba dan mineral langka di perut bumi",
    "daratan benua yang tenggelam di masa prasejarah"
  ],
  sains: [
    "kenapa fenomena ini terjadi di level atom",
    "eksperimen kuno yang membuka pemahaman modern",
    "kesalahpahaman ilmiah yang populer di masyarakat",
    "perbandingan skala: dari mikro hingga kosmis",
    "proses alami yang berlangsung ribuan tahun",
    "teori yang hampir ditinggal tapi ternyata benar",
    "bagaimana ilmuwan pertama kali membuktikannya"
  ],
  penemuan: [
    "kisah kegagalan berulang sebelum akhirnya berhasil",
    "penemuan tak sengaja yang mengubah dunia",
    "siapa penemu sebenarnya yang terlupakan sejarah",
    "bagaimana penemuan ini dieksploitasi oleh orang lain",
    "evolusi desain dari versi pertama sampai sekarang",
    "konflik paten dan klaim penemuan"
  ],
  sejarah: [
    "peristiwa penting yang hampir tidak tercatat",
    "dampak jangka panjang yang belum disadari",
    "tokoh pinggiran yang mengubah arah sejarah",
    "keputusan kecil yang membawa perubahan besar",
    "versi sejarah yang sering disalahartikan",
    "bagaimana peristiwa ini membentuk kehidupan sekarang"
  ],
  "tubuh manusia": [
    "mekanisme biologis yang bekerja tanpa kita sadari",
    "evolusi anggota tubuh dari hewan purba",
    "mitos kesehatan yang sudah terbukti keliru",
    "bagaimana otak menipu indra kita",
    "proses regenerasi dan batas kemampuan tubuh",
    "perbedaan biologis yang sering diabaikan"
  ],
  "alam semesta": [
    "objek kosmis yang belum punya penjelasan pasti",
    "perjalanan waktu cahaya dari masa purba",
    "bagaimana manusia mengukur sesuatu yang tak terjangkau",
    "fenomena langka yang akan terjadi di masa depan",
    "tabrakan dan kelahiran benda langit",
    "kehidupan di luar bumi: kemungkinan dan bukti"
  ],
  teknologi: [
    "bagaimana algoritma mengubah perilaku manusia",
    "teknologi mati yang dulunya menjadi masa depan",
    "komponen kecil dengan dampak sistemik besar",
    "perlombaan teknologi antarnegara/perusahaan",
    "etika dan risiko yang tertinggal dari inovasi",
    "evolusi interface dari mekanis hingga digital"
  ],
  "benda sehari-hari": [
    "rahasia desain yang disembunyikan di depan mata",
    "mengapa bentuk dan warnanya seperti itu",
    "jejak sejarah dalam benda yang kita anggap biasa",
    "proses produksi massal yang kompleks",
    "alternatif lain yang kalah populer",
    "bagaimana benda ini mengubah rutinitas manusia"
  ],
  "tokoh dunia": [
    "keputusan kontroversial yang mengubah legasi",
    "kehidupan awal yang membentuk karakter",
    "orang terlupakan di balik kesuksesan tokoh besar",
    "dampak tak terduga dari satu tindakan tokoh",
    "bagaimana karya mereka hampir tidak diterima",
    "konspirasi dan mitos yang menyelimuti namanya"
  ],
  "bahasa dan budaya": [
    "asal-usul kata yang mencerminkan sejarah",
    "bahasa yang hampir punah dan upaya penyelamatan",
    "kesalahpahaman budaya antarbangsa",
    "evolusi tulisan dari simbol hingga alfabet",
    "ungkapan yang kehilangan makna aslinya",
    "bagaimana bahasa membentuk cara berpikir"
  ],
  "makanan dan dapur": [
    "proses kimiawi di balik transformasi rasa",
    "sejarah globalisasi satu bahan makanan",
    "mitos makanan yang sulit dilenyapkan",
    "teknik tradisional yang lebih canggih dari modern",
    "bagaimana industri makanan menciptakan selera",
    "makanan yang hampir punah dan bangkit kembali"
  ],
  "material dan warna": [
    "mengapa warna tertentu langka di alam",
    "proses ekstraksi bahan yang rumit",
    "material baru yang menggantikan tradisi berabad-abad",
    "simbolisme warna di berbagai peradaban",
    "ketahanan material dalam kondisi ekstrem",
    "dampak lingkungan dari produksi satu material"
  ],
  "peta dan navigasi": [
    "bagaimana manusia menavigasi sebelum kompas dan GPS",
    "distorsi peta yang mengubah persepsi dunia",
    "batas wilayah paling aneh di dunia",
    "teknologi navigasi rahasia dalam perang",
    "jejak penjelajah yang salah petah",
    "bagaimana koordinat diciptakan dan disepakati"
  ],
  "suara dan musik": [
    "fisika di balik nada dan getaran",
    "instrumen kuno dengan teknologi memukau",
    "bagaimana musik memengaruhi otak dan emosi",
    "genre musik yang lahir dari konflik sosial",
    "rekaman suara paling bersejarah",
    "fenomena suara alam yang belum terpecahkan"
  ],
  "infrastruktur tersembunyi": [
    "jaringan bawah tanah yang menopang kota modern",
    "bagaimana limbah kota dikelola tanpa kita sadari",
    "infrastruktur tua yang masih dipakai hingga kini",
    "proyek raksasa yang gagal atau dibatalkan",
    "teknologi sistemik yang jarang mendapat pujian",
    "dampak urbanisasi terhadap sumber daya tersembunyi"
  ],
  "ekologi mikro": [
    "dunia mikroba yang mengendalikan ekosistem",
    "symbiosis aneh antara makhluk hidup",
    "bagaimana satu spesies menghancurkan ekosistem",
    "proses dekomposisi yang mengembalikan kehidupan",
    "penyesuaian ekstrem makhluk kecil",
    "peran serangga yang diremehkan manusia"
  ],
  "ekonomi dan bisnis": [
    "bubble ekonomi yang hampir tidak terdeteksi",
    "produk gagal yang meruntuhkan perusahaan raksasa",
    "bagaimana harga sesungguhnya ditentukan",
    "strategi pemasaran yang mengubah kebiasaan konsumsi",
    "pasar gelap dan ekonomi informal",
    "inovasi bisnis yang lahir dari krisis"
  ],
  psikologi: [
    "bias kognitif yang mengendalikan keputusan kita",
    "eksperimen psikologi paling menggemparkan",
    "bagaimana ingatan bisa berubah tanpa kita sadari",
    "fenomena sosial yang memunculkan perilaku aneh",
    "bagaimana otak menangani kehilangan dan penguasaan",
    "perbedaan cara berpikir antargenerasi"
  ],
  "hewan dan tumbuhan": [
    "kemampuan super alami yang melebihi teknologi manusia",
    "proses evolusi yang terjadi dalam waktu singkat",
    "hubungan antara hewan dan manusia yang berubah drastis",
    "spesies yang bangkit dari kepunahan",
    "mekanisme bertahan hidup di kondisi paling ekstrem",
    "bagaimana satu tumbuhan mengubah sejarah manusia"
  ],
  "luar angkasa": [
    "misil dan satelit yang hampir memicu konflik",
    "kehidupan astronot yang tidak pernah ditampilkan",
    "teknologi luar angkasa yang dipakai di bumi",
    "planet/bulan yang lebih aneh dari fiksi",
    "perlombaan luar angkasa: rahasia dan kebohongan",
    "misi gagal yang memberi pelajaran berharga",
    "fisika aneh di sekitar lubang hitam dan bintang neutron",
    "sinyal misterius yang datang dari ruang antarbintang",
    "bagaimana ilmuwan mengukur sesuatu yang tak bisa didatangi",
    "perubahan iklim dan cuaca ekstrem di planet lain",
    "benda langit yang mengancam bumi dan cara mendeteksinya",
    "misteri materi gelap dan energi gelap"
  ],
  arsitektur: [
    "struktur kuno yang defy teknologi zamannya",
    "desain bangunan yang menyembunyikan pesan rahasia",
    "bagaimana arsitektur mengendalikan perilaku manusia",
    "bangunan gagal dengan biaya fantastis",
    "material lokal yang membentuk gaya regional",
    "renovasi modern yang merusak warisan asli"
  ],
  transportasi: [
    "kendaraan revolusioner yang gagal di pasaran",
    "infrastruktur transportasi yang mengubah geografi",
    "bagaimana moda transportasi membentuk kota",
    "kecelakaan yang mengubah regulasi selamanya",
    "teknologi propulsi dari uap hingga listrik",
    "rute paling berbahaya yang masih aktif"
  ],
  energi: [
    "transisi energi yang hampir terjadi lebih awal",
    "sumber energi tersembunyi di alam",
    "bencana industri energi dan pelajarannya",
    "bagaimana satu bahan bakar mengubah geopolitik",
    "inovasi hemat energi yang ditemukan secara tidak sengaja",
    "pembangkit listrik dengan desain paling unik"
  ],
  "matematika sehari-hari": [
    "pola matematika di alam yang membingungkan ilmuwan",
    "bagaimana statistik bisa berbohong",
    "sistem satuan yang dibuat dengan cara aneh",
    "teori permainan dalam konflik sehari-hari",
    "bilangan dan konsep yang sulit dibayangkan",
    "algoritma sederhana yang mengatur dunia modern"
  ],
  "misteri sejarah": [
    "artefak dengan asal-usul yang tidak bisa dijelaskan",
    "peristiwa massal yang menghilang dari catatan",
    "teori alternatif yang ternyata punya bukti kuat",
    "kode dan simbol kuno yang baru terpecahkan",
    "tokoh sejarah dengan kematian mencurigakan",
    "lokasi legenda yang ditemukan secara tidak sengaja"
  ]
};

const DEFAULT_ANGLES = [
  "kenapa bisa terjadi", "bagaimana cara kerjanya", "asal-usul yang jarang diketahui",
  "kesalahpahaman umum yang ternyata keliru", "dampak tak terduga",
  "rahasia di balik benda biasa", "kisah kegagalan yang mengubah dunia",
  "penemuan tak sengaja", "fakta yang melawan akal sehat", "evolusi dari masa ke masa"
];

// Kategori "pertanyaan sehari-hari" yang paling relatable bagi orang awam.
// Mode "Seimbang": ~60% topik diambil dari kategori ini, sisanya tetap variasi penuh.
const EVERYDAY_CATEGORIES = new Set([
  "sains", "tubuh manusia", "benda sehari-hari", "makanan dan dapur",
  "hewan dan tumbuhan", "psikologi", "material dan warna", "suara dan musik",
  "matematika sehari-hari", "alam semesta", "peta dan navigasi"
]);

// Tebak kategori everyday dari kata kunci seed offline agar topik↔kategori↔angle koheren.
function inferEverydayCategory(topic) {
  const t = String(topic || "").toLowerCase();
  const map = [
    [/kucing|anjing|hewan|semut|burung|ikan|lebah|tumbuh|pohon|tanaman|terumbu|karang/, "hewan dan tumbuhan"],
    [/tubuh|otak|mata|tidur|darah|jantung|bayi|ingat|lupa|menangis|mendengkur/, "tubuh manusia"],
    [/madu|roti|garam|makan|masak|dapur|kopi|teh|ragi|bawang|gula/, "makanan dan dapur"],
    [/langit|bintang|planet|bulan|matahari|galaksi|angkasa|kosmos/, "alam semesta"],
    [/kompas|peta|navigasi|arah|utara|gps/, "peta dan navigasi"],
    [/kaca|es|air|logam|warna|material|baterai|cermin|biru/, "material dan warna"],
    [/keyboard|ponsel|listrik|mesin|komputer|internet|lampu/, "teknologi"],
    [/angka|nol|matematik|statistik|waktu|jam/, "matematika sehari-hari"]
  ];
  for (const [re, cat] of map) if (re.test(t)) return cat;
  return "benda sehari-hari";
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function isDuplicate(candidate, history, threshold = 0.5) {
  return !checkFreshness(
    { topic: candidate, title: candidate, category: "", angle: "", formatType: "" },
    history,
    { topicThreshold: threshold, titleThreshold: threshold }
  ).isFresh;
}

function categoryAngles(category) {
  const key = String(category || "").toLowerCase().trim();
  const list = CATEGORY_ANGLES[key] || CATEGORY_ANGLES[key.replace(/[^a-z0-9]/g, "")];
  return list && list.length ? list : DEFAULT_ANGLES;
}

function buildIdeaPrompt(history, category, angle, formatType, viralAngle, trendingContext = null) {
  const recent = history
    .slice(0, 80)
    .map((item) => {
      const topic = simplifyForLayAudience(item.topic || "", 180);
      const title = simplifyForLayAudience(item.title || "", 120);
      return `- [${item.category || "umum"}] ${topic}${title && title !== topic ? ` | judul: ${title}` : ""}`;
    })
    .join("\n") || "- (belum ada)";
  const anglesForCategory = categoryAngles(category).map((value) => simplifyForLayAudience(value, 140)).join("; ");
  const ft = FORMAT_TYPES[formatType];
  const label = ft?.label || formatType;
  const description = simplifyForLayAudience(ft?.description || "", 400);
  const trendingBlock = simplifyForLayAudience(formatTrendingForPrompt(trendingContext), 2000);
  const viralBlock = simplifyForLayAudience(viralAngleSummary(viralAngle), 1400);
  const viralList = simplifyForLayAudience(viralAnglePromptList(), 2000);
  const spaceFocus = category === SPACE_CATEGORY
    ? [
      "MODE LUAR ANGKASA: topik wajib benar-benar membahas astronomi atau antariksa,",
      "bukan sekadar teknologi umum. Variasikan objek dan skala: planet, bulan, bintang,",
      "lubang hitam, galaksi, kosmologi, astronot, teleskop, satelit, dan misi antariksa.",
      "Jangan mengulang subjek atau pertanyaan yang sudah ada di riwayat."
    ].join(" ")
    : "";

  const volcanoFocus = (category === VOLCANO_CATEGORY || category === "geologi")
    ? [
      "MODE VULKANOLOGI & GEOLOGI (PRIORITAS UTAMA CHANNEL BANYAK TAU):",
      "Topik wajib membahas fenomena gunung api, letusan dahsyat, megathrust, pergerakan lempeng tektonik, tsunami vulkanik,",
      "dapur magma, danau kawah purba, anomali hidrotermal, sesar aktif, atau bencana geologis skala masif.",
      "CARI PEMBAHASAN YANG SANGAT VARIATIF & BERBEDA-BEDA: jangan melulu mengulang Anak Krakatau.",
      "Eksplorasi variasi tema secara luas:",
      "1) Supervolcano & iklim purba (Danau Toba, Tambora 1815, Samalas/Rinjani 1257, Yellowstone, Taupo, Santorini).",
      "2) Megathrust & zona subduksi samudra (Patahan Selat Sunda, Megathrust Mentawai, Palung Jawa, Sesar Lembang, Sesar Palu-Koro).",
      "3) Anomali kawah & gas mematikan (Api biru & danau asam maut Kawah Ijen, 3 warna Danau Kelimutu, semburan gas CO2 Danau Nyos, Danau Matano purba).",
      "4) Dinamika dapur magma & tomografi (bagaimana ilmuwan melihat kantung magma 26 km di bawah tanah tanpa menyedotnya, batuan beku, magma 1000 derajat).",
      "5) Gunung api bawah laut & pulau baru (Banua Wuhu, Hunga Tonga, Kavachi, runtuhan dinding kaldera yang memicu tsunami kilat).",
      "6) Skenario simulasi bahaya modern (Gunung Merapi, Kelud, Sinabung, Semeru, atau simulasi jika Toba meletus lagi hari ini).",
      "7) Anomali hidrotermal & semburan misterius (Lumpur Lapindo Sidoarjo, geotermal Dieng, ventilasi hidrotermal samudra dalam).",
      "Pastikan setiap topik punya tensi tinggi, rasa penasaran besar, dan menyebut subjek nyata yang memicu klik."
    ].join("\n")
    : "";

  const universalRule = (category === VOLCANO_CATEGORY || category === "geologi")
    ? "FOKUS GEOLOGI & VULKANOLOGI: Boleh berfokus pada gunung api, patahan, dan peristiwa geologis legendaris Indonesia (Krakatau, Toba, Tambora, Ijen, Merapi, Selat Sunda, Mentawai, Palung Jawa) maupun dunia (Yellowstone, Vesuvius, Pompeii, Tonga), karena fenomena alam ini berskala masif dan sangat diminati penonton."
    : "WAJIB UNIVERSAL: topik harus menarik bagi penonton di negara mana pun. JANGAN membuat topik yang terikat pada kota, daerah, tokoh, atau kejadian lokal Indonesia (mis. 'kenapa Bandung macet'). Tempat spesifik boleh disebut HANYA jika terkenal secara global (mis. Piramida Giza, Tembok Besar, Segitiga Bermuda). Bahasa penyampaian tetap Indonesia, tapi subjeknya mendunia.";

  return [
    "Kamu produser konten edukasi YouTube berbahasa Indonesia.",
    "Usulkan 8 IDE TOPIK video panjang yang faktual, menarik, dan membuat penasaran.",
    "PRIORITAS UTAMA: pertanyaan yang membuat penasaran tinggi, punya tensi naratif, dan menyebut subjek konkret yang dikenal orang.",
    "Tulis setiap 'topic' sebagai PERTANYAAN yang menyebut SUBJEK KONKRET (benda/makhluk/tempat/fenomena nyata),",
    "bukan tema yang sulit dibayangkan. Hindari kata ganti kabur seperti 'hal ini' atau 'kejadian ini'.",
    "DILARANG KERAS PERTANYAAN ELEMENTER / TRIVIA SEPELE: JANGAN buat pertanyaan definisi dasar atau asal-usul nama anak-anak (contoh terlarang: 'Kenapa dinamakan anak', 'Kenapa disebut X', 'Apa itu gunung api').",
    "GAYA PERTANYAAN WAJIB KOMPREHENSIF & BERBOBOT TINGGI: Fokus pada anomali fisika/geologi tersembunyi, paradoks ilmiah, kontroversi data satelit/seismik, kegagalan prediksi, atau ancaman skala kehancuran besar.",
    universalRule,
    spaceFocus,
    volcanoFocus,
    `Fokus kategori: ${category}. Sudut pandang yang diutamakan: ${simplifyForLayAudience(angle, 140)}.`,
    `Format video yang wajib digunakan: ${label}. ${description}`,
    `Kemasan viral utama yang wajib dipakai:\n${viralBlock}`,
    "Bank angle viral lain untuk variasi diksi, jangan dipakai semuanya sekaligus:",
    viralList,
    "Topik harus SPESIFIK dan unik, bukan tema umum yang luas.",
    "Topik harus sudah terasa seperti ide video yang punya konflik, misteri, taruhan, atau akibat yang jelas.",
    "Jangan buat topik netral seperti judul ensiklopedia. Hindari format 'Penjelasan tentang X'.",
    `Daftar sudut pandang yang tersedia untuk kategori ${category}: ${anglesForCategory}.`,
    trendingBlock ? `\n${trendingBlock}\n` : "",
    "WAJIB hindari kemiripan dengan daftar topik yang SUDAH PERNAH dibuat berikut:",
    recent,
    "Jangan mengusulkan ulang subjek, tokoh, objek, tempat, atau peristiwa yang sama walau judul dan angle berbeda.",
    "Variasikan objek, tokoh, tempat, dan era. Jangan semuanya tentang bisnis/perusahaan.",
    "Untuk SETIAP ide, beri 'viralScore' 0-100 = perkiraan potensi banyak ditonton, dinilai dari:",
    "relatable bagi orang awam + rasa penasaran + sering dicari/ditanyakan orang + evergreen (tahan lama).",
    "Kembalikan JSON valid saja dengan format:",
    '{ "ideas": [ { "topic": "pertanyaan sehari-hari dengan subjek konkret", "category": "kategori", "angle": "sudut", "viralScore": 0, "why": "kenapa menarik & banyak dicari" } ] }'
  ].filter(Boolean).join("\n");
}

function trendIdeaPrompt(trend, history) {
  const previous = history
    .filter((item) => isDuplicate(trend.title, [item], 0.8))
    .slice(0, 12)
    .map((item) => `- ${item.topic}${item.title && item.title !== item.topic ? ` | judul: ${item.title}` : ""}`)
    .join("\n") || "- (belum pernah dibahas)";
  return [
    "Kamu produser video dokumenter edukasi YouTube Indonesia.",
    `Isu Indonesia yang bertahan ${trend.days} hari: "${trend.title}" (${trend.articles} artikel dari ${trend.sources} media).`,
    trend.newsTitle ? `Contoh berita terkait: "${trend.newsTitle}" — ${trend.newsSource || "Google News"}.` : "",
    "Buat 8 ide video edukasi evergreen yang benar-benar terkait isu tersebut, bukan sekadar menempelkan namanya.",
    "Cari mekanisme, sejarah, strategi, sains, psikologi, ekonomi, atau konteks mendalam di balik tren.",
    "Jangan membuat update berita, prediksi sesaat, jadwal, skor, atau judul 'sedang viral'. Video harus tetap berguna berbulan-bulan setelah beritanya reda.",
    "Jika subjek yang sama pernah dibahas, subjek boleh diulang tetapi pertanyaan, sudut cerita, dan judul WAJIB berbeda.",
    "Ide yang pernah dibuat dari tren ini:",
    previous,
    "Urutkan ide terbaik dahulu. Kembalikan JSON valid saja:",
    '{"ideas":[{"topic":"judul/pertanyaan video yang spesifik","category":"kategori","angle":"sudut baru","viralScore":0,"why":"hubungan faktual dengan tren"}]}'
  ].filter(Boolean).join("\n");
}

export function createTrendFallbackIdeas(trend) {
  const subject = cleanText(trend?.title || "tren hari ini", 100);
  const category = /fc|f\.c|liga|piala|open|timnas|sepak bola|tenis|olahraga/i.test(`${subject} ${trend?.newsTitle || ""}`)
    ? "olahraga"
    : /play store|aplikasi|ponsel|ai|teknologi/i.test(`${subject} ${trend?.newsTitle || ""}`)
      ? "teknologi"
      : "berita dan fenomena";
  return [
    { topic: `Sains di Balik ${subject} yang Jarang Dijelaskan`, angle: "mekanisme ilmiah yang tetap relevan setelah berita reda" },
    { topic: `Sejarah ${subject} dan Peristiwa yang Membentuknya`, angle: "asal-usul dan titik balik historis" },
    { topic: `Mengapa ${subject} Bisa Berdampak Begitu Besar`, angle: "rantai sebab-akibat dan skala dampaknya" },
    { topic: `Cara Para Ahli Membaca Tanda dari ${subject}`, angle: "metode observasi, bukti, dan batas prediksi" },
    { topic: `Mitos dan Fakta tentang ${subject}`, angle: "meluruskan kesalahpahaman dengan penjelasan faktual" },
    { topic: `Apa yang Bisa Dipelajari Manusia dari ${subject}`, angle: "pelajaran jangka panjang bagi ilmu dan masyarakat" },
    { topic: `Teknologi yang Digunakan untuk Memahami ${subject}`, angle: "alat, data, dan proses kerja para peneliti" },
    { topic: `Bagaimana ${subject} Mengubah Dunia di Sekitarnya`, angle: "dampak jangka panjang pada alam dan manusia" }
  ].map((idea, index) => ({ ...idea, category, viralScore: 90 - index }));
}

async function pickSustainedTrendIdea(history) {
  const trend = await fetchTopSustainedNewsTopic();
  if (!trend) return null;
  console.log(`[Tren Bertahan] "${trend.title}": ${trend.articles} artikel, ${trend.sources} media, ${trend.days} hari`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    let ideas;
    let provider;
    try {
      const aiResult = await requestIdeaJsonWithFallback(trendIdeaPrompt(trend, history));
      ideas = aiResult.data?.ideas || [];
      provider = aiResult.provider;
    } catch (error) {
      console.warn(`[Tren Bertahan] AI ide tidak tersedia, memakai ide lokal: ${error.message}`);
      ideas = createTrendFallbackIdeas(trend);
      provider = "rss-local";
    }
    const ranked = [...ideas]
      .filter((idea) => idea?.topic)
      .sort((a, b) => (Number(b.viralScore) || 0) - (Number(a.viralScore) || 0));
    for (const idea of ranked) {
      const candidate = {
        topic: cleanText(idea.topic, 160),
        title: cleanText(idea.topic, 160),
        category: cleanText(idea.category || "berita dan fenomena", 80),
        angle: simplifyForLayAudience(idea.angle || `konteks di balik ${trend.title}`, 140)
      };
      const check = checkFreshness(candidate, history, {
        allowRepeatedSubject: true,
        topicThreshold: 0.7,
        titleThreshold: 0.7
      });
      if (!check.isFresh) continue;
      const formatType = pickFormatType(history);
      const viralAngle = pickViralAngle(history);
      return {
        ...candidate,
        formatType,
        viralAngleId: viralAngle.id,
        viralAngleLabel: simplifyForLayAudience(viralAngle.label, 80),
        source: `${provider}+google-news-sustained`,
        trendingScore: trend.days * 100 + trend.sources * 10 + trend.articles,
        trendingKeywords: [trend.title],
        trend
      };
    }
    if (provider === "rss-local") break;
    console.log(`[Tren Bertahan] Percobaan ${attempt}: semua ide terlalu mirip riwayat, meminta sudut baru...`);
  }
  return null;
}

const OFFLINE_SEEDS = [
  "Kenapa madu tidak pernah basi meski disimpan ribuan tahun",
  "Bagaimana jam pasir kuno bisa mengukur waktu dengan akurat",
  "Mengapa langit malam gelap padahal ada miliaran bintang",
  "Rahasia di balik kenapa kunci pas punya banyak ukuran",
  "Bagaimana semut menemukan jalan pulang tanpa tersesat",
  "Kenapa kaca itu sebenarnya bukan benar-benar padat",
  "Asal-usul angka nol dan kenapa butuh ribuan tahun ditemukan",
  "Bagaimana terumbu karang membangun struktur sebesar kota",
  "Mengapa garam dulu lebih berharga daripada emas",
  "Kenapa warna biru paling langka di alam",
  "Bagaimana lampu lalu lintas pertama bekerja sebelum ada listrik",
  "Misteri kenapa kita lupa masa bayi kita sendiri",
  "Bagaimana kompas tahu arah utara di tengah lautan",
  "Kenapa roti bisa mengembang hanya dengan ragi mikroskopis",
  "Asal-usul kenapa keyboard tidak disusun urut abjad",
  "Mengapa kucing mendengkur dan apa manfaatnya",
  "Kenapa es mengambang padahal air padat biasanya lebih berat",
  "Bagaimana cermin dua arah bekerja di ruang interogasi",
  "Misteri tulisan yang belum terpecahkan selama berabad-abad",
  "Mengapa baterai ponsel tidak bisa 100% awet bertahun-tahun"
];

const VOLCANO_OFFLINE_SEEDS = [
  "Tambora 1815: Saat Gunung Indonesia Bekukan Dunia",
  "Jika Danau Toba Meletus Lagi: Skenario 30 Hari Pertama",
  "Kawah Ijen: Rahasia Danau Asam Paling Maut di Dunia",
  "Palung Jawa: Jurang 7.000 Meter Pengunci Gempa Bumi",
  "Misteri Lumpur Lapindo: Kenapa Tak Pernah Berhenti?",
  "Samalas 1257: Letusan Lombok yang Mengubah Dunia",
  "Gunung Bawah Laut Indonesia: Monster di Dasar Samudra",
  "Sesar Lembang Terkunci: Ancaman Senyap di Bawah Kota",
  "Danau Kelimutu: Misteri 3 Kawah dengan Warna yang Berubah",
  "Gunung Merapi: Mengapa Awan Panasnya Selalu Tepat Waktu?",
  "Sesar Palu-Koro: Fenomena Likuifaksi Tercepat di Dunia",
  "Danau Matano: Rahasia Danau Purba Terdalam Tanpa Oksigen",
  "Yellowstone vs Toba: Mana Supervolcano Paling Berbahaya?",
  "Banua Wuhu: Misteri Gunung Api yang Muncul di Tengah Laut",
  "Magma 1000 Derajat: Mengapa Tak Selalu Meledakkan Gunung?",
  "Hunga Tonga: Ledakan Bawah Laut yang Menembus Mesosfer",
  "Krakatau 1883: Gelombang Tsunami yang Mengelilingi Planet Bumi",
  "Zona Subduksi Mentawai: Mengapa Gempa Megathrust Terus Mengintai",
  "Geotermal Dieng: Misteri Kawah Gas Beracun Sinila yang Mematikan",
  "Sundaland: Ketika Kepulauan Indonesia Menjadi Satu Daratan Benua"
];

const SPACE_OFFLINE_SEEDS = [
  "Kenapa Lubang Hitam Tidak Menyedot Semua Benda di Sekitarnya",
  "Bagaimana Bintang Bisa Lahir dari Awan Gas yang Sangat Dingin",
  "Mengapa Venus Lebih Panas daripada Merkurius",
  "Apa yang Terjadi pada Tubuh Astronot Tanpa Gravitasi",
  "Bagaimana Teleskop Bisa Melihat Masa Lalu Alam Semesta",
  "Kenapa Bulan Selalu Menunjukkan Sisi yang Sama ke Bumi",
  "Bagaimana Satelit Tetap Mengorbit Bumi dan Tidak Jatuh",
  "Kenapa Mars Kehilangan Air dan Atmosfernya",
  "Bagaimana Jejak Kaki di Bulan Bisa Bertahan Sangat Lama",
  "Apa yang Dicari Ilmuwan di Lautan Bawah Es Europa",
  "Kenapa Bintang Neutron Bisa Lebih Padat daripada Bumi",
  "Bagaimana Pesawat Voyager Masih Bisa Mengirim Sinyal ke Bumi"
];

function offlinePick(history, category) {
  const seeds = category === VOLCANO_CATEGORY || category === "geologi"
    ? VOLCANO_OFFLINE_SEEDS
    : (category === SPACE_CATEGORY ? SPACE_OFFLINE_SEEDS : OFFLINE_SEEDS);
  const fresh = seeds.filter((seed) => !isDuplicate(seed, history, 0.6));
  return fresh.length ? pick(fresh) : "";
}

/**
 * Menentukan apakah video berikutnya perlu mengisi kuota luar angkasa.
 * Kuota dihitung dari riwayat rolling supaya rasio tidak bergantung pada
 * jumlah seluruh arsip dan tetap bisa mengejar target setelah periode lama.
 */
export function isSpaceQuotaDue(history = []) {
  const target = config.topic?.spaceTargetRatio ?? 0.7;
  if (target <= 0) return false;
  const windowSize = config.topic?.categoryHistoryWindow || 30;
  const recent = history.slice(0, windowSize);
  const spaceCount = recent.filter((item) => item.category === SPACE_CATEGORY).length;
  return spaceCount < Math.ceil((recent.length + 1) * target);
}

export function pickBalancedCategory(history = []) {
  const defaultCategory = config.topic?.defaultCategory || process.env.YT_DEFAULT_CATEGORY;
  if (defaultCategory && defaultCategory !== "random") {
    return defaultCategory;
  }
  if (isSpaceQuotaDue(history)) return SPACE_CATEGORY;

  const categoryWindow = config.topic?.categoryHistoryWindow || 30;
  const recent = new Set(history.slice(0, 3).map((item) => item.category).filter(Boolean));
  const counts = new Map(TOPIC_CATEGORIES.map((category) => [category, 0]));
  for (const item of history.slice(0, categoryWindow)) {
    if (counts.has(item.category)) counts.set(item.category, counts.get(item.category) + 1);
  }
  const candidates = TOPIC_CATEGORIES.filter((category) => !recent.has(category));
  const minimum = Math.min(...candidates.map((category) => counts.get(category) || 0));
  const balanced = candidates.filter((category) => (counts.get(category) || 0) <= minimum + 1);
  const pool = balanced.length ? balanced : candidates.length ? candidates : TOPIC_CATEGORIES;
  // Mode "Seimbang": condong (~60%) ke kategori everyday yang relatable, sisanya variasi penuh.
  const everyday = pool.filter((category) => EVERYDAY_CATEGORIES.has(category));
  return pick(everyday.length && Math.random() < 0.6 ? everyday : pool);
}

export function filterFreshTrendingContext(context, history = []) {
  if (!context?.themes?.length) return context;
  const themes = context.themes.filter((theme) => {
    const topic = [theme.theme, theme.angle].filter(Boolean).join(" ");
    const check = checkFreshness({
      topic,
      title: theme.theme || topic,
      category: theme.category || "",
      angle: theme.angle || "",
      formatType: ""
    }, history, { topicThreshold: 0.42, titleThreshold: 0.5 });
    if (!check.isFresh) console.log(`[Trends] Skip tema lama: ${check.reason}`);
    return check.isFresh;
  });
  const topKeywords = (context.topKeywords || []).filter((keyword) => !isDuplicate(keyword, history, 0.8));
  return { ...context, themes, topKeywords };
}

export async function loadCuratedVolcanoIdeas() {
  try {
    const file = path.join(paths.dataDir, "curated-volcano-ideas.json");
    const raw = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.priorityIdeas) ? parsed.priorityIdeas : [];
  } catch {
    return [];
  }
}

/**
 * Pilih satu topik baru yang unik.
 * @returns {Promise<{topic, category, angle, formatType, source}>}
 */
export async function pickFreshTopic(options = {}) {
  const history = await loadHistory(80);

  const category = cleanText(options.category && options.category !== "random"
    ? options.category : pickBalancedCategory(history), 80);

  const isVolcanoNiche = category === VOLCANO_CATEGORY || category === "geologi";
  const disableTrends = config.topic?.disableNewsTrends ?? true;

  // Lewati pencarian berita harian jika mode vulkanologi/geologi aktif atau tren berita dinonaktifkan
  if (!disableTrends && !isVolcanoNiche) {
    try {
      const trending = await pickSustainedTrendIdea(history);
      if (trending) return trending;
    } catch (error) {
      console.warn(`[Tren Bertahan] Gagal memilih topik, lanjut evergreen fallback: ${error.message}`);
    }
  }

  // Jika mode vulkanologi, dahulukan ide prioritas terkurasi yang belum pernah dibuat
  if (isVolcanoNiche) {
    const curatedList = await loadCuratedVolcanoIdeas();
    const freshCurated = curatedList.find((item) =>
      item?.topic && !isDuplicate(item.topic, history, 0.5) && !isDuplicate(item.title, history, 0.5)
    );
    if (freshCurated) {
      console.log(`[Topic Engine] Memilih ide prioritas terkurasi: "${freshCurated.title || freshCurated.topic}"`);
      const viralAngle = pickViralAngle(history);
      return {
        topic: freshCurated.topic,
        category: freshCurated.category || VOLCANO_CATEGORY,
        angle: freshCurated.why || "kenapa bisa terjadi",
        formatType: freshCurated.formatType || pickFormatType(history),
        viralAngleId: freshCurated.viralAngle || viralAngle.id,
        viralAngleLabel: simplifyForLayAudience(freshCurated.viralAngle || viralAngle.label, 80),
        source: "curated",
        trendingScore: 95,
        trendingKeywords: ["vulkanologi", "geologi", "bencana"]
      };
    }
  }

  // Ambil sinyal trending YouTube hanya jika bukan vulkanologi (agar prompt AI fokus murni ke sains bumi)
  let trendingContext = null;
  if (!isVolcanoNiche) {
    try {
      trendingContext = filterFreshTrendingContext(await buildTrendingContext(), history);
      if (trendingContext?.enabled && trendingContext.themes.length) {
        console.log(`[Topic Engine] Trending context: ${trendingContext.themes.length} tema, skor ${trendingContext.trendingScore}/100`);
      }
    } catch (error) {
      console.warn(`[Topic Engine] Trending context gagal: ${error.message}`);
    }
  }

  // Coba hingga 5 kali untuk menemukan kombinasi yang benar-benar segar
  for (let attempt = 1; attempt <= 5; attempt++) {
    const angle = simplifyForLayAudience(pick(categoryAngles(category)), 140);
    const formatType = pickFormatType(history);
    const viralAngle = pickViralAngle(history);

    try {
      const aiResult = await requestIdeaJsonWithFallback(
        buildIdeaPrompt(history, category, angle, formatType, viralAngle, trendingContext)
      );
      const data = aiResult.data;
      const ideas = Array.isArray(data?.ideas) ? data.ideas : [];
      // Pilih ide paling berpotensi viral lebih dulu (skor tinggi → urutan awal),
      // lalu pickFreshIdeaFromBatch menjamin tetap lolos anti-duplikat.
      const ranked = [...ideas].sort((a, b) => (Number(b?.viralScore) || 0) - (Number(a?.viralScore) || 0));
      const fresh = ranked.filter((idea) => idea?.topic && !isDuplicate(idea.topic, history));
      const chosen = pickFreshIdeaFromBatch(fresh, formatType, angle, category, history, viralAngle)
        || pickFreshIdeaFromBatch(ranked, formatType, angle, category, history, viralAngle);
      if (chosen && fresh[0]?.topic === chosen.topic) {
        console.log(`[Topic Engine] Ide terpilih (viralScore ${fresh[0]?.viralScore ?? "-"}): ${chosen.topic}`);
      }

      if (chosen) {
        return {
          topic: chosen.topic,
          // Saat kuota space aktif, label kategori harus tetap space agar
          // perhitungan berikutnya tidak menganggap topik ini kategori lain.
          category: category === SPACE_CATEGORY ? SPACE_CATEGORY : chosen.category,
          angle: simplifyForLayAudience(chosen.angle || angle, 140),
          formatType,
          viralAngleId: viralAngle.id,
          viralAngleLabel: simplifyForLayAudience(viralAngle.label, 80),
          source: aiResult.provider,
          trendingScore: trendingContext?.trendingScore || 0,
          trendingKeywords: trendingContext?.topKeywords || []
        };
      }

      console.log(`[Continuity] Attempt ${attempt}: tidak ada ide fresh dari batch, mencoba ulang...`);
    } catch (error) {
      console.warn(`[Topic Engine] Attempt ${attempt} gagal: ${error.message}`);
    }
  }

  // Fallback: offline seed dengan formatType baru
  const offlineTopic = offlinePick(history, category);
  if (!offlineTopic) {
    throw new Error("Tidak ada topik offline yang benar-benar baru. Hentikan run agar tidak mengulang topik lama.");
  }
  const formatType = pickFormatType(history);
  const viralAngle = pickViralAngle(history);
  // Koheren dgn seed: kategori ditebak dari topik & angle netral, BUKAN kategori acak —
  // mencegah cerita/judul melenceng dari topik aslinya (mis. topik kucing → judul transportasi).
  const offlineCategory = (category === SPACE_CATEGORY || category === VOLCANO_CATEGORY || category === "geologi")
    ? category
    : inferEverydayCategory(offlineTopic);
  return {
    topic: offlineTopic,
    category: offlineCategory,
    angle: "kenapa bisa terjadi",
    formatType,
    viralAngleId: viralAngle.id,
    viralAngleLabel: simplifyForLayAudience(viralAngle.label, 80),
    source: "offline",
    trendingScore: 0,
    trendingKeywords: []
  };
}
