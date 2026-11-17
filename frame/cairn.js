import { HEIGHT, ROWS_PER_DEPTH, WIDTH, clearPoints, depthFor, fallMs } from "./cairn-rules.js";

// Six stones of one to five cells, [x, y] each.
const STONES = [
  { name: "pebble", color: "#9c968c", cells: [[0, 0]] },
  { name: "twig", color: "#7f9150", cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "knee", color: "#b9774a", cells: [[0, 0], [0, 1], [1, 1]] },
  { name: "slab", color: "#6f7f8f", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: "hook", color: "#b39462", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: "arch", color: "#5d8a84", cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
];
const GEM_CHANCE = 0.2;
const CELL = 26;
const TICK_MS = 60_000;

function normalise(cells) {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

// Clockwise; the cell order is kept, so a gem stays on its cell.
const rotate = (cells) => normalise(cells.map(([x, y]) => [-y, x]));

/** Builds the game in `root`; returns the function that takes the bot's messages. */
export default function mount(root, send) {
  root.innerHTML = `
    <h1>Cairn</h1>
    <div class="cairn">
      <canvas class="ravine" width="${WIDTH * CELL}" height="${HEIGHT * CELL}" tabindex="0" role="img" aria-label="The ravine. Play with the keyboard while it has focus, or with the buttons below."></canvas>
      <div class="side">
        <dl class="stats">
          <dt>Score</dt><dd data-stat="score">0</dd>
          <dt>Rows</dt><dd data-stat="lines">0</dd>
          <dt>Depth</dt><dd data-stat="depth">1</dd>
          <dt>Your best</dt><dd data-stat="best">–</dd>
        </dl>
        <p class="next-label">Next</p>
        <canvas class="next" width="${4 * CELL}" height="${3 * CELL}" role="img" aria-label="Next stone"></canvas>
        <button type="button" class="start">Start</button>
      </div>
    </div>
    <div class="pad" role="group" aria-label="Controls">
      <button type="button" data-act="left" aria-label="Move left">◀</button>
      <button type="button" data-act="turn" aria-label="Turn">⟳</button>
      <button type="button" data-act="right" aria-label="Move right">▶</button>
      <button type="button" data-act="down" aria-label="Move down">▼</button>
      <button type="button" data-act="drop" aria-label="Drop">⤓</button>
    </div>
    <p class="news" aria-live="polite">Press Enter or Start to play.</p>
    <p class="help">Arrows move, Up or X turns, Space drops, P pauses. A row holding a gem scores double; every ${ROWS_PER_DEPTH} rows the ravine deepens and stones fall faster.</p>`;

  const ravine = root.querySelector(".ravine").getContext("2d");
  const preview = root.querySelector(".next").getContext("2d");
  const startButton = root.querySelector(".start");
  const ravineEl = root.querySelector(".ravine");
  const news = root.querySelector(".news");
  const stat = (name, value) => (root.querySelector(`[data-stat="${name}"]`).textContent = value);

  let board, stone, next, bag, score, lines, playing, paused, over, lastFall, ticker;

  function draw() {
    const g = ravine;
    const sky = g.createLinearGradient(0, 0, 0, HEIGHT * CELL);
    sky.addColorStop(0, "#1c2420");
    sky.addColorStop(1, "#2f3a33");
    g.fillStyle = sky;
    g.fillRect(0, 0, WIDTH * CELL, HEIGHT * CELL);
    g.strokeStyle = "rgba(255,255,255,0.04)";
    for (let x = 1; x < WIDTH; x++) {
      g.beginPath();
      g.moveTo(x * CELL + 0.5, 0);
      g.lineTo(x * CELL + 0.5, HEIGHT * CELL);
      g.stroke();
    }
    board?.forEach((row, y) => row.forEach((c, x) => c && paintCell(g, x, y, c.color, c.gem)));
    if (stone && !over) {
      let ghostY = stone.y;
      while (fits(stone.cells, stone.x, ghostY + 1)) ghostY++;
      g.strokeStyle = "rgba(255,255,255,0.25)";
      for (const [cx, cy] of stone.cells) g.strokeRect((stone.x + cx) * CELL + 3.5, (ghostY + cy) * CELL + 3.5, CELL - 7, CELL - 7);
      stone.cells.forEach(([cx, cy], i) => paintCell(g, stone.x + cx, stone.y + cy, stone.color, i === stone.gem));
    }
    preview.clearRect(0, 0, 4 * CELL, 3 * CELL);
    if (next) next.cells.forEach(([cx, cy], i) => paintCell(preview, cx + 0.5, cy + 0.5, next.color, i === next.gem));
  }

  function paintCell(g, x, y, color, gem) {
    const px = x * CELL;
    const py = y * CELL;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(px + 1.5, py + 1.5, CELL - 3, CELL - 3, 7);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.ellipse(px + CELL * 0.38, py + CELL * 0.32, CELL * 0.22, CELL * 0.12, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(px + 4, py + CELL - 5, CELL - 8, 2);
    if (gem) {
      const cx = px + CELL / 2;
      const cy = py + CELL / 2;
      g.fillStyle = "#ffd36b";
      g.beginPath();
      g.moveTo(cx, cy - 6);
      g.lineTo(cx + 5, cy);
      g.lineTo(cx, cy + 6);
      g.lineTo(cx - 5, cy);
      g.closePath();
      g.fill();
    }
  }

  function takeStone() {
    if (!bag?.length) {
      bag = STONES.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    const kind = bag.pop();
    return { ...kind, gem: Math.random() < GEM_CHANCE ? Math.floor(Math.random() * kind.cells.length) : -1 };
  }

  function fits(cells, x, y) {
    return cells.every(([cx, cy]) => {
      const bx = x + cx;
      const by = y + cy;
      return bx >= 0 && bx < WIDTH && by < HEIGHT && (by < 0 || !board[by][bx]);
    });
  }

  function spawn() {
    stone = next ?? takeStone();
    next = takeStone();
    const w = Math.max(...stone.cells.map((c) => c[0])) + 1;
    stone.x = Math.floor((WIDTH - w) / 2);
    stone.y = 0;
    if (!fits(stone.cells, stone.x, stone.y)) finish();
  }

  function lock() {
    stone.cells.forEach(([cx, cy], i) => {
      board[stone.y + cy][stone.x + cx] = { color: stone.color, gem: i === stone.gem };
    });
    const full = board.filter((row) => row.every(Boolean));
    if (full.length) {
      const gems = full.filter((row) => row.some((c) => c.gem)).length;
      const points = clearPoints(full.length, gems, lines);
      const deeper = depthFor(lines + full.length) > depthFor(lines);
      score += points;
      lines += full.length;
      board = [...Array.from({ length: full.length }, () => Array(WIDTH).fill(null)), ...board.filter((row) => !row.every(Boolean))];
      news.textContent = `${full.length} ${full.length === 1 ? "row" : "rows"} cleared${gems ? " with a gem" : ""}: +${points}.${deeper ? ` Depth ${depthFor(lines)}.` : ""}`;
      stat("score", score);
      stat("lines", lines);
      stat("depth", depthFor(lines));
    }
    spawn();
  }

  function act(what) {
    if (!playing || paused || over) return;
    if (what === "left" || what === "right") {
      const dx = what === "left" ? -1 : 1;
      if (fits(stone.cells, stone.x + dx, stone.y)) stone.x += dx;
    } else if (what === "turn") {
      const turned = rotate(stone.cells);
      const kick = [0, -1, 1, -2, 2].find((k) => fits(turned, stone.x + k, stone.y));
      if (kick !== undefined) {
        stone.cells = turned;
        stone.x += kick;
      }
    } else if (what === "down") {
      fall();
    } else if (what === "drop") {
      while (fits(stone.cells, stone.x, stone.y + 1)) stone.y++;
      lock();
    }
    draw();
  }

  function fall() {
    lastFall = performance.now();
    if (fits(stone.cells, stone.x, stone.y + 1)) stone.y++;
    else lock();
  }

  function start() {
    board = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(null));
    bag = [];
    next = undefined;
    score = 0;
    lines = 0;
    over = false;
    paused = false;
    playing = true;
    ["score", "lines"].forEach((s) => stat(s, 0));
    stat("depth", 1);
    news.textContent = "Go!";
    startButton.textContent = "Pause";
    spawn();
    ravineEl.focus();
    send({ t: "start" });
    clearInterval(ticker);
    ticker = setInterval(() => send({ t: "tick" }), TICK_MS);
    lastFall = performance.now();
    requestAnimationFrame(loop);
  }

  function finish() {
    over = true;
    playing = false;
    clearInterval(ticker);
    startButton.textContent = "Play again";
    news.textContent = `The cairn reached the top. ${score} points, ${lines} rows. Sending your score…`;
    send({ t: "score", score, lines });
  }

  function togglePause() {
    if (!playing) return;
    paused = !paused;
    startButton.textContent = paused ? "Resume" : "Pause";
    news.textContent = paused ? "Paused." : "Go!";
    lastFall = performance.now();
  }

  function loop(now) {
    if (!playing) return draw();
    if (!paused && now - lastFall >= fallMs(depthFor(lines))) fall();
    draw();
    requestAnimationFrame(loop);
  }

  const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "turn", x: "turn", X: "turn", ArrowDown: "down", " ": "drop" };
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    if (e.key === "Enter" && !onButton && !playing) {
      e.preventDefault();
      return start();
    }
    if (e.key === "p" || e.key === "P") return togglePause();
    const what = KEYS[e.key];
    if (!what || (onButton && e.key === " ")) return;
    e.preventDefault();
    act(what);
  });
  startButton.addEventListener("click", () => (playing ? togglePause() : start()));
  for (const b of root.querySelectorAll("[data-act]")) b.addEventListener("click", () => act(b.dataset.act));

  draw();
  startButton.focus();

  return (msg) => {
    if (msg.best !== undefined) stat("best", msg.best ?? "–");
    if (msg.t !== "result") return;
    news.textContent = msg.accepted
      ? `Score saved: you are number ${msg.rank} on this hub. /leaderboard shows the top 10.`
      : `The bot did not record that score: ${msg.reason}.`;
  };
}
