// The rules of Cairn that decide a score, shared by the page (to play) and
// the bot (to judge whether a submitted score could have been played).

export const WIDTH = 9;
export const HEIGHT = 16;
export const ROWS_PER_DEPTH = 8;
// Points for rows cleared by one stone. No stone is taller than three cells.
const BASE = [0, 10, 30, 60];

/** The ravine deepens (and stones fall faster) every ROWS_PER_DEPTH rows. */
export const depthFor = (lines) => 1 + Math.floor(lines / ROWS_PER_DEPTH);

export const fallMs = (depth) => Math.max(90, Math.round(750 * 0.85 ** (depth - 1)));

/** Points for `rows` rows cleared at once, `gemRows` of them holding a gem, after `linesBefore` rows. */
export function clearPoints(rows, gemRows, linesBefore) {
  const base = BASE[rows] ?? 0;
  if (!base) return 0;
  return (base + (base / rows) * gemRows) * depthFor(linesBefore);
}

/** The most points `lines` rows can be worth: every row cleared three at a time, every row a gem row. */
export function maxScore(lines) {
  let total = 0;
  for (let k = 0; k < lines; k++) total += (BASE[3] / 3) * 2 * depthFor(k);
  return total;
}
