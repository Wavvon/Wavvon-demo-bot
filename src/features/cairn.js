import { maxScore } from "../../frame/cairn-rules.js";
import { displayName, findMember } from "../members.js";

// Cairn is played entirely in the player's frame; all the bot sees is when a
// run started and what score it claims at the end. These checks catch an
// impossible claim, not a well-made fake: see README, "Cairn".
export const MIN_MS_PER_LINE = 250;
const MAX_RUN_MS = 4 * 3600_000 + 60_000; // a frame's token lives four hours
const MAX_LINES = 100_000;
// A playing frame sends a tick every minute, so this only closes abandoned cards.
const IDLE_MS = 5 * 60_000;
const TOP = 10;

/** Why a claimed run cannot have been played in `elapsedMs`, or undefined. */
export function implausible({ score, lines }, elapsedMs) {
  if (!Number.isSafeInteger(score) || !Number.isSafeInteger(lines) || score < 0 || lines < 0 || lines > MAX_LINES) {
    return "that is not a score";
  }
  if (score % 5 !== 0 || score > maxScore(lines)) return `${score} points cannot come from ${lines} rows`;
  if (elapsedMs < lines * MIN_MS_PER_LINE) return `${lines} rows in ${Math.round(elapsedMs / 1000)} s is faster than stones fall`;
  if (elapsedMs > MAX_RUN_MS) return "that run outlasted its session";
}

const boards = new WeakMap();

/** The per-hub leaderboard: each player's best run. */
export function leaderboard(db) {
  let board = boards.get(db);
  if (board) return board;
  db.exec(
    "CREATE TABLE IF NOT EXISTS cairn_scores (hub TEXT NOT NULL, pubkey TEXT NOT NULL, score INTEGER NOT NULL, lines INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (hub, pubkey))",
  );
  const best = db.prepare("SELECT score FROM cairn_scores WHERE hub = ? AND pubkey = ?");
  const record = db.prepare(
    `INSERT INTO cairn_scores (hub, pubkey, score, lines, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (hub, pubkey) DO UPDATE SET score = excluded.score, lines = excluded.lines, at = excluded.at
     WHERE excluded.score > cairn_scores.score`,
  );
  const rank = db.prepare("SELECT COUNT(*) + 1 AS rank FROM cairn_scores WHERE hub = ? AND score > ?");
  const top = db.prepare("SELECT pubkey, score, lines FROM cairn_scores WHERE hub = ? ORDER BY score DESC, at ASC LIMIT ?");
  board = {
    best: (hub, pubkey) => best.get(hub, pubkey)?.score ?? null,
    /** Keeps the run if it beats the player's best; returns the player's rank by that best. */
    record(hub, pubkey, score, lines, at = Date.now()) {
      record.run(hub, pubkey, score, lines, at);
      return rank.get(hub, this.best(hub, pubkey)).rank;
    },
    top: (hub, n = TOP) => top.all(hub, n),
  };
  boards.set(db, board);
  return board;
}

const ephemeral = (body) => ({ reply: { body }, ephemeral: true });

function keepOpen(session, channel, ctx) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => ctx.miniApp.get(channel)?.state === session && ctx.miniApp.end(channel), IDLE_MS);
  session.timer.unref?.();
}

function open(inv, ctx) {
  if (!ctx.miniApp) return ephemeral("I am still connecting to this hub. Try again in a moment.");
  const current = ctx.miniApp.get(inv.channel_id);
  if (current && current.game !== "cairn") return ephemeral("There is already a game open in this channel.");
  const session = current?.state ?? { runs: new Map() };
  try {
    ctx.miniApp.launch(inv.channel_id, "cairn", session, "Cairn", "Stack falling stones, clear rows, climb the hub's leaderboard.");
  } catch {
    return ephemeral("I can't open the game right now: my connection to the hub is down.");
  }
  keepOpen(session, inv.channel_id, ctx);
  return { reply: { body: "Cairn is open: press Join on the card to play. /leaderboard shows this hub's best." } };
}

async function showLeaderboard(_inv, { hubUrl, client, store }) {
  const rows = leaderboard(store.db).top(hubUrl);
  if (rows.length === 0) return { reply: { body: "No Cairn scores on this hub yet. /cairn opens the game." } };
  const names = await Promise.all(
    rows.map((r) =>
      findMember(client, r.pubkey)
        .then((m) => displayName(r.pubkey, m?.display_name))
        .catch(() => displayName(r.pubkey)),
    ),
  );
  const lines = rows.map((r, i) => `${i + 1}. ${names[i]}: **${r.score}** (${r.lines} rows)`);
  return { reply: { body: `**Cairn: this hub's top ${TOP}**\n${lines.join("\n")}` } };
}

function onFrame({ from, channel_id, data }, { state: session }, ctx) {
  const now = Date.now();
  keepOpen(session, channel_id, ctx);
  const board = leaderboard(ctx.store.db);
  const reply = (body) => ctx.miniApp.send(channel_id, from, { game: "cairn", ...body });
  if (data.t === "start") return void session.runs.set(from, now);
  if (data.t === "tick") return;
  if (data.t === "score") {
    const started = session.runs.get(from);
    session.runs.delete(from);
    const claim = { score: data.score, lines: data.lines };
    const refused = started === undefined ? "the bot never saw this run start" : implausible(claim, now - started);
    if (refused) return reply({ t: "result", accepted: false, reason: refused, best: board.best(ctx.hubUrl, from) });
    const rank = board.record(ctx.hubUrl, from, claim.score, claim.lines, now);
    return reply({ t: "result", accepted: true, best: board.best(ctx.hubUrl, from), rank });
  }
  reply({ t: "hello", best: board.best(ctx.hubUrl, from) });
}

export default {
  commands: [
    { name: "cairn", description: "Open Cairn, a falling-stones puzzle, in this channel" },
    { name: "leaderboard", description: "This hub's top 10 Cairn scores" },
  ],
  slash: { cairn: open, leaderboard: showLeaderboard },
  games: { cairn: onFrame },
};
