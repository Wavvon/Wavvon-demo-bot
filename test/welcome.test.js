import assert from "node:assert/strict";
import { test } from "node:test";
import welcome from "../src/features/welcome.js";
import { createRouter } from "../src/router.js";
import { openStore } from "../src/store.js";

const done = (data) => ({ data, response: new Response(null, { status: 200 }) });

function fakeHub(capabilities = ["apps.register", "events.member.joined"]) {
  const posted = [];
  const client = {
    hasCapability: async (c) => capabilities.includes(c),
    info: async () => ({ name: "Test Hub" }),
    rest: {
      GET: async () =>
        done([
          { id: "cat", name: "Text", is_category: true },
          { id: "c1", name: "general" },
          { id: "c2", name: "Lobby" },
        ]),
      POST: async (_path, opts) => (posted.push(opts), done({})),
    },
  };
  return { posted, ctx: { hubUrl: "https://hub", client, store: openStore(":memory:") } };
}

const run = (ctx, args, channel_id = "c1") =>
  welcome.slash.welcome({ args_raw: args, args_tokens: args.split(" ").filter(Boolean), channel_id }, ctx);

test("/welcome is privileged, so the hub decides who may configure it", () => {
  assert.equal(welcome.commands[0].privileged, true);
});

test("/welcome set picks a channel by name or the current one; off clears it", async () => {
  const { ctx } = fakeHub();
  assert.match((await run(ctx, "")).reply.body, /No welcome messages yet/);
  assert.match((await run(ctx, "set #lobby")).reply.body, /#Lobby/);
  assert.equal(ctx.store.get("https://hub", "welcome.channel"), "c2");
  assert.match((await run(ctx, "set")).reply.body, /#general/);
  assert.equal(ctx.store.get("https://hub", "welcome.channel"), "c1");
  assert.match((await run(ctx, "")).reply.body, /go to #general/);
  assert.match((await run(ctx, "set #nowhere")).reply.body, /can't find/);
  assert.match((await run(ctx, "set #text")).reply.body, /can't find/);
  await run(ctx, "off");
  assert.equal(ctx.store.get("https://hub", "welcome.channel"), undefined);
  assert.ok((await run(ctx, "set")).ephemeral);
});

test("/welcome set refuses on a hub without hub-membership events", async () => {
  const { ctx } = fakeHub(["apps.register"]);
  assert.match((await run(ctx, "set")).reply.body, /events\.member\.joined/);
  assert.equal(ctx.store.get("https://hub", "welcome.channel"), undefined);
});

test("subscribes to member.joined only where the hub advertises it", async () => {
  const router = createRouter([welcome]);
  assert.deepEqual(await router.subscriptions(fakeHub().ctx.client), [{ event: "member.joined" }]);
  assert.deepEqual(await router.subscriptions(fakeHub(["apps.register"]).ctx.client), []);
});

test("a join is greeted in the configured channel, and only once one is set", async () => {
  const router = createRouter([welcome]);
  const { ctx, posted } = fakeHub();
  const joined = { type: "hub_event", event: "member.joined", target_pubkey: "ab12cd34".repeat(8), payload: {} };
  await router.onEvent(joined, ctx);
  assert.equal(posted.length, 0);

  await run(ctx, "set #lobby");
  await router.onEvent(joined, ctx);
  await router.onEvent({ ...joined, payload: { display_name: "Ada" } }, ctx);
  await router.onEvent({ ...joined, event: "member.left" }, ctx);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].params.path.channel_id, "c2");
  assert.match(posted[0].body.content, /^Welcome to Test Hub, ab12cd34…!/);
  assert.match(posted[1].body.content, /^Welcome to Test Hub, Ada!/);
});
