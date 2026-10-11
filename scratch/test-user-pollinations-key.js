import fs from "node:fs/promises";

const key = "sk_c5FmOEilDH6okNl0TFXauBMN6FPqElyE";
const promptText = "hyper-detailed cinematic 16:9 aerial Lake Toba caldera volcano cross-section molten magma fissure dramatic sunset storm clouds 8k";
const prompt = encodeURIComponent(promptText);

async function testEndpoints() {
  const endpoints = [
    {
      name: "image.pollinations.ai with key param",
      url: `https://image.pollinations.ai/prompt/${prompt}?model=flux&width=1280&height=720&nologo=true&key=${key}`,
      headers: { "Authorization": `Bearer ${key}` }
    },
    {
      name: "gen.pollinations.ai with Bearer token",
      url: `https://gen.pollinations.ai/image/${prompt}?model=flux&width=1280&height=720&nologo=true`,
      headers: { "Authorization": `Bearer ${key}` }
    }
  ];

  for (const ep of endpoints) {
    console.log(`\nTesting ${ep.name}...`);
    try {
      const start = Date.now();
      const res = await fetch(ep.url, { headers: ep.headers });
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`Status: ${res.status}, Type: ${res.headers.get("content-type")}, Time: ${duration}s`);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile("scratch/test-user-key.jpg", buf);
        console.log(`[SUCCESS] Saved test-user-key.jpg (${buf.length} bytes)!`);
        return { success: true, endpoint: ep.name, url: ep.url };
      } else {
        console.log("Response text:", (await res.text()).slice(0, 300));
      }
    } catch (err) {
      console.error("Error:", err.message);
    }
  }
  return { success: false };
}

testEndpoints().catch(console.error);
