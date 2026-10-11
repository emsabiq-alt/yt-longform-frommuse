import test from "node:test";
import assert from "node:assert/strict";
import { generatePollinationsImage } from "../src/pollinations.js";
import { config } from "../src/config.js";

test("pollinations: config membaca API key dan model dengan benar", () => {
  assert.ok(config.pollinations);
  assert.equal(typeof config.pollinations.apiKey, "string");
  assert.equal(config.pollinations.model, "flux");
});

test("pollinations: melempar error jika prompt kosong", async () => {
  await assert.rejects(
    async () => {
      await generatePollinationsImage({ prompt: "" });
    },
    { message: /Prompt wajib diisi/ }
  );
});
