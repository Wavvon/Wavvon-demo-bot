import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WavvonClient, toNodeListener } from "@wavvon/sdk";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
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
    });
    await client.setAppCommands(router.commands);
    const subscriptions = await router.subscriptions(client);
    await client.setAppSubscriptions(subscriptions);
    if (subscriptions.length > 0) {
      // The hub pushes hub_event only to a socket opened after the profile exists.
      const stream = client.connect();
      stream.onStateChange((s) => console.log(`${hubUrl}: socket ${s}`));
      stream.on("hub_event", (event) =>
        Promise.resolve()
          .then(() => router.onEvent(event, ctx))
          .catch((e) => console.error(`${hubUrl}: ${event.event} failed, ${e.message}`)),
      );
    }
    console.log(`${hubUrl}: ready as ${(await client.login()).canonicalPubkey}, events: ${subscriptions.map((s) => s.event).join(", ") || "none"}`);
  } catch (e) {
    console.error(`${hubUrl}: could not register, ${e.message}`);
  }
}
