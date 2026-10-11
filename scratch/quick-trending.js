import dotenv from "dotenv";
dotenv.config();

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token"
  })
});
const { access_token } = await tokenRes.json();

async function fetchTrending(categoryId, label) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=ID&videoCategoryId=${categoryId}&maxResults=10`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  const data = await res.json();
  console.log(`\n🔥 Trending ${label} (kategori ${categoryId}):\n`);
  if (!data.items?.length) { console.log("  (kosong)"); return; }
  for (const item of data.items) {
    const views = (Number(item.statistics.viewCount) / 1000).toFixed(0);
    console.log(`  ${views}K | ${item.snippet.title.slice(0, 80)}`);
  }
}

// Juga search video edukasi populer minggu ini
async function searchEducation() {
  const queries = ["fakta menarik", "pengetahuan", "sains terbaru", "sejarah"];
  console.log("\n🔍 Search video edukasi populer minggu ini:\n");
  for (const q of queries) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&regionCode=ID&order=viewCount&publishedAfter=${new Date(Date.now() - 7*24*60*60*1000).toISOString()}&maxResults=3`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
    const data = await res.json();
    for (const item of data.items || []) {
      console.log(`  [${q}] ${item.snippet.title.slice(0, 80)}`);
    }
  }
}

await fetchTrending(27, "Education");
await fetchTrending(28, "Science & Tech");
await searchEducation();
