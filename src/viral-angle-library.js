/**
 * Viral Angle Library - kemasan sudut pandang lintas kategori.
 * Dipakai untuk membuat ide, judul, dan hook terasa lebih klik-able
 * tanpa mengorbankan fakta longform edukasi.
 */

import { simplifyForLayAudience } from "./story-language.js";

export const VIRAL_ANGLES = [
  {
    id: "hidden-cause",
    label: "penyebab tersembunyi",
    premise: "Bingkai topik sebagai akibat besar yang ternyata digerakkan oleh penyebab kecil atau jarang dibahas.",
    titlePatterns: [
      "Kenapa Penyebab Asli {topic} Tersembunyi Begitu Lama",
      "Satu Detail Kecil yang Mengubah Seluruh {topic}",
      "Mengapa yang Diam-diam Membentuk {topic} Jarang Diketahui"
    ],
    hookMoves: [
      "Buka dengan akibat besar yang sudah dikenal, lalu ungkap bahwa pemicunya bukan hal yang biasanya disebut.",
      "Mulai dari detail kecil yang terlihat sepele, lalu hubungkan ke dampak besar."
    ]
  },
  {
    id: "costly-mistake",
    label: "kesalahan mahal",
    premise: "Bingkai topik sebagai keputusan, asumsi, atau kelalaian yang memicu kerugian besar.",
    titlePatterns: [
      "Kenapa Kesalahan Kecil Ini Menghancurkan {topic}",
      "Bagaimana Satu Keputusan Mengubah {topic} Selamanya",
      "Mengapa Satu Pilihan Salah Bisa Semahal Ini"
    ],
    hookMoves: [
      "Buka dengan momen keputusan, lalu tunjukkan akibatnya lebih besar dari yang terlihat.",
      "Kontraskan pilihan yang tampak masuk akal saat itu dengan dampak buruk yang muncul kemudian."
    ]
  },
  {
    id: "domino-effect",
    label: "efek domino",
    premise: "Bingkai topik sebagai rangkaian sebab-akibat: satu peristiwa kecil menyalakan perubahan panjang.",
    titlePatterns: [
      "Bagaimana Satu Peristiwa Kecil Mengubah Dunia",
      "Kenapa Efek Domino dari {topic} Begitu Dahsyat",
      "Bagaimana {topic} Memicu Perubahan Besar"
    ],
    hookMoves: [
      "Buka dari kejadian kecil yang tampak lokal, lalu tarik ke dampak global atau jangka panjang.",
      "Tampilkan rantai tiga akibat cepat agar penonton merasa harus mengikuti alurnya."
    ]
  },
  {
    id: "misunderstood-truth",
    label: "miskonsepsi besar",
    premise: "Bingkai topik sebagai sesuatu yang sering dipahami keliru, tetapi hindari template berulang.",
    titlePatterns: [
      "Kenapa Banyak Orang Keliru Memahami {topic}",
      "Bagaimana Fakta Ini Membalik Cara Kita Melihat {topic}",
      "Mengapa {topic} Tidak Sesederhana yang Kita Kira"
    ],
    hookMoves: [
      "Buka dengan keyakinan umum yang familiar, lalu patahkan dengan bukti spesifik.",
      "Sebutkan miskonsepsi secara konkret, bukan memakai frasa generik seperti 'semua orang salah'."
    ]
  },
  {
    id: "forbidden-record",
    label: "catatan yang hilang",
    premise: "Bingkai topik sebagai kisah dokumen, bukti, atau detail penting yang lama hilang/diabaikan.",
    titlePatterns: [
      "Kenapa Catatan Penting Ini Hilang Begitu Lama",
      "Bagaimana Petunjuk Ini Diabaikan Sejarah Selama Bertahun-tahun",
      "Mengapa Bukti Kecil Ini Bisa Membuka Misteri Lama"
    ],
    hookMoves: [
      "Buka dengan pertanyaan: kenapa bukti penting ini lama tidak dibahas?",
      "Mulai dari dokumen, artefak, rekaman, atau saksi kecil yang mengubah tafsir besar."
    ]
  },
  {
    id: "industry-secret",
    label: "rahasia industri",
    premise: "Bingkai topik sebagai mekanisme tersembunyi di balik produk, pasar, teknologi, atau kebiasaan massal.",
    titlePatterns: [
      "Kenapa Industri Menyembunyikan Bagian Ini dari Pembeli",
      "Bagaimana {topic} Diam-diam Mengubah Kebiasaan Kita",
      "Mengapa Mekanisme di Balik {topic} Jarang Diungkap"
    ],
    hookMoves: [
      "Buka dari kebiasaan sehari-hari penonton, lalu tarik ke sistem besar di baliknya.",
      "Tunjukkan bahwa yang terlihat sederhana sebenarnya diatur oleh desain, pasar, atau insentif."
    ]
  },
  {
    id: "underdog-force",
    label: "yang diremehkan",
    premise: "Bingkai topik sebagai tokoh, benda, tempat, atau ide kecil yang punya pengaruh jauh lebih besar dari reputasinya.",
    titlePatterns: [
      "Kenapa Benda Kecil Ini Bisa Mengubah Sejarah",
      "Bagaimana Tokoh yang Diremehkan Mengubah Arah {topic}",
      "Mengapa Kekuatan Terbesar {topic} Justru Tidak Terlihat"
    ],
    hookMoves: [
      "Buka dengan sesuatu yang tampak tidak penting, lalu ungkap kontribusinya yang menentukan.",
      "Bandingkan reputasi kecilnya dengan dampak besar yang ditinggalkan."
    ]
  },
  {
    id: "before-after",
    label: "sebelum dan sesudah",
    premise: "Bingkai topik sebagai batas waktu: sebelum kejadian ini dunia berjalan berbeda, setelahnya aturan berubah.",
    titlePatterns: [
      "Bagaimana Dunia Berbeda Sebelum {topic} Muncul",
      "Kenapa Momen Ini Membelah Sejarah {topic}",
      "Mengapa Setelah Peristiwa Ini Tidak Ada yang Sama Lagi"
    ],
    hookMoves: [
      "Buka dengan perbandingan tajam antara keadaan sebelum dan sesudah.",
      "Tunjukkan satu kebiasaan lama yang mendadak tidak relevan setelah peristiwa utama."
    ]
  },
  {
    id: "unexplained-gap",
    label: "celah yang sulit dijelaskan",
    premise: "Bingkai topik sebagai pertanyaan faktual yang belum punya jawaban sederhana atau masih diperdebatkan.",
    titlePatterns: [
      "Kenapa Celah Aneh Ini Sulit Dijelaskan Sampai Sekarang",
      "Bagaimana Pertanyaan Ini Masih Mengganggu Ilmuwan",
      "Mengapa Bagian dari {topic} Masih Membingungkan"
    ],
    hookMoves: [
      "Buka dengan fakta yang seharusnya mudah dijelaskan, tetapi ternyata tidak.",
      "Tampilkan dua penjelasan yang saling bersaing sebelum masuk ke bukti."
    ]
  },
  {
    id: "dangerous-incentive",
    label: "aturan yang salah arah",
    premise: "Bingkai topik sebagai sistem yang mendorong orang/perusahaan/negara membuat pilihan berisiko.",
    titlePatterns: [
      "Kenapa Sistem Ini Mendorong Keputusan yang Salah",
      "Bagaimana Aturan Ini Justru Membuat Masalah Makin Besar",
      "Mengapa Orang Terus Membuat Pilihan Buruk di {topic}"
    ],
    hookMoves: [
      "Buka dengan aktor yang tampak salah, lalu jelaskan aturan sistem yang mendorongnya.",
      "Tunjukkan bahwa masalahnya bukan sekadar orang jahat, tapi aturan main yang keliru."
    ]
  }
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function getViralAngleById(id) {
  return VIRAL_ANGLES.find((angle) => angle.id === id) || null;
}

export function pickViralAngle(history = []) {
  const recentIds = new Set(
    history
      .slice(0, 5)
      .map((item) => item.viralAngleId || item.input?.viralAngleId || "")
      .filter(Boolean)
  );
  const candidates = VIRAL_ANGLES.filter((angle) => !recentIds.has(angle.id));
  return pick(candidates.length ? candidates : VIRAL_ANGLES);
}

export function viralAngleSummary(angle) {
  if (!angle) return "";
  return [
    `${simplifyForLayAudience(angle.label, 80)}: ${simplifyForLayAudience(angle.premise, 300)}`,
    `Contoh judul: ${angle.titlePatterns.map((pattern) => simplifyForLayAudience(pattern, 120)).join(" | ")}`,
    `Gerak hook: ${angle.hookMoves.map((move) => simplifyForLayAudience(move, 220)).join(" ")}`
  ].join("\n");
}

export function viralAnglePromptList(angles = VIRAL_ANGLES) {
  return angles
    .map((angle) => `- ${simplifyForLayAudience(angle.label, 80)}: ${simplifyForLayAudience(angle.premise, 260)}`)
    .join("\n");
}
