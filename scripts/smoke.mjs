// Drives a running bot through a real hub as a second member.
//
//   WAVVON_HUB_URL=http://localhost:3000  WAVVON_SEED=<the bot's seed>  node scripts/smoke.mjs
//
// The bot's identity must own the hub (or hold invites.create and apps.register),
// the bot must be running against it, and the hub must allow plain-http
// webhooks (WAVVON_ALLOW_PRIVATE_WEBHOOKS=true) to reach a bot on localhost.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { WavvonClient, ok } from "@wavvon/sdk";

const hubUrl = process.env.WAVVON_HUB_URL;
const bot = new WavvonClient({ hubUrl, seed: process.env.WAVVON_SEED });
const botKey = (await bot.login()).canonicalPubkey;

const { code } = ok(await bot.rest.POST("/invites", { body: { max_uses: 1 } }));
const tester = new WavvonClient({ hubUrl, seed: randomBytes(32).toString("hex"), inviteCode: code });
const me = (await tester.login()).canonicalPubkey;

const channel = ok(await bot.rest.POST("/channels", { body: { name: `smoke-${Date.now()}`, channel_type: "text" } }));

const events = tester.connect();
const frames = [];
let wake = () => {};
events.on("message", (e) => {
  frames.push(e);
  wake();
});
await new Promise((resolve) => events.onStateChange((s) => s === "open" && resolve()));

/** Waits for the next message from the bot that matches. */
async function fromBot(match, what) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const hit = frames.find((f) => f.message.sender === botKey && match(f.message));
    if (hit) {
      frames.splice(frames.indexOf(hit), 1);
      return hit.message;
    }
    if (Date.now() > deadline) throw new Error(`no reply: ${what}`);
    await new Promise((r) => {
      wake = r;
      setTimeout(r, 500);
    });
  }
}

const say = async (content) => {
  ok(await tester.rest.POST("/channels/{channel_id}/messages", { params: { path: { channel_id: channel.id } }, body: { content } }));
};

await say("/roll 3d6");
const roll = await fromBot((m) => /rolled 3d6/.test(m.content), "/roll 3d6");
console.log(`/roll 3d6 -> ${roll.content}`);

// The hub's default per-user cooldown on a command is 3 s.
await new Promise((r) => setTimeout(r, 3500));
await say("/roll 500d6");
const refused = await fromBot((m) => /Try \/roll/.test(m.content), "/roll 500d6");
assert.equal(refused.visible_to_pubkey, me, "a bad roll is shown to the invoker only");
console.log(`/roll 500d6 -> ephemeral: ${refused.content}`);

await say("/coin");
console.log(`/coin -> ${(await fromBot((m) => /flipped a coin/.test(m.content), "/coin")).content}`);

await say("/docs sdk");
console.log(`/docs sdk -> ${(await fromBot((m) => /docs\/sdk\.md/.test(m.content), "/docs sdk")).content}`);

await say("/faq");
const faq = await fromBot((m) => m.components?.length > 0, "/faq");
const button = faq.components[0].components[1];
events.send({ type: "component_interaction", message_id: faq.id, custom_id: button.custom_id, values: [] });
const answer = await fromBot((m) => m.content?.includes(button.label), `button ${button.custom_id}`);
console.log(`/faq button "${button.label}" -> ${answer.content}`);

events.close();
console.log("smoke: ok");
process.exit(0);
