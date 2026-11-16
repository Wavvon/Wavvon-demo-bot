const KEYS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };

/** Builds the board in `root`; returns the function that shows each state the bot sends. */
export default function mount(root, send) {
  root.innerHTML = `
    <h1>Tic-tac-toe</h1>
    <p class="players"></p>
    <div class="board" role="group" aria-label="Board" aria-describedby="ttt-help"></div>
    <p class="turn" aria-live="polite"></p>
    <p id="ttt-help" class="help">Arrow keys move between squares, Enter or Space places your mark, or press 1 to 9.</p>`;
  const board = root.querySelector(".board");
  const players = root.querySelector(".players");
  const turn = root.querySelector(".turn");

  const cells = Array.from({ length: 9 }, (_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cell";
    b.addEventListener("click", () => send({ t: "move", cell: i }));
    b.addEventListener("keydown", (e) => {
      const d = KEYS[e.key];
      if (d === undefined) return;
      e.preventDefault();
      const j = i + d;
      const sameRow = Math.abs(d) !== 1 || Math.floor(j / 3) === Math.floor(i / 3);
      if (j >= 0 && j < 9 && sameRow) cells[j].focus();
    });
    board.append(b);
    return b;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key >= "1" && e.key <= "9" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      cells[Number(e.key) - 1].focus();
      send({ t: "move", cell: Number(e.key) - 1 });
    }
  });
  cells[0].focus();

  return (s) => {
    const name = (mark) => s.players[mark];
    s.board.forEach((mark, i) => {
      const c = cells[i];
      c.textContent = mark;
      c.dataset.mark = mark;
      c.setAttribute("aria-label", `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}: ${mark || "empty"}`);
      c.setAttribute("aria-disabled", String(Boolean(mark || s.result || s.you !== s.turn)));
      c.classList.toggle("win", Boolean(s.line?.includes(i)));
    });
    players.textContent = `${name("X")} (X) against ${name("O")} (O). ${s.you ? `You are ${s.you}.` : "You are watching."}`;
    turn.textContent =
      s.error ??
      (s.result === "draw"
        ? "A draw."
        : s.result
          ? `${name(s.result)} wins!`
          : s.you === s.turn
            ? "Your turn."
            : `${name(s.turn)} to play.`);
  };
}
