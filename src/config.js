const list = (value) => (value ?? "").split(",").map((s) => s.trim());

/** Reads the bot's settings from the environment. Throws a sentence on anything missing. */
export function loadConfig(env = process.env) {
  const urls = list(env.WAVVON_HUB_URL).filter(Boolean);
  if (urls.length === 0) throw new Error("WAVVON_HUB_URL is required (one hub URL, or several separated by commas)");
  const seed = (env.WAVVON_SEED ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error("WAVVON_SEED must be 64 hex characters (openssl rand -hex 32)");
  if (!env.PUBLIC_BASE_URL) throw new Error("PUBLIC_BASE_URL is required: the address the hubs use to reach this bot");
  const invites = list(env.WAVVON_INVITE);
  return {
    hubs: urls.map((url, i) => ({ url: url.replace(/\/+$/, ""), invite: invites[i] || undefined })),
    seed,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    port: Number(env.PORT ?? 8080),
    dataDir: env.DATA_DIR ?? "data",
  };
}
