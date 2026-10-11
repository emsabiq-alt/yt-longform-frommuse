import { config, ensureProjectDirs } from "./config.js";
import { buildTitle, buildDescription } from "./youtube-meta.js";
import { getItem, saveItem, mergeMemoryItems } from "./storage.js";
import { publishToYoutube, getYoutubeAccessToken } from "./youtube-publisher.js";
import { addToPlaylistByCategory } from "./youtube-playlist.js";
import { translateYoutubeMetadata } from "./youtube-localization.js";
import { remoteEnabled, uploadGeneratedStateAndAssets, absolutizeGeneratedUrls } from "./remote.js";
import { reportProgress } from "./progress.js";

function argValue(name, fallback = "") {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || fallback;
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

ensureProjectDirs();

const id = argValue("--id");
if (!id) {
  console.error("ERROR: Gunakan --id <item-id>.");
  process.exit(1);
}

const item = await getItem(id);
if (!item) {
  console.error(`ERROR: Item ${id} tidak ditemukan.`);
  process.exit(1);
}

console.log(`Memulai upload YouTube untuk video ID=${id}, judul="${item.title}"`);

if (!config.youtube.enabled) {
  console.error("ERROR: YOUTUBE_UPLOAD_ENABLED bernilai false di .env atau config.");
  process.exit(1);
}

try {
  reportProgress("publish", "Mengunggah video ke YouTube", 30, "mengirim berkas...");
  const title = buildTitle(item);
  const description = buildDescription(item);
  const localization = await translateYoutubeMetadata({ title, description });
  if (localization.skipped) {
    console.log(`[Localization] Dilewati: ${localization.reason}`);
  } else if (!localization.ok) {
    console.warn(`[Localization] ${localization.reason}`);
  } else {
    console.log(`[Localization] Siap: ${localization.languages.join(", ")}`);
  }
  const published = await publishToYoutube({
    videoPath: item.assets?.video?.path || "",
    title,
    description,
    tags: [item.input?.category, item.input?.topic].filter(Boolean),
    thumbnailPath: item.assets?.thumbnail?.path || "",
    srtPath: item.assets?.video?.srtPath || "",
    localizations: localization.localizations
  });
  if (published.thumbnailError) {
    console.warn(`[Thumbnail] ${published.thumbnailError}`);
  } else if (published.customThumbnail) {
    console.log("[Thumbnail] Custom thumbnail YouTube berhasil dipasang.");
  }
  if (published.localizationError) {
    console.warn(`[Localization] ${published.localizationError}`);
  }
  if (published.captionError) {
    console.warn(`[Caption] ${published.captionError}`);
  }

  reportProgress("publish", "Menambahkan ke playlist YouTube", 80, "playlist...");
  let playlistResult = { ok: false, skipped: true, error: "" };
  if (published.videoId) {
    try {
      const accessToken = await getYoutubeAccessToken();
      playlistResult = await addToPlaylistByCategory({
        videoId: published.videoId,
        category: item.input?.category || "",
        accessToken
      });
    } catch (error) {
      playlistResult = { ok: false, error: error.message };
      console.warn(`[Playlist] ${error.message}`);
    }
  }

  item.publish = {
    ...(item.publish || {}),
    youtube: {
      ...published,
      publishedAt: new Date().toISOString(),
      playlist: playlistResult.ok ? playlistResult.playlistId : null,
      playlistError: playlistResult.ok || playlistResult.skipped ? "" : playlistResult.error
    }
  };
  await saveItem(item);
  await mergeMemoryItems([item]);

  if (remoteEnabled()) {
    reportProgress("upload", "Sinkronisasi state ke SFTP", 90, "sftp...");
    try {
      const absItem = absolutizeGeneratedUrls(item);
      await uploadGeneratedStateAndAssets({ item: absItem });
    } catch (error) {
      console.warn(`Remote state setelah publish gagal: ${error.message}`);
    }
    reportProgress("upload", "Sinkronisasi state selesai", 100, "sukses");
  } else {
    reportProgress("upload", "Upload SFTP dilewati", 100, "dilewati");
  }

  console.log(`YouTube publish sukses: ${published.url}`);
  reportProgress("publish", "Publish YouTube selesai", 100, "sukses");
  console.log("@@UPLOAD_SUCCESS " + JSON.stringify({ url: published.url }) + "@@");
} catch (error) {
  reportProgress("publish", "Publish YouTube gagal", 100, "gagal");
  console.error(`YouTube publish gagal: ${error.message}`);
  item.publish = {
    ...(item.publish || {}),
    errors: {
      ...(item.publish?.errors || {}),
      youtube: error.message
    }
  };
  await saveItem(item);
  process.exit(1);
}
