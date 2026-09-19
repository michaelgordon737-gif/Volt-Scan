"use strict";

const list = document.getElementById("list");
const nowbox = document.getElementById("nowbox");
let state = null;

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

function matchLine(m) {
  if (m.winner === "a") return `${m.labelA} beat ${m.labelB}`;
  if (m.winner === "b") return `${m.labelB} beat ${m.labelA}`;
  return `${m.labelA} vs ${m.labelB}`;
}

function status(m) {
  if (m.winner) return "Done";
  if (m.now) return "Up now";
  if (state.schedule.onDeck && m.id === state.schedule.onDeck.id) return "Next";
  return "";
}

function render() {
  if (!state || !state.schedule) return;
  const sched = state.schedule;
  const games = [...sched.matches].sort((a, b) => a.order - b.order);
  if (sched.champion) {
    nowbox.innerHTML = `${sched.champion} wins tonight.<small>Bracket is done.</small>`;
  } else if (sched.now) {
    nowbox.innerHTML = `Up now · ${sched.now.labelA} vs ${sched.now.labelB}<small>${sched.onDeck ? `Next · ${sched.onDeck.labelA} vs ${sched.onDeck.labelB}` : ""}</small>`;
  } else {
    nowbox.textContent = "Waiting on an earlier match.";
  }
  list.innerHTML = games.map((m) => `
    <li class="game ${m.now ? "now" : ""} ${m.winner ? "done" : ""}">
      <span class="num">${m.order}</span>
      <span class="round">${m.round}</span>
      <span class="names ${m.winner ? "win" : ""}">${matchLine(m)}</span>
      <span class="mark">${status(m)}</span>
    </li>
  `).join("");
}

async function refresh() {
  state = await api("/api/cornhole");
  render();
}

refresh().catch((err) => { nowbox.textContent = err.message; });
setInterval(() => refresh().catch(() => {}), 2500);
