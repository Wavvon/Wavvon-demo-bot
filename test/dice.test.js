import assert from "node:assert/strict";
import { test } from "node:test";
import dice, { MAX_DICE, MAX_SIDES, parseDice, rollDice } from "../src/features/dice.js";

test("parses NdM, dM and either case", () => {
  assert.deepEqual(parseDice("2d6"), { count: 2, sides: 6 });
  assert.deepEqual(parseDice(" d20 "), { count: 1, sides: 20 });
  assert.deepEqual(parseDice("10D100"), { count: 10, sides: 100 });
});

test("refuses junk and anything past the caps", () => {
  for (const bad of ["", "2", "d", "2d", "x2d6", "2d6+1", "-1d6", "0d6", "2d1", "2d0", "1.5d6", "2 d6"]) {
    assert.equal(parseDice(bad), null, bad);
  }
  assert.equal(parseDice(`${MAX_DICE + 1}d6`), null);
  assert.equal(parseDice(`1d${MAX_SIDES + 1}`), null);
  assert.equal(parseDice("99999999d6"), null);
  assert.deepEqual(parseDice(`${MAX_DICE}d${MAX_SIDES}`), { count: MAX_DICE, sides: MAX_SIDES });
});

test("rolls stay within 1..sides", () => {
  const rolls = rollDice({ count: MAX_DICE, sides: 6 });
  assert.equal(rolls.length, MAX_DICE);
  assert.ok(rolls.every((r) => Number.isInteger(r) && r >= 1 && r <= 6));
});

test("/roll answers in the channel, a bad spec only to the invoker", () => {
  const author = { pubkey: "ab", display_name: "Ada" };
  const ok = dice.slash.roll({ args_raw: "3d1000", author });
  assert.match(ok.reply.body, /^Ada rolled 3d1000: \d+ \+ \d+ \+ \d+ = \*\*\d+\*\*$/);
  assert.ok(!ok.ephemeral);
  const bad = dice.slash.roll({ args_raw: "1000d6", author });
  assert.equal(bad.ephemeral, true);
});
