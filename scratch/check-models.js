const key = "sk_c5FmOEilDH6okNl0TFXauBMN6FPqElyE";

async function checkModels() {
  for (const host of ["https://image.pollinations.ai/models", "https://gen.pollinations.ai/models"]) {
    try {
      console.log(`Checking ${host}...`);
      const res = await fetch(host, { headers: { Authorization: `Bearer ${key}` } });
      console.log(`Status: ${res.status}`);
      if (res.ok) {
        console.log("Models:", await res.json());
      } else {
        console.log("Text:", (await res.text()).slice(0, 300));
      }
    } catch (e) {
      console.error(e.message);
    }
  }
}

checkModels();
