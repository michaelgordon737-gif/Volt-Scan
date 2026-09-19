"use strict";

const bracket = document.getElementById("bracket");
const nowbox = document.getElementById("nowbox");
const toastEl = document.getElementById("toast");
let state = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 1400);
}

async function api(path, body) {
  const res = await fetch(path, body == null ? { cache: "no-store" } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function sideRow(match, side) {
  const label = side === "a" ? match.labelA : match.labelB;
  const filled = label !== "TBD";
  const won = match.winner === side;
  const cls = ["side", won ? "win" : "", filled ? "" : "tbd"].join(" ");
  const canPick = match.ready && !match.winner;
  return `<button class="${cls}" data-match="${match.id}" data-side="${side}" ${canPick ? "" : "disabled"} type="button">
    <span>${label}</span>${won ? "<span class='tag'>W</span>" : ""}
  </button>`;
}

function render() {
  if (!state || !state.schedule) return;
  const sched = state.schedule;
  if (sched.champion) {
    nowbox.innerHTML = `${sched.champion} wins the backyard.<small>Final is done.</small>`;
  } else if (sched.now) {
    nowbox.innerHTML = `Up now · ${sched.now.labelA} vs ${sched.now.labelB}<small>${sched.onDeck ? `On deck · ${sched.onDeck.labelA} vs ${sched.onDeck.labelB}` : "Tap the winner when the game is over."}</small>`;
  } else {
    nowbox.textContent = "Waiting on an earlier match.";
  }

  const rounds = [
    { name: "Play-in", ids: ["p1"] },
    { name: "Quarterfinals", ids: ["q1", "q2", "q3", "q4"] },
    { name: "Semifinals", ids: ["s1", "s2"] },
    { name: "Final", ids: ["f1"] },
  ];
  const byId = Object.fromEntries(sched.matches.map((m) => [m.id, m]));
  bracket.innerHTML = rounds.map((round) => {
    const cards = round.ids.map((id) => {
      const m = byId[id];
      if (!m) return "";
      return `<article class="match ${m.now ? "now" : ""} ${m.winner ? "done" : ""}">
        ${sideRow(m, "a")}
        ${sideRow(m, "b")}
      </article>`;
    }).join("");
    return `<section class="round"><h2>${round.name}</h2>${cards}</section>`;
  }).join("");
}

async function pickWinner(id, side) {
  const data = await api(`/api/cornhole/matches/${id}/winner`, { side });
  state.schedule = data.schedule;
  render();
  const match = data.schedule.matches.find((m) => m.id === id);
  toast(`${match.winner === "a" ? match.labelA : match.labelB} advance`);
}

async function refresh() {
  state = await api("/api/cornhole");
  render();
}

bracket.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-match][data-side]");
  if (!btn || btn.disabled) return;
  try {
    await pickWinner(btn.dataset.match, btn.dataset.side);
  } catch (err) {
    toast(err.message);
  }
});

refresh().catch((err) => { nowbox.textContent = err.message; });
setInterval(() => refresh().catch(() => {}), 2000);
