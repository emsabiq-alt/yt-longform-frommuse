import dotenv from "dotenv";
dotenv.config();
import { addToPlaylistByCategory } from "../src/youtube-playlist.js";
import { getYoutubeAccessToken } from "../src/youtube-publisher.js";

async function test() {
  console.log("Mencoba menambahkan video ke playlist...");
  const token = await getYoutubeAccessToken();
  const res = await addToPlaylistByCategory({
    videoId: "MPKITE82-kI",
    category: "sains",
    accessToken: token
  });
  console.log("Hasil:", res);
}
test().catch(console.error);
