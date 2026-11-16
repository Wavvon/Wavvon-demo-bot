import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import features from "../src/features/index.js";
import { announcement, trimNotes, verifyGithubSignature } from "../src/features/releases.js";
import { createRouter } from "../src/router.js";
import { openStore } from "../src/store.js";

// Recorded once: the fixture's bytes signed with SECRET, as GitHub would send them.
const SECRET = "demo-bot-test-secret";
const PAYLOAD = readFileSync(new URL("./fixtures/release-published.json", import.meta.url));
const SIGNATURE = "sha256=1bb98628d11afd98eb5cb87668087d922816506e60e1e8a040d13044b1957963";

test("verifies GitHub's own documented example", () => {
  const sig = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  assert.ok(verifyGithubSignature("It's a Secret to Everybody", Buffer.from("Hello, World!"), sig));
  assert.ok(!verifyGithubSignature("It's a Secret to Everybody", Buffer.from("Hello, World?"), sig));
  assert.ok(!verifyGithubSignature("another secret", Buffer.from("Hello, World!"), sig));
  assert.ok(!verifyGithubSignature("It's a Secret to Everybody", Buffer.from("Hello, World!"), undefined));
  assert.ok(!verifyGithubSignature("It's a Secret to Everybody", Buffer.from("Hello, World!"), "sha256=00"));
});

test("the recorded payload verifies", () => {
  assert.ok(verifyGithubSignature(SECRET, PAYLOAD, SIGNATURE));
});

test("notes are trimmed at a line break", () => {
  assert.equal(trimNotes("short"), "short");
  assert.equal(trimNotes(undefined), "");
  const long = Array.from({ length: 50 }, (_, i) => `- line ${i} ${"x".repeat(20)}`).join("\r\n");
  const out = trimNotes(long, 200);
  assert.ok(out.length <= 202, out);
  assert.match(out, /x\n…$/);
  assert.equal(trimNotes("y".repeat(300), 200), `${"y".repeat(200)}\n…`);
});

test("the announcement carries name, tag, notes and link", () => {
  const text = announcement(JSON.parse(PAYLOAD));
  assert.match(text, /^\*\*Wavvon\/Wavvon-server\*\* release \*\*Wavvon 0\.9\.0\*\* \(v0\.9\.0\)/);
  assert.match(text, /## Highlights\n\n- Hub membership events/);
  assert.match(text, /https:\/\/github\.com\/Wavvon\/Wavvon-server\/releases\/tag\/v0\.9\.0$/);
});

function harness() {
  const posted = [];
  const hub = (hubUrl, channel) => {
    const store = openStore(":memory:");
    if (channel) store.set(hubUrl, "releases.channel", channel);
    const client = {
      rest: {
        POST: async (_path, opts) => (posted.push({ hubUrl, ...opts }), { data: {}, response: new Response() }),
      },
    };
    return { hubPublicKey: hubUrl === "https://a" ? "aa" : "bb", ctx: { hubUrl, client, store } };
  };
  const app = createApp({
    router: createRouter(features),
    config: { githubSecret: SECRET },
    hubs: [hub("https://a", "chan-a"), hub("https://b")],
  });
  const send = (body, { event = "release", sig } = {}) =>
    app(
      new Request("http://bot/github", {
        method: "POST",
        headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": sig ?? SIGNATURE },
        body,
      }),
    );
  return { app, send, posted };
}

test("a published release is posted to every hub that set a channel", async () => {
  const { send, posted } = harness();
  const res = await send(PAYLOAD);
  assert.equal(res.status, 200);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].hubUrl, "https://a");
  assert.equal(posted[0].params.path.channel_id, "chan-a");
  assert.match(posted[0].body.content, /Wavvon 0\.9\.0/);
});

test("a bad signature, another event or another action posts nothing", async () => {
  const { send, posted } = harness();
  assert.equal((await send(PAYLOAD, { sig: "sha256=" + "0".repeat(64) })).status, 401);
  assert.equal((await send(Buffer.concat([PAYLOAD, Buffer.from(" ")]))).status, 401);
  assert.equal((await send(PAYLOAD, { event: "push" })).status, 204);

  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(PAYLOAD), action: "edited" }));
  const sig = `sha256=${createHmac("sha256", SECRET).update(edited).digest("hex")}`;
  assert.equal((await send(edited, { sig })).status, 204);
  assert.equal(posted.length, 0);
});

test("without a secret the endpoint does not exist", async () => {
  const app = createApp({ router: createRouter(features), hubs: [] });
  const res = await app(new Request("http://bot/github", { method: "POST", body: PAYLOAD }));
  assert.equal(res.status, 404);
});
