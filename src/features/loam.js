import { ok } from "@wavvon/sdk";
import { DIRS, SIZE, TICK_MS } from "../../frame/loam-rules.js";
import { displayName, findMember } from "../members.js";

// Loam: worms gather dew in a garden plot. Hitting a wall or any worm curls
// you up: you shed half your length as dew for the others and sit still for a
// moment. Nobody dies; the longest worm when time runs out wins. The bot runs
// the plot; each frame only steers its own worm and reports where it is to
// its own client's proximity voice.
export const START_LEN = 4;
export const MAX_WORMS = 8;
export const STUN_TICKS = 10;
export const DEW = 14;
export const DEFAULT_MINUTES = 3;
const IDLE_MS = 10 * 60_000;
const COUNTDOWN_MS = 3_000;

const key = ([x, y]) => y * SIZE + x;
const free = (game) => {
  const taken = new Set(game.dew.map(key));
  for (const w of game.worms) for (const c of w.body) taken.add(key(c));
  return taken;
};

export function newPlot(rng = Math.random) {
  return { worms: [], dew: [], rng };
}

function randomCell(game, taken, margin = 0) {
  for (let i = 0; i < 200; i++) {
    const c = [margin + Math.floor(game.rng() * (SIZE - 2 * margin)), margin + Math.floor(game.rng() * (SIZE - 2 * margin))];
    if (!taken.has(key(c))) return c;
  }
}

/** Places a worm of START_LEN facing right, its body trailing to the left. Returns it, or undefined if the plot is full. */
export function addWorm(game, pubkey, name) {
  if (game.worms.length >= MAX_WORMS) return;
  const taken = free(game);
  for (let i = 0; i < 200; i++) {
    const [hx, hy] = [START_LEN + 2 + Math.floor(game.rng() * (SIZE - START_LEN - 6)), 3 + Math.floor(game.rng() * (SIZE - 6))];
    const body = Array.from({ length: START_LEN }, (_, j) => [hx - j, hy]);
    if (body.some((c) => taken.has(key(c)))) continue;
    const worm = { pubkey, name, seat: game.worms.length, body, dir: "right", next: "right", grow: 0, stunned: 0, best: START_LEN };
    game.worms.push(worm);
    return worm;
  }
}

/** Queues a turn; a worm cannot fold back onto its own neck. */
export function steer(worm, dir) {
  if (!Object.hasOwn(DIRS, dir)) return false;
  const [dx, dy] = DIRS[dir];
  const [cx, cy] = DIRS[worm.dir];
  if (dx === -cx && dy === -cy) return false;
  worm.next = dir;
  return true;
}

function curl(game, worm, taken) {
  const keep = Math.max(START_LEN, Math.ceil(worm.body.length / 2));
  game.dew.push(...worm.body.splice(keep));
  worm.grow = 0;
  worm.stunned = STUN_TICKS;
  const [hx, hy] = worm.body[0];
  worm.dir = worm.next =
    Object.keys(DIRS).find((d) => {
      const [x, y] = [hx + DIRS[d][0], hy + DIRS[d][1]];
      return x >= 0 && y >= 0 && x < SIZE && y < SIZE && !taken.has(key([x, y]));
    }) ?? worm.dir;
}

/** One tick: every awake worm moves a cell; bumps curl, dew grows. Returns the worms that curled. */
export function step(game) {
  const taken = new Set();
  for (const w of game.worms) for (const c of w.body) taken.add(key(c));
  const moving = game.worms.filter((w) => w.stunned === 0 || (w.stunned--, false));
  const heads = new Map();
  for (const w of moving) {
    w.dir = w.next;
    const [hx, hy] = w.body[0];
    w.target = [hx + DIRS[w.dir][0], hy + DIRS[w.dir][1]];
    heads.set(key(w.target), (heads.get(key(w.target)) ?? 0) + 1);
  }
  const curled = [];
  for (const w of moving) {
    const [x, y] = w.target;
    const k = key(w.target);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || taken.has(k) || heads.get(k) > 1) {
      curl(game, w, taken);
      curled.push(w);
      continue;
    }
    w.body.unshift(w.target);
    const d = game.dew.findIndex((c) => key(c) === k);
    if (d >= 0) {
      game.dew.splice(d, 1);
      w.grow++;
    }
    if (w.grow > 0) w.grow--;
    else w.body.pop();
    w.best = Math.max(w.best, w.body.length);
  }
  fillDew(game);
  return curled;
}

export function fillDew(game) {
  const taken = free(game);
  while (game.dew.length < DEW) {
    const c = randomCell(game, taken, 1);
    if (!c) break;
    game.dew.push(c);
    taken.add(key(c));
  }
}

/** Longest first; a tie goes to the longer best. */
export const standings = (game) =>
  [...game.worms].sort((a, b) => b.body.length - a.body.length || b.best - a.best).map((w) => ({ seat: w.seat, name: w.name, length: w.body.length, best: w.best }));

