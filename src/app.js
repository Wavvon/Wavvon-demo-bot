import { createDispatchHandler } from "@wavvon/sdk";

/**
 * The bot's HTTP surface as a fetch-style handler. `hubs` is a list of
 * { hubPublicKey, ctx }; one /hook URL serves them all, and a dispatch is
 * verified against the key of the hub it names (X-Wavvon-Hub-Pubkey), which
 * the bot pinned from that hub's /info at startup.
 */
export function createApp({ hubs, router, config = {} }) {
  const shared = { config, hubs: hubs.map((h) => h.ctx) };
  const hooks = new Map();
  for (const { hubPublicKey, ctx } of hubs) {
    hooks.set(
      hubPublicKey.toLowerCase(),
      createDispatchHandler({
        hubPublicKey,
        onSlashCommand: (inv) => router.onSlashCommand(inv, ctx),
        onComponent: (inv) => router.onComponent(inv, ctx),
      }),
    );
  }
  return async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/health") return new Response("ok");
    if (path === "/hook") {
      const hook = hooks.get(req.headers.get("x-wavvon-hub-pubkey")?.toLowerCase() ?? "");
      return hook ? hook(req) : new Response("not a hub this bot serves", { status: 401 });
    }
    const route = router.route(path);
    return route ? route(req, shared) : new Response("not found", { status: 404 });
  };
}
