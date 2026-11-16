const WIKI = "https://github.com/Wavvon/Wavvon-docs/blob/main/docs";

/** Topic -> page of the Wavvon-docs wiki. */
export const TOPICS = {
  start: "getting-started",
  hosting: "hub-operator-guide",
  identity: "identity",
  devices: "multi-device",
  permissions: "permissions",
  voice: "voice",
  federation: "federation",
  alliances: "alliances",
  apps: "apps",
  sdk: "sdk",
  "mini-apps": "mini-apps",
  webhooks: "outgoing-webhooks",
};

export default {
  commands: [{ name: "docs", description: "Link a page of the Wavvon docs", args: "<topic>" }],
  slash: {
    docs(inv) {
      const topic = inv.args_raw.trim().toLowerCase();
      if (!Object.hasOwn(TOPICS, topic)) {
        return { reply: { body: `Topics: ${Object.keys(TOPICS).join(", ")}. Try /docs start.` }, ephemeral: true };
      }
      return { reply: { body: `${WIKI}/${TOPICS[topic]}.md` } };
    },
  },
};
