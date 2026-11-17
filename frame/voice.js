// The client's host bridge (Wavvon-docs mini-app-bridge.md): a frame may set
// its own user's place in the proximity voice zone of the mini-app's channel.
// Listening starts at import, before the context arrives, because the client
// sends voiceState right after it.
const REASONS = {
  not_in_voice: "join this channel's voice to hear the other worms by distance",
  no_zone: "this channel's room map is off; someone who can manage channels turns it on in the voice panel",
  ambiguous_zone: "this channel has more than one voice zone",
  bad_position: "the client did not accept the worm's position",
};

let state; // the last wavvon:voiceState, undefined on a client without the bridge
let refusal;
let last;
const listeners = new Set();

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m?.type === "wavvon:voiceState") {
    state = m;
    refusal = undefined;
    last = undefined;
  } else if (m?.type === "wavvon:voicePositionRefused") {
    refusal = m.reason;
  } else return;
  for (const fn of listeners) fn();
});

const zone = () => state?.zones?.find((z) => z.coordinate_system === "2d");

/** One sentence on whether the worm moves its player's voice, and why not. */
export function voiceStatus() {
  if (!state) return "Proximity voice is off: this Wavvon client cannot move you in voice. The game plays the same.";
  if (refusal) return `Proximity voice is off: ${REASONS[refusal] ?? refusal}.`;
  if (!state.in_voice) return `Proximity voice is off: ${REASONS.not_in_voice}.`;
  if (!zone()) return `Proximity voice is off: ${REASONS.no_zone}.`;
  return "Proximity voice is on: worms far from yours sound quieter.";
}

export const onVoiceChange = (fn) => listeners.add(fn);

/** Asks the client to stand its user at `position` (0..100 each axis). Repeats are dropped. */
export function setVoicePosition(position) {
  const z = zone();
  if (!state?.in_voice || !z) return false;
  if (last && last[0] === position[0] && last[1] === position[1]) return false;
  last = position;
  window.parent.postMessage({ type: "wavvon:setVoicePosition", v: 1, position, zone_id: z.zone_id }, "*");
  return true;
}
