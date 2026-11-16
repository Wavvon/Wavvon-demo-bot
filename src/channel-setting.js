import { ok } from "@wavvon/sdk";

const reply = (body) => ({ reply: { body }, ephemeral: true });

/** "#general", "general" or nothing (the channel the command was typed in) -> a channel, or undefined. */
export async function findChannel(client, arg, hereId) {
  const channels = ok(await client.rest.GET("/channels"));
  const name = (arg ?? "").replace(/^#/, "").toLowerCase();
  return channels.find((c) => !c.is_category && (name ? c.name?.toLowerCase() === name : c.id === hereId));
}

/**
 * A slash handler for `/<command> set [#channel]`, `/<command> off` and
 * `/<command>` (status), storing the channel id per hub under `key`. Who may
 * run it is the hub's call: register the command with `privileged: true`.
 */
export function channelSetting({ command, key, what, capability }) {
  return async (inv, { hubUrl, client, store }) => {
    const [verb, target] = inv.args_tokens ?? [];
    if (verb === "off") {
      store.delete(hubUrl, key);
      return reply(`Done: no more ${what}.`);
    }
    if (verb === "set") {
      if (capability && !(await client.hasCapability(capability))) {
        return reply(`This hub does not support ${what} yet (it lacks ${capability}).`);
      }
      const channel = await findChannel(client, target, inv.channel_id);
      if (!channel) return reply(`I can't find ${target ? `a channel named ${target}` : "this channel"}.`);
      store.set(hubUrl, key, channel.id);
      return reply(`Done: ${what} go to #${channel.name}.`);
    }
    const id = store.get(hubUrl, key);
    const channel = id && (await findChannel(client, undefined, id));
    return reply(
      channel
        ? `${what[0].toUpperCase()}${what.slice(1)} go to #${channel.name}. /${command} off stops them.`
        : `No ${what} yet. /${command} set #channel picks where they go.`,
    );
  };
}
