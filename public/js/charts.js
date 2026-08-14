"use strict";

(function (global) {
  const UP = "#3dff9a";
  const DOWN = "#ff5d6c";
  const GRID = "rgba(139,151,179,0.18)";
  const MUTED = "#8b97b3";

  function drawChart(priceCanvas, volumeCanvas, bars, opts) {
    const options = opts || {};
    const type = options.type === "line" ? "line" : "candle";
    const hoverIndex = Number.isInteger(options.hoverIndex) ? options.hoverIndex : -1;
    if (!priceCanvas || !volumeCanvas) return;
    const rows = Array.isArray(bars) ? bars.filter((b) => b && isFinite(b.c)) : [];
    paint(priceCanvas, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      if (!rows.length) {
        ctx.fillStyle = MUTED;
        ctx.font = "13px system-ui";
        ctx.fillText("No chart data", 12, h / 2);
        return;
      }
      const highs = rows.map((b) => num(b.h, b.c));
      const lows = rows.map((b) => num(b.l, b.c));
      const min = Math.min(...lows);
      const max = Math.max(...highs);
      const pad = (max - min) * 0.08 || max * 0.01 || 1;
      const yMin = min - pad;
      const yMax = max + pad;
      drawGrid(ctx, w, h);
      const y = (v) => h - ((v - yMin) / (yMax - yMin)) * h;
      const x = (i) => ((i + 0.5) / rows.length) * w;
      const slot = w / rows.length;

      if (type === "line") {
        ctx.beginPath();
        rows.forEach((b, i) => {
          const px = x(i);
          const py = y(b.c);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = UP;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        rows.forEach((b, i) => {
          const cx = x(i);
          const up = b.c >= b.o;
          ctx.strokeStyle = up ? UP : DOWN;
          ctx.fillStyle = up ? UP : DOWN;
          ctx.beginPath();
          ctx.moveTo(cx, y(num(b.h, b.c)));
          ctx.lineTo(cx, y(num(b.l, b.c)));
          ctx.stroke();
          const bodyTop = y(Math.max(b.o, b.c));
          const bodyBot = y(Math.min(b.o, b.c));
          const bw = Math.max(2, slot * 0.62);
          ctx.fillRect(cx - bw / 2, bodyTop, bw, Math.max(1, bodyBot - bodyTop));
        });
      }

      if (hoverIndex >= 0 && hoverIndex < rows.length) {
        const cx = x(hoverIndex);
        ctx.strokeStyle = "rgba(232,238,252,0.35)";
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
        const py = y(rows[hoverIndex].c);
        ctx.fillStyle = "#e8eefc";
        ctx.beginPath();
        ctx.arc(cx, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    paint(volumeCanvas, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      if (!rows.length) return;
      const vols = rows.map((b) => num(b.v, 0));
      const vmax = Math.max(...vols, 1);
      const slot = w / rows.length;
      rows.forEach((b, i) => {
        const up = b.c >= b.o;
        ctx.fillStyle = up ? "rgba(61,255,154,0.55)" : "rgba(255,93,108,0.55)";
        const bh = (num(b.v, 0) / vmax) * (h - 2);
        const x = i * slot + slot * 0.15;
        ctx.fillRect(x, h - bh, Math.max(1, slot * 0.7), bh);
      });
      if (hoverIndex >= 0 && hoverIndex < rows.length) {
        const cx = ((hoverIndex + 0.5) / rows.length) * w;
        ctx.strokeStyle = "rgba(232,238,252,0.35)";
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
      }
    });
  }

  function bindHover(priceCanvas, bars, onIndex) {
    const handler = (ev) => {
      const rows = bars || [];
      if (!rows.length) return;
      const rect = priceCanvas.getBoundingClientRect();
      const point = ev.touches ? ev.touches[0] : ev;
      const x = point.clientX - rect.left;
      const idx = Math.max(0, Math.min(rows.length - 1, Math.floor((x / rect.width) * rows.length)));
      onIndex(idx, rows[idx]);
    };
    priceCanvas.onpointerdown = handler;
    priceCanvas.onpointermove = handler;
    priceCanvas.ontouchstart = handler;
    priceCanvas.ontouchmove = handler;
  }

  function paint(canvas, fn) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 180;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    fn(ctx, w, h);
  }

  function drawGrid(ctx, w, h) {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  global.VoltScanCharts = { drawChart, bindHover };
})(window);
