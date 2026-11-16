import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { webhookDeliverySigningBytes } from "@wavvon/sdk";
import { createApp } from "../src/app.js";
import features from "../src/features/index.js";
import { createRouter } from "../src/router.js";

const author = { pubkey: "ab".repeat(32), display_name: "Ada" };
const slash = (command, args_raw = "") => ({ type: "slash_command", command, args_raw, author, channel_id: "c1" });

test("every feature's commands are registered once", () => {
  const names = createRouter(features).commands.map((c) => c.name);
  assert.deepEqual(names.sort(), ["coin", "docs", "faq", "releases", "roll", "welcome"]);
});

test("a duplicate command is refused at startup", () => {
  const f = { commands: [{ name: "x", description: "" }], slash: { x: () => ({}) } };
  assert.throws(() => createRouter([f, f]), /registered twice/);
});

test("slash commands reach their feature", () => {
  const router = createRouter(features);
  assert.match(router.onSlashCommand(slash("coin")).reply.body, /\*\*(heads|tails)\*\*/);
  assert.match(router.onSlashCommand(slash("docs", "SDK")).reply.body, /docs\/sdk\.md$/);
  assert.equal(router.onSlashCommand(slash("docs", "constructor")).ephemeral, true);
  assert.equal(router.onSlashCommand(slash("nope")).ephemeral, true);
});

test("/faq buttons route back to their answers", () => {
  const router = createRouter(features);
  const buttons = router.onSlashCommand(slash("faq")).reply.components[0].components;
  assert.ok(buttons.length > 1);
  for (const b of buttons) {
    const answer = router.onComponent({ type: "component_interaction", custom_id: b.custom_id, user: author });
    assert.ok(answer.ephemeral_reply.body.includes(b.label), b.custom_id);
  }
  assert.match(router.onComponent({ custom_id: "gone:1" }).ephemeral_reply.body, /no longer/);
});

function fakeHub() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const hex = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("hex");
  return {
    publicKey: hex,
    request(body, key = hex) {
      const ts = Math.floor(Date.now() / 1000);
      const raw = Buffer.from(JSON.stringify(body));
      const sig = sign(null, webhookDeliverySigningBytes(ts, raw), privateKey).toString("hex");
      return new Request("http://bot/hook", {
        method: "POST",
        headers: { "X-Wavvon-Hub-Pubkey": key, "X-Wavvon-Timestamp": String(ts), "X-Wavvon-Signature-V1": sig },
        body: raw,
      });
    },
  };
}

test("/hook verifies against the hub the dispatch names", async () => {
  const a = fakeHub();
  const b = fakeHub();
  const seen = [];
  const router = createRouter([
    { commands: [{ name: "who", description: "" }], slash: { who: (_inv, ctx) => (seen.push(ctx.hubUrl), {}) } },
  ]);
  const app = createApp({
    router,
    hubs: [
      { hubPublicKey: a.publicKey, ctx: { hubUrl: "https://a" } },
      { hubPublicKey: b.publicKey, ctx: { hubUrl: "https://b" } },
    ],
  });
  assert.equal((await app(b.request(slash("who")))).status, 200);
  assert.equal((await app(a.request(slash("who")))).status, 200);
  assert.deepEqual(seen, ["https://b", "https://a"]);

  // Signed by b but claiming to be a: refused.
  assert.equal((await app(b.request(slash("who"), a.publicKey))).status, 401);
  // A hub the bot does not serve: refused.
  assert.equal((await app(fakeHub().request(slash("who")))).status, 401);
  assert.equal((await app(new Request("http://bot/elsewhere"))).status, 404);
});
