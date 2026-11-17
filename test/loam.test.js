import assert from "node:assert/strict";
import { test } from "node:test";
import { SIZE, toZone } from "../frame/loam-rules.js";
import { DEW, MAX_WORMS, START_LEN, STUN_TICKS, addWorm, fillDew, newPlot, standings, step, steer, view } from "../src/features/loam.js";

const A = "aa".repeat(32);
const B = "bb".repeat(32);

/** A plot with hand-placed worms, no random dew. */
function plot(...worms) {
  let seed = 7;
  const g = newPlot(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  worms.forEach(([body, dir], seat) =>
    g.worms.push({ pubkey: [A, B][seat], name: `w${seat}`, seat, body, dir, next: dir, grow: 0, stunned: 0, best: body.length }),
  );
  return g;
}

test("the plot maps onto the room map's 0..100 zone, cell centres inside it", () => {
  assert.deepEqual(toZone([0, 0]), [1.25, 1.25]);
  assert.deepEqual(toZone([SIZE - 1, SIZE - 1]), [98.75, 98.75]);
  assert.deepEqual(toZone([SIZE / 2, 0]), [51.25, 1.25]);
  for (let x = 0; x < SIZE; x++) {
    const [zx] = toZone([x, 0]);
    assert.ok(zx > 0 && zx < 100);
    if (x) assert.ok(zx > toZone([x - 1, 0])[0], "monotonic");
  }
  assert.deepEqual(toZone([-3, SIZE + 5]), toZone([0, SIZE - 1]), "clamped");
});

test("worms join up to the cap, each placed whole inside the plot", () => {
  const g = newPlot();
  for (let i = 0; i < MAX_WORMS; i++) assert.ok(addWorm(g, String(i), `w${i}`));
  assert.equal(addWorm(g, "late", "late"), undefined);
  const cells = new Set();
  for (const w of g.worms) {
    assert.equal(w.body.length, START_LEN);
    for (const [x, y] of w.body) {
      assert.ok(x >= 0 && y >= 0 && x < SIZE && y < SIZE);
      assert.ok(!cells.has(`${x},${y}`), "no overlap");
      cells.add(`${x},${y}`);
    }
  }
});

test("a worm turns but never folds back on its neck", () => {
  const [w] = plot([[[5, 5], [4, 5], [3, 5], [2, 5]], "right"]).worms;
  assert.equal(steer(w, "left"), false);
  assert.equal(steer(w, "sideways"), false);
  assert.equal(steer(w, "constructor"), false);
  assert.equal(steer(w, "up"), true);
  assert.equal(w.next, "up");
});

test("moving onto dew grows the worm by one", () => {
  const g = plot([[[5, 5], [4, 5], [3, 5], [2, 5]], "right"]);
  g.dew.push([6, 5]);
  step(g);
  assert.deepEqual(g.worms[0].body.slice(0, 2), [[6, 5], [5, 5]]);
  assert.equal(g.worms[0].body.length, 5);
  step(g);
  assert.equal(g.worms[0].body.length, 5, "one dew, one cell");
  assert.equal(g.dew.length, DEW, "dew is topped up");
});

test("a wall curls a worm: it sheds half its length as dew and rests", () => {
  const body = Array.from({ length: 10 }, (_, i) => [SIZE - 1 - i, 0]);
  const g = plot([body, "right"]);
  const curled = step(g);
  const w = g.worms[0];
  assert.deepEqual(curled, [w]);
  assert.equal(w.body.length, 5);
  assert.deepEqual(w.body[0], [SIZE - 1, 0], "the head stays put");
  for (const c of body.slice(5)) assert.ok(g.dew.some((d) => d[0] === c[0] && d[1] === c[1]), "shed cells become dew");
  assert.equal(w.stunned, STUN_TICKS);
  assert.equal(w.dir, "down", "it faces the first free way out");
  for (let i = 0; i < STUN_TICKS; i++) step(g);
  assert.deepEqual(w.body[0], [SIZE - 1, 0], "still while stunned");
  step(g);
  assert.deepEqual(w.body[0], [SIZE - 1, 1]);
});

test("a short worm never shrinks below its starting length", () => {
  const g = plot([[[0, 5], [1, 5], [2, 5], [3, 5]], "left"]);
  step(g);
  assert.equal(g.worms[0].body.length, START_LEN);
});

test("running into another worm, or head to head, curls the one that ran in", () => {
  const g = plot([[[5, 5], [4, 5], [3, 5], [2, 5]], "right"], [[[6, 8], [6, 7], [6, 6], [6, 5]], "down"]);
  g.worms[1].body = [[6, 3], [6, 4], [6, 5], [6, 6]];
  g.worms[1].dir = g.worms[1].next = "up";
  assert.deepEqual(step(g), [g.worms[0]], "A hits B's body, B moves on");

  const h = plot([[[5, 5], [4, 5], [3, 5], [2, 5]], "right"], [[[7, 5], [8, 5], [9, 5], [10, 5]], "left"]);
  assert.equal(step(h).length, 2, "both heads aimed at the same cell");
});

test("standings rank by length, then by best; the view tells each frame which worm is theirs", () => {
  const g = plot([[[5, 5], [4, 5], [3, 5], [2, 5]], "right"], [[[5, 9], [4, 9], [3, 9], [2, 9], [1, 9]], "right"]);
  g.worms[0].best = 9;
  assert.deepEqual(standings(g).map((s) => s.name), ["w1", "w0"]);
  g.worms[1].body.pop();
  assert.deepEqual(standings(g).map((s) => s.name), ["w0", "w1"]);
  Object.assign(g, { phase: "lobby", minutes: 3 });
  fillDew(g);
  assert.equal(view(g, B).you, 1);
  assert.equal(view(g, "cc".repeat(32)).you, -1);
  assert.equal(view(g, A).left_ms, 180_000);
});
