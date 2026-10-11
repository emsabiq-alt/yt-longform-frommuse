/**
 * Test script: cek YouTube trending + theme extraction.
 * Jalankan: node scratch/test-trending.js
 */
import dotenv from "dotenv";
dotenv.config();

import { fetchMultiCategoryTrending, extractTrendingThemes, buildTrendingContext, formatTrendingForPrompt } from "../src/youtube-trends.js";
import { config } from "../src/config.js";

async function main() {
  console.log("=== YouTube Trending Test ===\n");

  if (!config.youtube.dataApiKey) {
    console.log("❌ YOUTUBE_DATA_API_KEY belum di-set di .env");
    console.log("Trending akan di-skip secara graceful saat generate video.\n");

    // Test graceful degradation
    const context = await buildTrendingContext();
    console.log("buildTrendingContext() tanpa API key:", JSON.stringify(context, null, 2));
    console.log("\n✅ Graceful degradation bekerja.");
    return;
  }

  console.log("1. Fetching trending videos...");
  const videos = await fetchMultiCategoryTrending("ID");
  console.log(`   → ${videos.length} video ditemukan\n`);

  if (videos.length) {
    console.log("Top 10 trending:");
    for (const v of videos.slice(0, 10)) {
      const views = v.viewCount >= 1_000_000
        ? `${(v.viewCount / 1_000_000).toFixed(1)}M`
        : `${(v.viewCount / 1_000).toFixed(0)}K`;
      console.log(`  ${views} views | ${v.title.slice(0, 70)}`);
    }
  }

  console.log("\n2. Extracting themes via GPT...");
  const { themes, topKeywords, trendingScore } = await extractTrendingThemes(videos);
  console.log(`   → ${themes.length} tema, skor keseluruhan: ${trendingScore}/100\n`);

  if (themes.length) {
    console.log("Tema trending:");
    for (const t of themes) {
      console.log(`  [${t.relevance}/100] ${t.theme} — ${t.angle}`);
    }
  }

  if (topKeywords.length) {
    console.log(`\nKeywords: ${topKeywords.join(", ")}`);
  }

  console.log("\n3. Full context for topic-engine prompt:");
  const context = await buildTrendingContext();
  const promptBlock = formatTrendingForPrompt(context);
  console.log(promptBlock || "(kosong — tidak ada trending context)");
  console.log("\n✅ Test selesai.");
}

main().catch(console.error);
