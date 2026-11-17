// Shared by the bot (src/features/loam.js) and the frame.
export const SIZE = 40;
export const TICK_MS = 150;
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * A cell of the SIZE x SIZE plot -> a point in the room map's 0..100 zone,
 * the centre of the cell, so the plot's corners sit just inside the zone.
 */
export function toZone([x, y]) {
  const scale = (v) => Math.round(((Math.min(Math.max(v, 0), SIZE - 1) + 0.5) / SIZE) * 10_000) / 100;
  return [scale(x), scale(y)];
}
