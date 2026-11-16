import { ok } from "@wavvon/sdk";
import { displayName, findMember } from "../members.js";

export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
const MARKS = ["X", "O"];
const IDLE_MS = 10 * 60_000;
// Long enough for both players to see the final board before the frames close.
export const CLOSE_AFTER_MS = 15_000;

export function newGame(x, o) {
  return { players: [x, o], board: Array(9).fill(""), turn: 0, result: null, line: null };
}

/** { result: "X" | "O" | "draw", line } once the game is decided, else null. */
export function outcome(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { result: board[a], line };
  }
  return board.every(Boolean) ? { result: "draw", line: null } : null;
}

/** Applies `player`'s move to `cell`. Returns why it was refused, or undefined. */
export function play(game, player, cell) {
  if (game.result) return "The game is over.";
  const seat = game.players.indexOf(player);
  if (seat < 0) return "You are watching this game, not playing it.";
  if (seat !== game.turn) return "It is not your turn.";
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return "Pick a square from 0 to 8.";
  if (game.board[cell]) return "That square is taken.";
  game.board[cell] = MARKS[seat];
  const done = outcome(game.board);
  if (done) Object.assign(game, done);
  else game.turn = 1 - game.turn;
}

/** What one frame is shown. */
export function view(game, viewer) {
  const seat = game.players.indexOf(viewer);
  return {
    game: "tictactoe",
    t: "state",
    board: game.board,
    turn: MARKS[game.turn],
    you: seat < 0 ? null : MARKS[seat],
    players: { X: game.names[0], O: game.names[1] },
    result: game.result,
    line: game.line,
  };
}

const ephemeral = (body) => ({ reply: { body }, ephemeral: true });

function say({ client }, channel_id, content) {
  return client.rest
    .POST("/channels/{channel_id}/messages", { params: { path: { channel_id } }, body: { content } })
    .then(ok);
}

/** Closes this game in `ms`, replacing any earlier deadline; a newer game in the channel is left alone. */
function endIn(ms, game, channel, ctx) {
  clearTimeout(game.timer);
  game.timer = setTimeout(() => ctx.miniApp.get(channel)?.state === game && ctx.miniApp.end(channel), ms);
  game.timer.unref?.();
}

async function start(inv, ctx) {
  if (!ctx.miniApp) return ephemeral("I am still connecting to this hub. Try again in a moment.");
  const target = inv.args_tokens?.[0];
  if (!target) return ephemeral("Who are you playing? /tictactoe @member");
  const opponent = await findMember(ctx.client, target);
  if (!opponent) return ephemeral(`I can't find exactly one member called ${target}.`);
  if (opponent.public_key === inv.author.pubkey) return ephemeral("You need someone else to play against.");
  if (ctx.miniApp.get(inv.channel_id)) return ephemeral("There is already a game open in this channel.");

  const game = newGame(inv.author.pubkey, opponent.public_key);
  game.names = [displayName(inv.author.pubkey, inv.author.display_name), displayName(opponent.public_key, opponent.display_name)];
  game.viewers = new Set();
  const channel = inv.channel_id;
  try {
    ctx.miniApp.launch(channel, "tictactoe", game, "Tic-tac-toe", `${game.names[0]} (X) against ${game.names[1]} (O)`);
  } catch {
    return ephemeral("I can't open a game right now: my connection to the hub is down.");
  }
  endIn(IDLE_MS, game, channel, ctx);
  return { reply: { body: `${game.names[0]} challenges ${game.names[1]} to tic-tac-toe. Press Join on the card to play or watch.` } };
}

function onFrame({ from, channel_id, data }, { state: game }, ctx) {
  game.viewers.add(from);
  if (data.t === "move") {
    const refused = play(game, from, data.cell);
    if (refused) return ctx.miniApp.send(channel_id, from, { ...view(game, from), error: refused });
    for (const v of game.viewers) ctx.miniApp.send(channel_id, v, view(game, v));
    if (!game.result) return endIn(IDLE_MS, game, channel_id, ctx);
    endIn(CLOSE_AFTER_MS, game, channel_id, ctx);
    const [x, o] = game.names;
    const text =
      game.result === "draw"
        ? `Tic-tac-toe: ${x} and ${o} draw.`
        : `Tic-tac-toe: ${game.result === "X" ? x : o} beats ${game.result === "X" ? o : x}.`;
    return say(ctx, channel_id, text);
  }
  ctx.miniApp.send(channel_id, from, view(game, from));
}

export default {
  commands: [{ name: "tictactoe", description: "Challenge a member to tic-tac-toe", args: "@member" }],
  slash: { tictactoe: start },
  games: { tictactoe: onFrame },
};
