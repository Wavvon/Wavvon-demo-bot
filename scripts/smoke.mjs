// Drives a running bot through a real hub as a second member.
//
//   WAVVON_HUB_URL=http://localhost:3000  WAVVON_SEED=<the bot's seed>  node scripts/smoke.mjs
//
// With GITHUB_WEBHOOK_SECRET set (the bot's), it also delivers a signed
// release to the bot at BOT_URL (default http://localhost:8080).
//
// The bot's identity must own the hub (or hold invites.create and apps.register),
// the bot must be running against it, and the hub must allow plain-http
// webhooks (WAVVON_ALLOW_PRIVATE_WEBHOOKS=true) to reach a bot on localhost.

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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

const say = async (content) =>
  ok(await tester.rest.POST("/channels/{channel_id}/messages", { params: { path: { channel_id: channel.id } }, body: { content } }));

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

// The bot owns this hub, so it may configure itself.
async function asOwner(content) {
  ok(await bot.rest.POST("/channels/{channel_id}/messages", { params: { path: { channel_id: channel.id } }, body: { content } }));
  await new Promise((r) => setTimeout(r, 1000));
}

if (await bot.hasCapability("events.member.joined")) {
  // The hub refuses a privileged command itself and answers the POST with its refusal.
  const denied = await say("/welcome set");
  assert.match(denied.content, /permission/i);
  console.log(`/welcome set as a plain member -> ${denied.content}`);

  await asOwner(`/welcome set #${channel.name}`);

  const { code: second } = ok(await bot.rest.POST("/invites", { body: { max_uses: 1 } }));
  const newcomer = new WavvonClient({ hubUrl, seed: randomBytes(32).toString("hex"), inviteCode: second });
  const newKey = (await newcomer.login()).canonicalPubkey;
  const hello = await fromBot((m) => m.content?.includes(newKey.slice(0, 8)), "welcome for a new member");
  console.log(`a new member joins -> ${hello.content}`);
} else {
  console.log("hub lacks events.member.joined: welcome not tested");
}

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (secret) {
  await asOwner(`/releases set #${channel.name}`);
  const body = readFileSync(new URL("../test/fixtures/release-published.json", import.meta.url));
  const res = await fetch(`${process.env.BOT_URL ?? "http://localhost:8080"}/github`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "release",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
  });
  assert.equal(res.status, 200, await res.text());
  const release = await fromBot((m) => m.content?.includes("(v0.9.0)"), "release announcement");
  console.log(`GitHub release webhook -> ${release.content.replace(/\n+/g, " / ")}`);
} else {
  console.log("GITHUB_WEBHOOK_SECRET unset: releases not tested");
}

events.close();
console.log("smoke: ok");
process.exit(0);
