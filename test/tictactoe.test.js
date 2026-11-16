import assert from "node:assert/strict";
import { test } from "node:test";
import { createRouter } from "../src/router.js";
import tictactoe, { newGame, outcome, play, view } from "../src/features/tictactoe.js";

const X = "aa".repeat(32);
const O = "bb".repeat(32);

test("every line wins, a full board without one is a draw", () => {
  for (const line of [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]) {
    const board = Array(9).fill("");
    for (const i of line) board[i] = "O";
    assert.deepEqual(outcome(board), { result: "O", line });
  }
  assert.deepEqual(outcome(["X", "O", "X", "X", "O", "O", "O", "X", "X"]), { result: "draw", line: null });
  assert.equal(outcome(["X", "O", "", "", "", "", "", "", ""]), null);
});

test("moves are refused out of turn, off the board, on a taken square, or by a spectator", () => {
  const g = newGame(X, O);
  assert.match(play(g, O, 0), /not your turn/);
  assert.match(play(g, "cc".repeat(32), 0), /watching/);
  assert.match(play(g, X, 9), /0 to 8/);
  assert.match(play(g, X, "4"), /0 to 8/);
  assert.equal(play(g, X, 4), undefined);
  assert.match(play(g, O, 4), /taken/);
  assert.match(play(g, X, 0), /not your turn/);
  assert.deepEqual(g.board, ["", "", "", "", "X", "", "", "", ""]);
});

test("a full game: X wins on the diagonal and the board then freezes", () => {
  const g = newGame(X, O);
  for (const [who, cell] of [[X, 0], [O, 1], [X, 4], [O, 2]]) assert.equal(play(g, who, cell), undefined);
  assert.equal(g.result, null);
  assert.equal(play(g, X, 8), undefined);
  assert.equal(g.result, "X");
  assert.deepEqual(g.line, [0, 4, 8]);
  assert.match(play(g, O, 5), /over/);
  g.names = ["Ada", "Bo"];
  assert.equal(view(g, O).you, "O");
  assert.equal(view(g, "cc".repeat(32)).you, null);
});

test("frames' messages reach the game of their channel; a channel without one is told it ended", () => {
  const sent = [];
  const sessions = new Map();
  const ctx = {
    client: { rest: { POST: async () => ({ data: {}, response: { ok: true } }) } },
    miniApp: {
      get: (c) => sessions.get(c),
      send: (c, to, data) => sent.push({ c, to, data }),
      end: (c) => sessions.delete(c),
    },
  };
  const game = Object.assign(newGame(X, O), { names: ["Ada", "Bo"], viewers: new Set() });
  sessions.set("c1", { game: "tictactoe", state: game });
  const router = createRouter([tictactoe]);
  const msg = (from, data, channel_id = "c1") => ({ type: "mini_app_message", from_pubkey: from, channel_id, payload: JSON.stringify(data) });

  router.onMiniAppMessage(msg(O, { t: "hello" }), ctx);
  router.onMiniAppMessage(msg(X, { t: "move", cell: 4 }), ctx);
  assert.deepEqual(sent.slice(-2).map((s) => [s.to, s.data.board[4]]).sort(), [[X, "X"], [O, "X"]].sort());
  router.onMiniAppMessage(msg(X, { t: "move", cell: 0 }), ctx);
  assert.match(sent.at(-1).data.error, /not your turn/);
  assert.equal(sent.at(-1).to, X);

  router.onMiniAppMessage(msg(X, { t: "hello" }, "c2"), ctx);
  assert.deepEqual(sent.at(-1), { c: "c2", to: X, data: { t: "ended" } });
  const before = sent.length;
  router.onMiniAppMessage({ ...msg(X, { t: "hello" }), payload: "not json" }, ctx);
  router.onMiniAppMessage({ ...msg(X, { t: "hello" }), from_pubkey: undefined }, ctx);
  assert.equal(sent.length, before);
  clearTimeout(game.timer);
});
