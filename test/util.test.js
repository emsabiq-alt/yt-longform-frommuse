// Unit test fungsi murni di src/util.js — pakai test runner bawaan Node (node:test).
// Jalankan: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createId,
  clamp,
  cleanText,
  slugify,
  safeFilename,
  splitLines,
  alignCaptionsToSource,
  normalizeTtsText
} from "../src/util.js";

test("clamp membatasi nilai ke rentang [min, max]", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);   // di bawah min → min
  assert.equal(clamp(50, 0, 10), 10);  // di atas max → max
});

test("createId menghasilkan id dengan prefix + 12 hex", () => {
  assert.match(createId("tau"), /^tau_[0-9a-f]{12}$/);
  assert.match(createId("q"), /^q_[0-9a-f]{12}$/);
  assert.match(createId(), /^tau_[0-9a-f]{12}$/); // prefix default
});

test("cleanText merapatkan spasi dan menangani input kosong", () => {
  assert.equal(cleanText("  a   b  "), "a b");
  assert.equal(cleanText(""), "");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
});

test("cleanText memotong di batas kata (tidak memotong tengah kata)", () => {
  // panjang > max → potong, lalu buang kata terakhir yang kepotong
  assert.equal(cleanText("satu dua tiga", 7), "satu");
  assert.equal(cleanText("halo", 100), "halo"); // di bawah max → utuh
});

test("slugify membuat slug aman, fallback ke 'banyaktau'", () => {
  assert.equal(slugify("Hello World!"), "hello-world");
  assert.equal(slugify("  Judul   Keren  "), "judul-keren");
  assert.equal(slugify(""), "banyaktau");      // kosong → fallback
  assert.equal(slugify("!!!"), "banyaktau");   // tanpa alnum → fallback
});

test("safeFilename = slug dipotong maksimum 70 karakter", () => {
  assert.equal(safeFilename("Hello World"), "hello-world");
  const long = safeFilename("a".repeat(200));
  assert.ok(long.length <= 70);
});

test("splitLines membungkus baris sesuai maxChars", () => {
  assert.deepEqual(splitLines("satu dua tiga empat", 9), ["satu dua", "tiga", "empat"]);
});

test("splitLines membatasi jumlah baris ke maxLines", () => {
  assert.deepEqual(splitLines("a b c d e f g h", 1, 2), ["a", "b"]);
});

test("alignCaptionsToSource: input kosong/segmen invalid → []", () => {
  assert.deepEqual(alignCaptionsToSource("", [{ start: 0, end: 1 }]), []);
  assert.deepEqual(alignCaptionsToSource("a b", []), []);
  assert.deepEqual(alignCaptionsToSource("a b", [{ start: 2, end: 1 }]), []); // end <= start
});

