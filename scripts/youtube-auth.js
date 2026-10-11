import dotenv from "dotenv";
import http from "node:http";

dotenv.config();

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const PORT = 5001;
const REDIRECT_URI = `http://localhost:${PORT}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Scope lengkap: upload + manage playlists + manage videos
const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ YOUTUBE_CLIENT_ID dan YOUTUBE_CLIENT_SECRET harus diisi di .env");
  process.exit(1);
}

// Step 1: Generate auth URL
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get("code");

  if (code) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Otorisasi Berhasil!</h1><p>Anda bisa menutup tab ini dan kembali melihat terminal Anda.</p>");

    try {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.refresh_token) {
        console.error("❌ Gagal mendapatkan token:", JSON.stringify(data, null, 2));
      } else {
        console.log("\n✅ BERHASIL! Salin refresh token baru ke .env:\n");
        console.log(`YOUTUBE_REFRESH_TOKEN=${data.refresh_token}`);
        console.log(`\nToken ini sudah mendukung: upload video, buat playlist, kelola playlist.`);
      }
    } catch (err) {
      console.error("❌ Error saat menukar token:", err.message);
    }

    server.close(() => {
      process.exit(0);
    });
  } else {
    res.writeHead(400);
    res.end("Kode otorisasi tidak ditemukan.");
  }
});

server.listen(PORT, () => {
  console.log("=== YouTube OAuth2 — Token Baru ===\n");
  console.log("👉 PENTING: Buka Google Cloud Console Anda di menu Credentials.");
  console.log("   Di bagian Client ID Anda, pastikan Anda telah menambahkan:");
  console.log(`   ${REDIRECT_URI}`);
  console.log("   ke daftar 'Authorized redirect URIs' (URI pengalihan sah) lalu simpan.\n");
  console.log("1. Buka URL ini di browser untuk otorisasi:\n");
  console.log(authUrl.toString());
  console.log("\nMenunggu otorisasi...");
});
