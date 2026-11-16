/**
 * Joins feature modules into one dispatcher. A feature is a plain object:
 *
 *   commands    slash commands it registers ({ name, description, args?, privileged? })
 *   slash       { [command]: (invocation, ctx) => AppResponse }
 *   components  { [prefix]: (interaction, rest, ctx) => ComponentResponse }
 *               for buttons whose custom_id is "<prefix>:<rest>"
 *   events      { [event]: { capability?, handle: (hubEvent, ctx) => void } }
 *               hub-wide events, subscribed to only where the hub advertises
 *               the capability
 *   routes      { [path]: (request, { config, hubs }) => Response }
 *               HTTP endpoints of the bot's own; `hubs` is every hub's ctx
 *
 * ctx is the hub the dispatch came from: { hubUrl, client, store }.
 */
export function createRouter(features) {
  const slash = new Map();
  const components = new Map();
  const commands = [];
  const events = new Map();
  const routes = new Map([["/hook", null], ["/health", null]]);
  for (const feature of features) {
    for (const [path, handler] of Object.entries(feature.routes ?? {})) {
      if (routes.has(path)) throw new Error(`route ${path} is taken`);
      routes.set(path, handler);
    }
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
    for (const [event, spec] of Object.entries(feature.events ?? {})) {
      if (events.has(event)) throw new Error(`event "${event}" is handled twice`);
      events.set(event, spec);
    }
  }
  return {
    commands,
    route: (path) => routes.get(path) ?? undefined,
    /** What this hub can serve, for PUT /me/app/subscriptions. */
    async subscriptions(client) {
      const out = [];
      for (const [event, spec] of events) {
        if (!spec.capability || (await client.hasCapability(spec.capability))) out.push({ event });
      }
      return out;
    },
    onEvent(event, ctx) {
      return events.get(event.event)?.handle(event, ctx);
    },
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
