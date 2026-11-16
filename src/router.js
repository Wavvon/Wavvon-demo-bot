/**
 * Joins feature modules into one dispatcher. A feature is a plain object:
 *
 *   commands    slash commands it registers ({ name, description, args?, privileged? })
 *   slash       { [command]: (invocation, ctx) => AppResponse }
 *   components  { [prefix]: (interaction, rest, ctx) => ComponentResponse }
 *               for buttons whose custom_id is "<prefix>:<rest>"
 *
 * ctx is the hub the dispatch came from: { hubUrl, client, store }.
 */
export function createRouter(features) {
  const slash = new Map();
  const components = new Map();
  const commands = [];
  for (const feature of features) {
    for (const command of feature.commands ?? []) {
      if (slash.has(command.name)) throw new Error(`/${command.name} is registered twice`);
      const handler = feature.slash?.[command.name];
      if (!handler) throw new Error(`/${command.name} has no handler`);
      slash.set(command.name, handler);
      commands.push(command);
    }
    for (const [prefix, handler] of Object.entries(feature.components ?? {})) {
      if (components.has(prefix)) throw new Error(`component prefix "${prefix}" is registered twice`);
      components.set(prefix, handler);
    }
  }
  return {
    commands,
    onSlashCommand(inv, ctx) {
      const handler = slash.get(inv.command);
      if (!handler) return { reply: { body: `I don't know /${inv.command}.` }, ephemeral: true };
      return handler(inv, ctx);
    },
    onComponent(inv, ctx) {
      const colon = inv.custom_id.indexOf(":");
      const prefix = colon < 0 ? inv.custom_id : inv.custom_id.slice(0, colon);
      const handler = components.get(prefix);
      if (!handler) return { ephemeral_reply: { body: "That button no longer does anything." } };
      return handler(inv, colon < 0 ? "" : inv.custom_id.slice(colon + 1), ctx);
    },
  };
}
