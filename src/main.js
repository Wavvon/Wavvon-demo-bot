import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WavvonClient, toNodeListener } from "@wavvon/sdk";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createMiniApp } from "./mini-app.js";
import features from "./features/index.js";
import { createRouter } from "./router.js";
import { openStore } from "./store.js";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(join(config.dataDir, "bot.sqlite"));
const router = createRouter(features);

const hubs = [];
for (const { url, invite } of config.hubs) {
  const client = new WavvonClient({ hubUrl: url, seed: config.seed, inviteCode: invite });
  try {
    const { public_key: hubPublicKey } = await client.info();
    hubs.push({ hubPublicKey, ctx: { hubUrl: url, client, store } });
  } catch (e) {
    console.error(`${url}: skipped, ${e.message}`);
  }
}
if (hubs.length === 0) throw new Error("no hub reachable");

createServer(toNodeListener(createApp({ hubs, router, config }))).listen(config.port, () =>
  console.log(`listening on :${config.port}`),
);

for (const { ctx } of hubs) {
  const { client, hubUrl } = ctx;
  try {
    await client.setAppProfile({
      name: "Wavvon Demo",
      description: "Shows what a program can do on Wavvon.",
      webhook_url: `${config.publicBaseUrl}/hook`,
      homepage_url: "https://github.com/Wavvon/Wavvon-demo-bot",
      mini_app_url: `${config.publicBaseUrl}/play/`,
    });
    await client.setAppCommands(router.commands);
    const subscriptions = await router.subscriptions(client);
    await client.setAppSubscriptions(subscriptions);
    // The hub treats a socket as the app's (hub_event, mini-app relay) only if
    // the profile existed when it connected.
    const stream = client.connect();
    const appId = (await client.login()).canonicalPubkey;
    ctx.miniApp = createMiniApp(stream, appId);
    stream.onStateChange((s) => console.log(`${hubUrl}: socket ${s}`));
    const handle = (what, fn) =>
      Promise.resolve()
        .then(fn)
        .catch((e) => console.error(`${hubUrl}: ${what} failed, ${e.message}`));
    stream.on("hub_event", (event) => handle(event.event, () => router.onEvent(event, ctx)));
    stream.on("mini_app_message", (event) => handle("mini_app_message", () => router.onMiniAppMessage(event, ctx)));
    console.log(`${hubUrl}: ready as ${appId}, events: ${subscriptions.map((s) => s.event).join(", ") || "none"}`);
  } catch (e) {
    console.error(`${hubUrl}: could not register, ${e.message}`);
  }
}