/** What one frame is shown. */
export function view(game, viewer, now = Date.now()) {
  return {
    game: "loam",
    t: "state",
    phase: game.phase,
    size: SIZE,
    left_ms: game.endsAt ? Math.max(0, game.endsAt - now) : game.minutes * 60_000,
    starts_in_ms: game.startsAt ? Math.max(0, game.startsAt - now) : 0,
    you: game.worms.findIndex((w) => w.pubkey === viewer),
    worms: game.worms.map((w) => ({ name: w.name, seat: w.seat, body: w.body, stunned: w.stunned > 0 })),
    dew: game.dew,
    standings: game.phase === "over" ? standings(game) : undefined,
  };
}

const ephemeral = (body) => ({ reply: { body }, ephemeral: true });

function keepOpen(game, channel, ctx) {
  clearTimeout(game.idle);
  game.idle = setTimeout(() => ctx.miniApp.get(channel)?.state === game && ctx.miniApp.end(channel), IDLE_MS);
  game.idle.unref?.();
}

function broadcast(game, channel, ctx) {
  const now = Date.now();
  for (const v of game.viewers) ctx.miniApp.send(channel, v, view(game, v, now));
}

function finish(game, channel, ctx) {
  clearInterval(game.loop);
  game.loop = undefined;
  game.phase = "over";
  game.endsAt = game.startsAt = undefined;
  broadcast(game, channel, ctx);
  const rows = standings(game).map((s, i) => `${i + 1}. ${s.name}: ${s.length} long`);
  return ctx.client.rest
    .POST("/channels/{channel_id}/messages", {
      params: { path: { channel_id: channel } },
      body: { content: `**Loam: the round is over**\n${rows.join("\n")}` },
    })
    .then(ok)
    .catch(() => {});
}

function begin(game, channel, ctx) {
  const now = Date.now();
  const players = game.worms.map((w) => [w.pubkey, w.name]);
  Object.assign(game, newPlot(game.rng), { phase: "countdown", startsAt: now + COUNTDOWN_MS });
  for (const [pubkey, name] of players) addWorm(game, pubkey, name);
  fillDew(game);
  broadcast(game, channel, ctx);
  game.loop = setInterval(() => {
    if (ctx.miniApp.get(channel)?.state !== game) return clearInterval(game.loop);
    const t = Date.now();
    if (game.phase === "countdown") {
      if (t < game.startsAt) return;
      Object.assign(game, { phase: "running", startsAt: undefined, endsAt: t + game.minutes * 60_000 });
    }
    if (t >= game.endsAt) return finish(game, channel, ctx);
    step(game);
    broadcast(game, channel, ctx);
  }, TICK_MS);
  game.loop.unref?.();
}

function open(inv, ctx) {
  if (!ctx.miniApp) return ephemeral("I am still connecting to this hub. Try again in a moment.");
  const arg = inv.args_tokens?.[0];
  const minutes = arg === undefined ? DEFAULT_MINUTES : Number(arg);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 5) return ephemeral("A round lasts 1 to 5 minutes: /loam 2");
  if (ctx.miniApp.get(inv.channel_id)) return ephemeral("There is already a game open in this channel.");
  const game = { ...newPlot(), phase: "lobby", minutes, viewers: new Set() };
  fillDew(game);
  try {
    ctx.miniApp.launch(inv.channel_id, "loam", game, "Loam", `Worms in a garden plot, ${minutes} min rounds. Voices fade with distance.`);
  } catch {
    return ephemeral("I can't open the game right now: my connection to the hub is down.");
  }
  keepOpen(game, inv.channel_id, ctx);
  return {
    reply: {
      body: `Loam is open: press Join on the card to dig in. Be in this channel's voice with the room map on, and the worms you drift away from fade out.`,
    },
  };
}

function onFrame({ from, channel_id, data }, { state: game }, ctx) {
  keepOpen(game, channel_id, ctx);
  game.viewers.add(from);
  const worm = game.worms.find((w) => w.pubkey === from);
  if (data.t === "hello") {
    if (worm) return broadcast(game, channel_id, ctx);
    const added = addWorm(game, from, displayName(from));
    broadcast(game, channel_id, ctx);
    if (!added) return;
    return findMember(ctx.client, from)
      .then((m) => m?.display_name && (added.name = m.display_name))
      .catch(() => {});
  }
  if (data.t === "steer" && worm) return void steer(worm, data.dir);
  if (data.t === "start" && worm && !game.loop) return begin(game, channel_id, ctx);
  ctx.miniApp.send(channel_id, from, view(game, from));
}

export default {
  commands: [{ name: "loam", description: "Open Loam, a worm game where voices fade with distance", args: "[minutes]" }],
  slash: { loam: open },
  games: { loam: onFrame },
};
