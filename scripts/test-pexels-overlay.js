import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { paths } from "../src/config.js";
import { makeVideoSegment } from "../src/longform-render.js";

const sourcePath = path.join(paths.rootDir, "tmp", "pexels-overlay-source.mp4");
const outputPath = path.join(paths.rootDir, "tmp", "pexels-overlay-output.mp4");
await fs.mkdir(path.dirname(sourcePath), { recursive: true });

try {
  const source = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc2=size=1280x720:rate=30",
    "-t", "2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    sourcePath
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(source.status, 0, source.stderr);

  await makeVideoSegment({
    videoPath: sourcePath,
    outputPath,
    duration: 2
  });

  const stat = await fs.stat(outputPath);
  assert.ok(stat.size > 10_000, "Output overlay terlalu kecil.");
  console.log(`Pexels overlay smoke test passed (${Math.round(stat.size / 1024)} KB).`);
} finally {
  await fs.rm(sourcePath, { force: true });
  await fs.rm(outputPath, { force: true });
}
