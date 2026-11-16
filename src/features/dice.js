import { randomInt } from "node:crypto";

export const MAX_DICE = 100;
export const MAX_SIDES = 1000;

/** "2d6", "d20", "10D100" -> { count, sides }; anything else, or past the caps, -> null. */
export function parseDice(text) {
  const m = /^\s*(\d{0,4})d(\d{1,5})\s*$/i.exec(text ?? "");
  if (!m) return null;
  const count = m[1] === "" ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) return null;
  return { count, sides };
}

export function rollDice({ count, sides }, roll = (n) => randomInt(1, n + 1)) {
  return Array.from({ length: count }, () => roll(sides));
}

const who = (inv) => inv.author.display_name ?? "You";

export default {
  commands: [
    { name: "roll", description: "Roll dice, e.g. /roll 2d6", args: "<NdM>" },
    { name: "coin", description: "Flip a coin" },
  ],
  slash: {
    roll(inv) {
      const dice = parseDice(inv.args_raw || "1d6");
      if (!dice) {
        return {
          reply: { body: `Try /roll 2d6: up to ${MAX_DICE} dice with 2 to ${MAX_SIDES} sides.` },
          ephemeral: true,
        };
      }
      const rolls = rollDice(dice);
      const total = rolls.reduce((a, b) => a + b, 0);
      const shown = rolls.length > 1 ? `${rolls.join(" + ")} = **${total}**` : `**${total}**`;
      return { reply: { body: `${who(inv)} rolled ${dice.count}d${dice.sides}: ${shown}` } };
    },
    coin(inv) {
      return { reply: { body: `${who(inv)} flipped a coin: **${randomInt(2) ? "heads" : "tails"}**` } };
    },
  },
};
