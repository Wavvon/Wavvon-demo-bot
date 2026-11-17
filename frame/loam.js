import { SIZE, toZone } from "./loam-rules.js";
import { onVoiceChange, setVoicePosition, voiceStatus } from "./voice.js";

const CELL = 14;
const COLORS = ["#d9785b", "#7fae5a", "#c9a23f", "#6f9fc9", "#b679b8", "#4fa79a", "#d6869f", "#9a8f6e"];
const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };

const clock = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const where = ([x, y]) =>
  `${y < SIZE / 3 ? "top" : y < (2 * SIZE) / 3 ? "middle" : "bottom"} ${x < SIZE / 3 ? "left" : x < (2 * SIZE) / 3 ? "centre" : "right"}`.replace("middle centre", "centre");

/** Builds the plot in `root`; returns the function that takes the bot's messages. */
export default function mount(root, send) {
  root.innerHTML = `
    <h1>Loam</h1>
    <div class="loam">
      <canvas class="plot" width="${SIZE * CELL}" height="${SIZE * CELL}" tabindex="0" role="img" aria-label="The garden plot"></canvas>
      <div class="side">
        <dl class="stats">
          <dt>Time</dt><dd data-stat="time">–</dd>
          <dt>You</dt><dd data-stat="len">–</dd>
        </dl>
        <ol class="worms" aria-label="Worms, longest first"></ol>
        <button type="button" class="start">Start round</button>
      </div>
    </div>
    <div class="pad" role="group" aria-label="Steer">
      <button type="button" data-dir="left" aria-label="Steer left">◀</button>
      <button type="button" data-dir="up" aria-label="Steer up">▲</button>
      <button type="button" data-dir="down" aria-label="Steer down">▼</button>
      <button type="button" data-dir="right" aria-label="Steer right">▶</button>
    </div>
    <p class="news" aria-live="polite"></p>
    <p class="voice" role="status"></p>
    <p class="help">Arrows or WASD steer, Enter starts. Gather dew to grow; touch a wall or a worm and you curl up, dropping half your length as dew. Longest worm at the bell wins.</p>`;

  const g = root.querySelector(".plot").getContext("2d");
  const plot = root.querySelector(".plot");
  const list = root.querySelector(".worms");
  const startButton = root.querySelector(".start");
  const news = root.querySelector(".news");
  const voice = root.querySelector(".voice");
  const stat = (name, value) => (root.querySelector(`[data-stat="${name}"]`).textContent = value);

  let s;
  let lastLen;
  let lastPhase;

  const showVoice = () => (voice.textContent = voiceStatus());
  onVoiceChange(showVoice);
  showVoice();

  const steer = (dir) => s?.you >= 0 && send({ t: "steer", dir });
  const start = () => send({ t: "start" });
  startButton.addEventListener("click", start);
  for (const b of root.querySelectorAll("[data-dir]")) b.addEventListener("click", () => steer(b.dataset.dir));
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = KEYS[e.key] ?? KEYS[e.key.toLowerCase?.()];
    if (dir) {
      e.preventDefault();
      steer(dir);
    } else if (e.key === "Enter" && e.target.tagName !== "BUTTON" && !startButton.hidden) start();
  });
  plot.focus();

  function draw() {
    g.fillStyle = "#3b2f25";
    g.fillRect(0, 0, SIZE * CELL, SIZE * CELL);
    g.fillStyle = "#43362a";
    for (let y = 0; y < SIZE; y++) for (let x = (y % 2); x < SIZE; x += 2) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    g.fillStyle = "#a9d8f0";
    for (const [x, y] of s.dew) {
      g.beginPath();
      g.arc(x * CELL + CELL / 2, y * CELL + CELL / 2 + 1, CELL / 4, 0, Math.PI * 2);
      g.moveTo(x * CELL + CELL / 2 - CELL / 4, y * CELL + CELL / 2);
      g.lineTo(x * CELL + CELL / 2, y * CELL + 2);
      g.lineTo(x * CELL + CELL / 2 + CELL / 4, y * CELL + CELL / 2);
      g.fill();
    }
    s.worms.forEach((w, i) => {
      g.globalAlpha = w.stunned ? 0.45 : 1;
      g.fillStyle = COLORS[w.seat % COLORS.length];
      w.body.forEach(([x, y], j) => {
        const r = j === 0 ? CELL / 2 : CELL / 2 - 1.5;
        g.beginPath();
        g.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, r, 0, Math.PI * 2);
        g.fill();
      });
      const [hx, hy] = w.body[0];
      if (i === s.you) {
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(hx * CELL + CELL / 2, hy * CELL + CELL / 2, CELL / 2, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = "#1b140f";
      g.fillRect(hx * CELL + CELL / 2 - 3, hy * CELL + CELL / 2 - 2, 2, 2);
      g.fillRect(hx * CELL + CELL / 2 + 1, hy * CELL + CELL / 2 - 2, 2, 2);
    });
    g.globalAlpha = 1;
  }

  return (msg) => {
    s = msg;
    const me = s.worms[s.you];
    draw();
    stat("time", s.phase === "countdown" ? `starts in ${Math.ceil(s.starts_in_ms / 1000)}` : clock(s.left_ms));
    stat("len", me ? `${me.body.length} long` : "watching");
    const rows = s.standings ?? [...s.worms].sort((a, b) => b.body.length - a.body.length).map((w) => ({ name: w.name, length: w.body.length }));
    list.replaceChildren(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.textContent = `${r.name}: ${r.length}`;
        return li;
      }),
    );
    startButton.hidden = !me || s.phase === "countdown" || s.phase === "running";
    startButton.textContent = s.phase === "over" ? "Play again" : "Start round";
    plot.setAttribute(
      "aria-label",
      me ? `The garden plot. Your worm is ${me.body.length} long, near the ${where(me.body[0])}.` : "The garden plot.",
    );

    if (s.phase !== lastPhase) {
      if (s.phase === "lobby") news.textContent = me ? "Press Start round, or Enter, when everyone is here." : "The plot is full: you are watching.";
      if (s.phase === "countdown") news.textContent = "Get ready…";
      if (s.phase === "running") news.textContent = "Go! Gather the dew.";
      if (s.phase === "over") {
        const place = me ? s.standings.findIndex((r) => r.seat === me.seat) + 1 : 0;
        news.textContent = `Round over. ${s.standings[0]?.name ?? "Nobody"} wins${place ? `; you came ${place} of ${s.standings.length}` : ""}.`;
      }
    } else if (me && s.phase === "running" && lastLen !== undefined && me.body.length < lastLen) {
      news.textContent = `You curled up: ${me.body.length} long now.`;
    }
    lastPhase = s.phase;
    lastLen = me?.body.length;

    if (me) setVoicePosition(toZone(me.body[0]));
  };
}
