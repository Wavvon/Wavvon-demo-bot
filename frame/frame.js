// Runs inside the Wavvon client: an iframe on web (context arrives by
// postMessage), a webview window on desktop (context injected as globals).
// Talks only to the hub's /ws with the scoped token, and only to this bot.
import cairn from "./cairn.js";
import tictactoe from "./tictactoe.js";

const views = { cairn, tictactoe };
const gameRoot = document.getElementById("game");
const status = document.getElementById("status");

function context() {
  if (window.__WAVVON_TOKEN__) {
    return Promise.resolve({
      hub: window.__WAVVON_HUB__,
      token: window.__WAVVON_TOKEN__,
      channel: window.__WAVVON_CHANNEL__,
      app: window.__WAVVON_APP_ID__ ?? window.__WAVVON_BOT_ID__,
    });
  }
  return new Promise((resolve) => {
    window.addEventListener("message", function onMessage(e) {
      if (e.source !== window.parent || e.data?.type !== "wavvon_context") return;
      window.removeEventListener("message", onMessage);
      resolve({ hub: e.data.hub_url, token: e.data.token, channel: e.data.channel_id, app: e.data.app_id });
    });
  });
}

const ctx = await context();
let ws;
let current;

function send(data) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "mini_app_message", app_id: ctx.app, channel_id: ctx.channel, payload: JSON.stringify(data) }));
}

function onFrame(raw) {
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  if (m.type === "hello") {
    status.textContent = "";
    return send({ t: "hello" });
  }
  if (m.type !== "mini_app_message" || m.app_id !== ctx.app || m.channel_id !== ctx.channel) return;
  let data;
  try {
    data = JSON.parse(m.payload);
  } catch {
    return;
  }
  if (data.t === "ended") {
    gameRoot.replaceChildren();
    current = undefined;
    status.textContent = "This game has ended.";
    return;
  }
  const mount = views[data.game];
  if (!mount) return;
  if (current?.game !== data.game) {
    gameRoot.replaceChildren();
    current = { game: data.game, update: mount(gameRoot, send) };
  }
  current.update(data);
}

function connect() {
  const url = new URL(`${ctx.hub.replace(/\/+$/, "")}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", ctx.token);
  ws = new WebSocket(url);
  ws.onmessage = (e) => onFrame(e.data);
  ws.onclose = () => {
    status.textContent = "Connection lost. Reconnecting…";
    setTimeout(connect, 3000);
  };
}

connect();
