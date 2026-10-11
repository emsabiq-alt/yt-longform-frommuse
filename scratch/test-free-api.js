import fs from "node:fs/promises";

async function testPollinations() {
  const prompt = encodeURIComponent("hyper-detailed cinematic aerial landscape ancient pyramid jungle cross-section subterranean glowing magma chamber 16:9 8k");
  const url = `https://image.pollinations.ai/prompt/${prompt}?width=1280&height=720&model=flux&nologo=true&seed=100`;
  console.log("Fetching from Pollinations.ai (FLUX):", url);

  const start = Date.now();
  const res = await fetch(url);
  console.log("Status:", res.status, "Time:", ((Date.now() - start) / 1000).toFixed(1) + "s");

  if (res.ok) {
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile("scratch/test-pollinations.jpg", buf);
    console.log("SUCCESS! Saved scratch/test-pollinations.jpg, size:", buf.length);
  } else {
    console.error("Failed:", res.status, await res.text());
  }
}

testPollinations().catch(console.error);
