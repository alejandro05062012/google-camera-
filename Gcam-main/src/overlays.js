const SVG_NS = 'http://www.w3.org/2000/svg';

const GRID_LINES = {
  off: [],
  thirds: [
    [33.33, 0, 33.33, 100],
    [66.67, 0, 66.67, 100],
    [0, 33.33, 100, 33.33],
    [0, 66.67, 100, 66.67],
  ],
  golden: [
    [38.2, 0, 38.2, 100],
    [61.8, 0, 61.8, 100],
    [0, 38.2, 100, 38.2],
    [0, 61.8, 100, 61.8],
  ],
  diagonal: [
    [0, 0, 100, 100],
    [100, 0, 0, 100],
  ],
  cross: [
    [50, 0, 50, 100],
    [0, 50, 100, 50],
  ],
};

export function renderGrid(svg, kind) {
  if (svg.dataset.kind === kind) return;
  svg.dataset.kind = kind;
  svg.replaceChildren(
    ...(GRID_LINES[kind] ?? []).map(([x1, y1, x2, y2]) => {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      return line;
    })
  );
}

const CHANNEL_COLORS = {
  r: 'rgba(255, 92, 92, 0.75)',
  g: 'rgba(96, 230, 140, 0.75)',
  b: 'rgba(110, 170, 255, 0.75)',
  l: 'rgba(245, 245, 245, 0.8)',
};

function traceChannel(ctx, bins, peak, w, h) {
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < 256; i++) {
    const v = Math.sqrt(bins[i] / peak);
    ctx.lineTo((i / 255) * w, h - v * (h - 2));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

export function drawHistogram(canvas, hist, channels) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const peak = Math.max(1, ...channels.flatMap((key) => hist[key]));
  ctx.globalCompositeOperation = 'lighter';
  for (const key of channels) {
    ctx.fillStyle = CHANNEL_COLORS[key];
    traceChannel(ctx, hist[key], peak, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function drawPip(canvas, source, layout) {
  const ctx = canvas.getContext('2d');
  const { width: pw, height: ph } = canvas;
  ctx.clearRect(0, 0, pw, ph);
  ctx.drawImage(source.el, 0, 0, pw, ph);
  const sx = (layout.sx / source.width) * pw;
  const sy = (layout.sy / source.height) * ph;
  const sw = (layout.sw / source.width) * pw;
  const sh = (layout.sh / source.height) * ph;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, pw, ph);
  ctx.drawImage(source.el, layout.sx, layout.sy, layout.sw, layout.sh, sx, sy, sw, sh);
  ctx.strokeStyle = '#e8b923';
  ctx.lineWidth = 2;
  ctx.strokeRect(sx, sy, sw, sh);
}

export function setLevel(levelEl, roll) {
  const clamped = Math.max(-45, Math.min(45, roll));
  levelEl.querySelector('.level-line').style.transform = `rotate(${-clamped}deg)`;
  levelEl.classList.toggle('is-level', Math.abs(roll) < 1);
}
