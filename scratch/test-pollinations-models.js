import fs from "node:fs/promises";

const key = "sk_c5FmOEilDH6okNl0TFXauBMN6FPqElyE";

const promptText = `A viral YouTube documentary investigation thumbnail in 16:9 widescreen format, high production quality.
COMPOSITE SCENE: Dramatic aerial perspective of Lake Toba caldera volcano with stormy sunset clouds and turquoise water. The bottom half cuts open into a photorealistic subterranean earth cross-section, revealing glowing molten magma fissures, boiling red-orange lava rivers beneath the cliff, with volcanic steam vents rising.
LEFT SIDE: Massive distressed bold blockbuster typography tilted -3 degrees: 'TOBA' in giant weathered white letters with a glowing red hazard warning triangle sign next to it; 'MASIH AKTIF?' in vibrant electric golden-yellow; an intense glowing red laser slash underline; followed by 'BUKTI INI' in bold white and 'LAMA DIABAIKAN' in bold yellow, with deep 3D black drop shadows. 'DANAU TOBA' in white script on the lake.
TOP RIGHT: Vintage aged parchment paper note pinned with a metallic paperclip, stamped with 'FAKTA YANG TERLUPAKAN SELAMA PULUHAN TAHUN!'.
CENTER-RIGHT CALLOUT: Glowing red neon target circle highlighting volcanic steam vents, with a curved red arrow pointing to a bold yellow-and-black hazard badge 'AKTIVITAS VULKANIK MASIH TERJADI!'.
BOTTOM RIGHT: Photorealistic forensic evidence desk with an aged sepia polaroid photo stamped with red rubber ink 'BUKTI LAMA', a vintage document marked 'CATATAN GEOLOGI 1920', and an authentic brass magnifying glass showing a red seismic tremor graph reading '74.000 TAHUN LALU'.
BOTTOM LEFT: Sleek dark translucent HUD bar with 4 glowing gold circular badges (Volcano, Gas Fumes, Seismic Pulse, Magnifying Glass) and crisp white/gold data labels.
Cinematic teal and orange color grade, volumetric lighting, incandescent magma glow, floating embers, 8k resolution.`;

async function testModel(modelName) {
  const prompt = encodeURIComponent(promptText);
  const url = `https://image.pollinations.ai/prompt/${prompt}?model=${modelName}&width=1280&height=720&nologo=true&key=${key}&seed=777`;
  console.log(`[Testing ${modelName}]...`);
  const start = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    console.log(`${modelName} status:`, res.status, `in ${((Date.now() - start)/1000).toFixed(1)}s`);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const outFile = `scratch/test-${modelName.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`;
      await fs.writeFile(outFile, buf);
      console.log(`Saved ${outFile}, size: ${buf.length}`);
      return outFile;
    } else {
      console.log("Error:", (await res.text()).slice(0, 200));
    }
  } catch (e) {
    console.error(e.message);
  }
}

async function run() {
  await testModel("gptimage-large");
}

run();
