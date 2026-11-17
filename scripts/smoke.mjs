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

const say = async (content, channel_id = channel.id) =>
  ok(await tester.rest.POST("/channels/{channel_id}/messages", { params: { path: { channel_id } }, body: { content } }));

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

/** Joins the bot's mini-app in the channel the way a client does, then opens the frame's own socket. */
async function openFrame(client, stream, channelId = channel.id) {
  const opened = new Promise((resolve, reject) => {
    const off = stream.on("app_open", (e) => {
      off();
      resolve(e);
    });
    setTimeout(() => reject(new Error("no app_open")), 10_000);
  });
  stream.send({ type: "app_join", app_id: botKey, channel_id: channelId });
  const { session_token } = await opened;
  const url = new URL(`${hubUrl.replace(/\/+$/, "")}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", session_token);
  const ws = new WebSocket(url);
  const inbox = [];
  let poke = () => {};
  const send = (data) =>
    ws.send(JSON.stringify({ type: "mini_app_message", app_id: botKey, channel_id: channelId, payload: JSON.stringify(data) }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "hello") send({ t: "hello" });
    if (m.type === "mini_app_message" && m.channel_id === channelId) {
      inbox.push(JSON.parse(m.payload));
      poke();
    }
  };
  return {
    send,
    close: () => ws.close(),
    /** The next message from the bot that matches, dropping the ones before it. */
    async next(match, what) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const i = inbox.findIndex(match);
        if (i >= 0) return inbox.splice(0, i + 1).at(-1);
        if (Date.now() > deadline) throw new Error(`frame got no ${what}`);
        await new Promise((r) => {
          poke = r;
          setTimeout(r, 500);
        });
      }
    },
  };
}

{
  const { code: invite } = ok(await bot.rest.POST("/invites", { body: { max_uses: 1 } }));
  const rival = new WavvonClient({ hubUrl, seed: randomBytes(32).toString("hex"), inviteCode: invite });
  const rivalKey = (await rival.login()).canonicalPubkey;
  const rivalEvents = rival.connect();
  await new Promise((resolve) => rivalEvents.onStateChange((s) => s === "open" && resolve()));

  await say(`/tictactoe ${rivalKey}`);
  console.log(`/tictactoe -> ${(await fromBot((m) => /challenges/.test(m.content), "/tictactoe")).content}`);
  const x = await openFrame(tester, events);
  const o = await openFrame(rival, rivalEvents);
  await x.next((d) => d.game === "tictactoe" && d.you === "X", "board as X");
  await o.next((d) => d.game === "tictactoe" && d.you === "O", "board as O");

  o.send({ t: "move", cell: 4 });
  assert.match((await o.next((d) => d.error, "refusal")).error, /not your turn/);
  for (const [frame, cell] of [[x, 0], [o, 3], [x, 1], [o, 4]]) {
    frame.send({ t: "move", cell });
    await x.next((d) => d.board?.[cell], `move ${cell}`);
  }
  x.send({ t: "move", cell: 2 });
  for (const frame of [x, o]) {
    const end = await frame.next((d) => d.result, "the result");
    assert.equal(end.result, "X");
    assert.deepEqual(end.line, [0, 1, 2]);
  }
  console.log(`tic-tac-toe -> ${(await fromBot((m) => /beats/.test(m.content), "result message")).content}`);
  x.close();
  o.close();
  rivalEvents.close();
}

{
  // Tic-tac-toe holds the first channel until its result has been on screen a while.
  const arcade = ok(await bot.rest.POST("/channels", { body: { name: `smoke-arcade-${Date.now()}`, channel_type: "text" } }));
  events.send({ type: "subscribe", channel_id: arcade.id });
  await say("/cairn", arcade.id);
  console.log(`/cairn -> ${(await fromBot((m) => /Cairn is open/.test(m.content), "/cairn")).content}`);
  const frame = await openFrame(tester, events, arcade.id);
  assert.equal((await frame.next((d) => d.game === "cairn" && d.t === "hello", "Cairn hello")).best, null);

  frame.send({ t: "start" });
  frame.send({ t: "score", score: 600, lines: 3 });
  const cheat = await frame.next((d) => d.t === "result", "verdict on an impossible score");
  assert.equal(cheat.accepted, false);
  console.log(`Cairn, 600 points from 3 rows -> refused: ${cheat.reason}`);

  frame.send({ t: "start" });
  await new Promise((r) => setTimeout(r, 1500));
  frame.send({ t: "score", score: 40, lines: 3 });
  const kept = await frame.next((d) => d.t === "result", "verdict on a plausible score");
  assert.deepEqual([kept.accepted, kept.best, kept.rank], [true, 40, 1]);
  console.log("Cairn, 40 points from 3 rows in 1.5 s -> recorded, rank 1");
  frame.close();

  await say("/leaderboard", arcade.id);
  const top = await fromBot((m) => /top 10/.test(m.content), "/leaderboard");
  assert.ok(top.content.includes(`${me.slice(0, 8)}…: **40**`), top.content);
  console.log(`/leaderboard -> ${top.content.replace(/\n+/g, " / ")}`);
}

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
