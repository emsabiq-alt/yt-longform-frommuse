import crypto from "node:crypto";
import fs from "node:fs";

export function createId(prefix = "tau") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export function cleanText(value, max = 2000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sliced = text.slice(0, max).trim();
  const wordSafe = sliced.replace(/\s+\S*$/, "").trim();
  return wordSafe || sliced;
}

export function slugify(value) {
  return cleanText(value, 90)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "banyaktau";
}

export function safeFilename(value) {
  return slugify(value).slice(0, 70);
}

export function splitLines(value, maxChars = 34, maxLines = 4) {
  const words = cleanText(value, 500).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/**
 * Ganti teks hasil transkripsi Whisper dengan teks naskah sumber,
 * sambil mempertahankan timing dari audio. Ini membuat subtitle selalu
 * cocok dengan naskah asli dan tetap sinkron dengan suara.
 */
export function alignCaptionsToSource(sourceText, segments) {
  const words = cleanText(sourceText, 5000).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const valid = (segments || []).filter((s) => s && Number(s.end) > Number(s.start));
  if (!valid.length) return [];

  const totalDuration = valid.reduce((sum, s) => sum + (Number(s.end) - Number(s.start)), 0);
  if (totalDuration <= 0) return [];

  let wordIndex = 0;
  const aligned = [];
  for (let i = 0; i < valid.length; i++) {
    const seg = valid[i];
    const isLast = i === valid.length - 1;
    const weight = (Number(seg.end) - Number(seg.start)) / totalDuration;
    const count = isLast
      ? words.length - wordIndex
      : Math.max(1, Math.floor(words.length * weight));

    if (wordIndex >= words.length) break;
    const slice = words.slice(wordIndex, wordIndex + count);
    if (!slice.length) continue;

    wordIndex += slice.length;
    aligned.push({
      start: Number(seg.start),
      end: Number(seg.end),
      text: slice.join(" "),
      avgLogprob: Number(seg.avgLogprob ?? 0),
      noSpeechProb: Number(seg.noSpeechProb ?? 0),
      // Timestamp kata asli dari Whisper diteruskan apa adanya: teksnya boleh
      // diganti naskah sumber, tapi waktunya tidak boleh ikut ditebak ulang.
      words: Array.isArray(seg.words) ? seg.words : []
    });
  }
  return aligned;
}

const digitWords = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

function numberToIndonesianWords(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return "minus " + numberToIndonesianWords(-n);
  if (n < 12) return digitWords[n] || String(n);
  if (n < 20) return digitWords[n % 10] + " belas";
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rem = n % 10;
    const head = tens === 1 ? "sepuluh" : digitWords[tens] + " puluh";
    return head + (rem ? " " + numberToIndonesianWords(rem) : "");
  }
  if (n < 200) {
    const rem = n % 100;
    return "seratus" + (rem ? " " + numberToIndonesianWords(rem) : "");
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rem = n % 100;
    return digitWords[hundreds] + " ratus" + (rem ? " " + numberToIndonesianWords(rem) : "");
  }
  if (n < 2000) {
    const rem = n % 1000;
    return "seribu" + (rem ? " " + numberToIndonesianWords(rem) : "");
  }
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rem = n % 1000;
    return numberToIndonesianWords(thousands) + " ribu" + (rem ? " " + numberToIndonesianWords(rem) : "");
  }
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rem = n % 1_000_000;
    return numberToIndonesianWords(millions) + " juta" + (rem ? " " + numberToIndonesianWords(rem) : "");
  }
  return String(n);
}

/**
 * Normalisasi teks untuk TTS:
 * - Hapus tanda baca yang memicu jeda berlebihan.
 * - Ubah angka, simbol, dan singkatan jadi kata-kata.
 * - Hasil tetap mempertahankan koma dan titik supaya intonasi natural.
 */
export function normalizeTtsText(value) {
  let text = String(value || "")
    // Dash → sambung natural tanpa jeda (spasi biasa).
    .replace(/[—–]/g, " ")
    // Hapus tanda kurung/kutip tanpa menambah spasi berlebih.
    .replace(/[()\[\]"\"\"']/g, "")
    // Titik koma, ellipsis → koma (jeda pendek), bukan titik (jeda panjang).
    .replace(/;/g, ",")
    .replace(/…/g, ",")
    .replace(/\.\.\./g, ",")
    // Titik dua → koma agar TTS tidak full-stop.
    .replace(/:\s*/g, ", ")
    // Bersihkan koma/titik berlebihan agar tidak menumpuk jeda.
    .replace(/,\s*,+/g, ",")
    .replace(/\.\s*\.+/g, ".")
    .replace(/\.\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s+,/g, ",")
    .trim();

  const replacements = [
    [/km\/jam/gi, "kilometer per jam"],
    [/km\/h/gi, "kilometer per jam"],
    [/\bkm\b/gi, "kilometer"],
    [/\bkg\b/gi, "kilogram"],
    [/m\/s/gi, "meter per detik"],
    [/°C/g, " derajat Celcius"],
    [/%/g, " persen"],
    [/Rp\.?\s*/g, "rupiah "],
    [/vs\.?\b/gi, "versus"],
    [/\bAI\b/g, "kecerdasan buatan"],
    [/\b3D\b/g, "tiga dimensi"],
    [/\b2D\b/g, "dua dimensi"],
    [/\bSR\b/g, "skala richter"],
    [/\bMw\b/g, "magnitudo"],
    [/\bM(?=\d)/gi, "magnitudo "],
    [/&/g, " dan "],
    [/\//g, " per "]
  ];
  for (const [re, repl] of replacements) text = text.replace(re, repl);

  // Desimal titik non-ribuan (1-2 digit, misal 9.0, 7.8, 10.5) diubah jadi koma agar dibaca sebagai desimal "koma"
  text = text.replace(/\b(\d+)\.(\d{1,2})\b/g, "$1,$2");

  // Angka dengan pemisah ribuan (titik) dan desimal (koma) dalam format Indonesia.
  text = text.replace(/\b(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?\b/g, (_, intPart, decPart) => {
    const n = parseInt(intPart.replace(/\./g, ""), 10);
    return numberToIndonesianWords(n) +
      (decPart ? " koma " + decPart.split("").map((d) => digitWords[Number(d)]).join(" ") : "");
  });
  text = text.replace(/\b(\d+),(\d+)\b/g, (_, intPart, decPart) => {
    return numberToIndonesianWords(Number(intPart)) +
      " koma " + decPart.split("").map((d) => digitWords[Number(d)]).join(" ");
  });
  text = text.replace(/\d+/g, (m) => numberToIndonesianWords(Number(m)));

  // Final cleanup: collapse residual multiple spaces.
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Validasi header magic bytes gambar (JPEG, PNG, WebP).
 */
export function isImageMagicHeader(buf) {
  if (!buf || buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WebP: RIFF ... WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}

/**
 * Validasi buffer gambar asli: ukuran memadai (>= 1000 byte) dan memiliki magic bytes valid.
 */
export function isValidImageBuffer(buf) {
  if (!buf || buf.length < 1000) return false;
  return isImageMagicHeader(buf);
}

/**
 * Validasi file gambar di disk secara sinkron untuk filtering cepat sebelum rendering FFmpeg.
 */
export function isValidImageFileSync(filePath, { allowMissing = false } = {}) {
  try {
    if (!filePath || typeof filePath !== "string") return false;
    if (!fs.existsSync(filePath)) return Boolean(allowMissing);
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 1000) return false;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return isImageMagicHeader(buf);
  } catch {
    return false;
  }
}

