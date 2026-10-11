import { config } from "../src/config.js";
import {
  getYoutubeAccessToken,
  getYoutubeVideo,
  updateYoutubeLocalizations
} from "../src/youtube-publisher.js";
import { translateYoutubeMetadata } from "../src/youtube-localization.js";

function argValue(name, fallback = "") {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || fallback;
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const videoId = argValue("--video-id");
const languages = argValue("--languages", "");
if (!videoId) {
  console.error("Gunakan: npm run localize:youtube -- --video-id <VIDEO_ID>");
  process.exit(1);
}

const accessToken = await getYoutubeAccessToken();
const video = await getYoutubeVideo({ videoId, accessToken });
const snippet = video.snippet || {};
const requestedLanguages = languages
  ? languages.split(",").map((language) => language.trim()).filter(Boolean)
  : config.youtube.localizationLanguages;

console.log(`Video: ${videoId}`);
console.log(`Judul utama (${snippet.defaultLanguage || config.youtube.defaultLanguage}): ${snippet.title}`);
console.log(`Bahasa target: ${requestedLanguages.join(", ")}`);

const translated = await translateYoutubeMetadata({
  title: snippet.title,
  description: snippet.description,
  languages: requestedLanguages
});
if (translated.skipped) throw new Error(translated.reason);
if (!translated.ok) throw new Error(translated.reason);

const updated = await updateYoutubeLocalizations({
  videoId,
  accessToken,
  localizations: translated.localizations,
  snippet
});
console.log(JSON.stringify({
  ok: updated.ok,
  videoId,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  defaultLanguage: snippet.defaultLanguage || config.youtube.defaultLanguage,
  languages: updated.languages
}, null, 2));