test("alignCaptionsToSource: satu segmen menampung seluruh teks sumber", () => {
  const out = alignCaptionsToSource("satu dua tiga empat", [{ start: 0, end: 4 }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "satu dua tiga empat");
  assert.equal(out[0].start, 0);
  assert.equal(out[0].end, 4);
});

test("alignCaptionsToSource: tidak ada kata yang hilang/terduplikasi, segmen terakhir ambil sisa", () => {
  const out = alignCaptionsToSource("a b c d e", [
    { start: 0, end: 1 },
    { start: 1, end: 2 }
  ]);
  assert.equal(out.length, 2);
  // gabungan semua teks segmen harus sama persis dengan sumber
  assert.equal(out.map((s) => s.text).join(" "), "a b c d e");
  assert.equal(out[0].start, 0);
  assert.equal(out[out.length - 1].end, 2);
});

test("normalizeTtsText mengubah angka jadi kata Bahasa Indonesia", () => {
  assert.equal(normalizeTtsText("5"), "lima");
  assert.equal(normalizeTtsText("10"), "sepuluh");
  assert.equal(normalizeTtsText("ada 3 kucing"), "ada tiga kucing");
});

test("normalizeTtsText mengembangkan simbol & singkatan", () => {
  assert.equal(normalizeTtsText("100%"), "seratus persen");
  assert.equal(normalizeTtsText("AI"), "kecerdasan buatan");
  assert.equal(normalizeTtsText("vs"), "versus");
  assert.equal(normalizeTtsText("5 km/jam"), "lima kilometer per jam");
  assert.equal(normalizeTtsText("gempa 9.0 SR"), "gempa sembilan koma nol skala richter");
  assert.equal(normalizeTtsText("gempa M7.8"), "gempa magnitudo tujuh koma delapan");
});

test("normalizeTtsText merapatkan spasi & menangani input kosong", () => {
  assert.equal(normalizeTtsText(""), "");
  assert.equal(normalizeTtsText("  halo    dunia  "), "halo dunia");
});

test("runCommand executes command and captures output within rolling buffer", async () => {
  const { runCommand } = await import("../src/longform-render.js");
  const out = await runCommand("node", ["-e", "console.log('antigravity_test_ok')"]);
  assert.ok(out.includes("antigravity_test_ok"));
});

test("runCommand rolling buffer caps stderr and never throws RangeError on high volume", async () => {
  const { runCommand } = await import("../src/longform-render.js");
  // Emit ~10 MB of stderr in chunks to simulate verbose ffmpeg
  const script = "for(let i=0;i<100;i++) process.stderr.write('x'.repeat(10000) + '\\n'); process.exit(1);";
  await assert.rejects(
    async () => {
      await runCommand("node", ["-e", script]);
    },
    (err) => {
      // Must not be RangeError: Invalid string length
      assert.notEqual(err.name, "RangeError");
      assert.ok(err.message.length <= 64 * 1024 + 100);
      return true;
    }
  );
});

test("runCommand times out and terminates child process when timeoutMs exceeded", async () => {
  const { runCommand } = await import("../src/longform-render.js");
  await assert.rejects(
    async () => {
      await runCommand("node", ["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 150 });
    },
    (err) => {
      assert.match(err.message, /timed out/i);
      return true;
    }
  );
});

test("isImageMagicHeader & isValidImageBuffer mengenali JPEG, PNG, WebP dan menolak HTML/data acak", async () => {
  const { isImageMagicHeader, isValidImageBuffer } = await import("../src/util.js");
  const validJpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1000)]);
  const validPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(1000)]);
  const validWebp = Buffer.concat([Buffer.from("RIFF1234WEBP"), Buffer.alloc(1000)]);
  const htmlDoc = Buffer.from("<!DOCTYPE html><html><body>Error 404</body></html>");

  assert.equal(isImageMagicHeader(validJpeg), true);
  assert.equal(isImageMagicHeader(validPng), true);
  assert.equal(isImageMagicHeader(validWebp), true);
  assert.equal(isImageMagicHeader(htmlDoc), false);

  assert.equal(isValidImageBuffer(validJpeg), true);
  assert.equal(isValidImageBuffer(validPng), true);
  assert.equal(isValidImageBuffer(validWebp), true);
  assert.equal(isValidImageBuffer(htmlDoc), false);
  assert.equal(isValidImageBuffer(Buffer.from([0xFF, 0xD8, 0xFF])), false); // terlalu kecil (< 1000 bytes)
});

test("isValidImageFileSync memverifikasi integritas file gambar di filesystem", async () => {
  const { isValidImageFileSync } = await import("../src/util.js");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "img-val-test-"));
  const validFile = path.join(tmpDir, "valid.jpg");
  const invalidFile = path.join(tmpDir, "invalid.jpg");
  const emptyFile = path.join(tmpDir, "empty.jpg");

  await fs.writeFile(validFile, Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1200)]));
  await fs.writeFile(invalidFile, Buffer.from("<html>Not An Image</html>"));
  await fs.writeFile(emptyFile, Buffer.alloc(0));

  assert.equal(isValidImageFileSync(validFile), true);
  assert.equal(isValidImageFileSync(invalidFile), false);
  assert.equal(isValidImageFileSync(emptyFile), false);
  assert.equal(isValidImageFileSync(path.join(tmpDir, "non-existent.jpg")), false);

  await fs.rm(tmpDir, { recursive: true, force: true });
});


