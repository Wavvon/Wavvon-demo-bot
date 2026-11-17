import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { clearPoints, depthFor, maxScore } from "../frame/cairn-rules.js";
import cairn, { MIN_MS_PER_LINE, implausible, leaderboard } from "../src/features/cairn.js";
import { createRouter } from "../src/router.js";

test("clears score by rows at once, gems double their row, depth multiplies", () => {
  assert.equal(clearPoints(1, 0, 0), 10);
  assert.equal(clearPoints(2, 0, 0), 30);
  assert.equal(clearPoints(3, 0, 0), 60);
  assert.equal(clearPoints(3, 1, 0), 80);
  assert.equal(clearPoints(3, 3, 0), 120);
  assert.equal(clearPoints(2, 1, 8), 90);
  assert.equal(clearPoints(0, 0, 0), 0);
  assert.equal(depthFor(7), 1);
  assert.equal(depthFor(8), 2);
});

test("no sequence of clears can beat maxScore", () => {
  // Best case: always three gem rows at once.
  let lines = 0;
  let score = 0;
  while (lines < 60) {
    score += clearPoints(3, 3, lines);
    lines += 3;
    assert.ok(score <= maxScore(lines), `${score} > ${maxScore(lines)} at ${lines}`);
  }
});

test("a believable run passes; impossible ones are refused with a reason", () => {
  assert.equal(implausible({ score: 0, lines: 0 }, 5_000), undefined);
  assert.equal(implausible({ score: 330, lines: 12 }, 60_000), undefined);
  assert.match(implausible({ score: 50, lines: 0 }, 60_000), /cannot come from 0 rows/);
  assert.match(implausible({ score: 10_000, lines: 10 }, 600_000), /cannot come from/);
  assert.match(implausible({ score: 33, lines: 3 }, 60_000), /cannot come from/);
  assert.match(implausible({ score: 100, lines: 10 }, 10 * MIN_MS_PER_LINE - 1), /faster than/);
  assert.match(implausible({ score: 10, lines: 1 }, 5 * 3600_000), /outlasted/);
  assert.match(implausible({ score: "10", lines: 1 }, 60_000), /not a score/);
  assert.match(implausible({ score: -10, lines: 1 }, 60_000), /not a score/);
  assert.match(implausible({ score: 10, lines: 1.5 }, 60_000), /not a score/);
});

test("the leaderboard keeps each player's best, per hub, best first", () => {
  const board = leaderboard(new DatabaseSync(":memory:"));
  assert.equal(board.record("h1", "a", 100, 5, 1), 1);
  assert.equal(board.record("h1", "b", 300, 9, 2), 1);
  assert.equal(board.record("h1", "a", 50, 2, 3), 2);
  assert.equal(board.best("h1", "a"), 100);
  board.record("h2", "c", 999, 30, 4);
  assert.deepEqual(board.top("h1").map((r) => [r.pubkey, r.score]), [["b", 300], ["a", 100]]);
  assert.equal(board.best("h2", "a"), null);
});

test("a run is recorded only if the bot saw it start, and only once", (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const sent = [];
  const sessions = new Map();
  const ctx = {
    hubUrl: "h",
    store: { db: new DatabaseSync(":memory:") },
    miniApp: { get: (c) => sessions.get(c), send: (c, to, data) => sent.push({ to, data }), end: (c) => sessions.delete(c) },
  };
  sessions.set("c1", { game: "cairn", state: { runs: new Map() } });
  const router = createRouter([cairn]);
  const msg = (data) => ({ from_pubkey: "p", channel_id: "c1", payload: JSON.stringify(data) });

  router.onMiniAppMessage(msg({ t: "hello" }), ctx);
  assert.deepEqual(sent.at(-1).data, { game: "cairn", t: "hello", best: null });
  router.onMiniAppMessage(msg({ t: "score", score: 60, lines: 3 }), ctx);
  assert.match(sent.at(-1).data.reason, /never saw/);

  router.onMiniAppMessage(msg({ t: "start" }), ctx);
  t.mock.timers.tick(30_000);
  router.onMiniAppMessage(msg({ t: "score", score: 60, lines: 3 }), ctx);
  assert.deepEqual(sent.at(-1).data, { game: "cairn", t: "result", accepted: true, best: 60, rank: 1 });
  router.onMiniAppMessage(msg({ t: "score", score: 600, lines: 30 }), ctx);
  assert.equal(sent.at(-1).data.accepted, false);

  router.onMiniAppMessage(msg({ t: "start" }), ctx);
  t.mock.timers.tick(1_000);
  router.onMiniAppMessage(msg({ t: "score", score: 300, lines: 15 }), ctx);
  assert.match(sent.at(-1).data.reason, /faster than/);
  assert.equal(leaderboard(ctx.store.db).best("h", "p"), 60);
});
