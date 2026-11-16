import { ok } from "@wavvon/sdk";
import { channelSetting } from "../channel-setting.js";

const KEY = "welcome.channel";
// Older hubs fire member.joined on a voice-channel join; this string marks
// the hubs where it means joining the hub.
const CAPABILITY = "events.member.joined";

export function greeting(event, hubName) {
  const name = event.payload?.display_name || `${event.target_pubkey.slice(0, 8)}…`;
  return `Welcome to ${hubName}, ${name}! Try /faq for the basics, or /docs start.`;
}

export default {
  commands: [
    {
      name: "welcome",
      description: "Greet new members: /welcome set #channel, /welcome off",
      args: "set #channel | off",
      privileged: true,
    },
  ],
  slash: {
    welcome: channelSetting({ command: "welcome", key: KEY, what: "welcome messages", capability: CAPABILITY }),
  },
  events: {
    "member.joined": {
      capability: CAPABILITY,
      async handle(event, { hubUrl, client, store }) {
        const channel_id = store.get(hubUrl, KEY);
        if (!channel_id || !event.target_pubkey) return;
        const { name } = await client.info();
        ok(
          await client.rest.POST("/channels/{channel_id}/messages", {
            params: { path: { channel_id } },
            body: { content: greeting(event, name) },
          }),
        );
      },
    },
  },
};
