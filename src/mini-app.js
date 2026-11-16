/**
 * The bot's side of the mini-app sessions on one hub. A hub opens the same
 * mini_app_url for every launch card an app announces, so the frame cannot
 * tell which game it is showing until it asks: there is at most one session
 * per channel, and the frame learns its game from the bot's first answer.
 *
 * A session is { game, state }: `game` names the feature that handles its
 * frames' messages (router `games`), `state` is that feature's own.
 */
export function createMiniApp(stream, appId) {
  const sessions = new Map();
  return {
    get: (channelId) => sessions.get(channelId),
    /** Shows a launch card in the channel. Throws if the socket is not open. */
    launch(channelId, game, state, title, description) {
      stream.announceApp(channelId, title, description);
      sessions.set(channelId, { game, state });
    },
    /** Forgets the session and closes every frame open on it. */
    end(channelId) {
      sessions.delete(channelId);
      if (stream.state === "open") stream.dismissApp(channelId);
    },
    /** Sends `data` to the frames of one player; dropped while the socket is down. */
    send(channelId, toPubkey, data) {
      if (stream.state !== "open") return;
      stream.sendMiniAppMessage(appId, channelId, toPubkey, JSON.stringify(data));
    },
  };
}
