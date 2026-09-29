// Small SVG charts for the dashboard. Colors come from CSS tokens (light/dark aware).
// Every chart has a tap/hover tooltip and a table twin.
import { fmt, monthLabel } from './engine.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const k of kids) if (k) el.append(k);
  return el;
}
function txt(x, y, str, attrs = {}) { const t = s('text', { x, y, ...attrs }); t.textContent = str; return t; }

/** Rounded data-end bar (4px radius at the far end, square at the baseline). */
function barPath(x0, x1, y, h, r = 4) {
  const w = x1 - x0;
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`;
}
function colPath(x, w, yBase, yTop, r = 4) { // vertical, rounded at the data end (top if up, bottom if down)
  const h = Math.abs(yBase - yTop);
  if (h < 0.5) return '';
  const rr = Math.min(r, w / 2, h);
  if (yTop < yBase) return `M${x},${yBase}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop + rr}V${yBase}Z`;
  return `M${x},${yBase}V${yTop - rr}Q${x},${yTop} ${x + rr},${yTop}H${x + w - rr}Q${x + w},${yTop} ${x + w},${yTop - rr}V${yBase}Z`;
}

function niceStep(range, ticks = 4) {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
const compact = (cents) => {
  const v = cents / 100, a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1000) return `${sign}€${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `${sign}€${Math.round(a)}`;
};

function wrap(title, svg, table, legend) {
  const box = document.createElement('figure');
  box.className = 'chart';
  const head = document.createElement('figcaption');
  const h = document.createElement('h3'); h.textContent = title; head.append(h);
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'link small'; toggle.textContent = 'Table';
  head.append(toggle);
  box.append(head);
  if (legend) box.append(legend);
  const plot = document.createElement('div'); plot.className = 'plot'; plot.append(svg);
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; plot.append(tip);
  box.append(plot);
  table.hidden = true; box.append(table);
  toggle.addEventListener('click', () => {
    const showTable = table.hidden;
    table.hidden = !showTable; plot.hidden = showTable;
    if (legend) legend.hidden = showTable;
    toggle.textContent = showTable ? 'Chart' : 'Table';
  });
  // tooltip: tap, hover or keyboard focus on any mark with data-tip
  const show = (el) => {
    const lines = JSON.parse(el.getAttribute('data-tip'));
    tip.replaceChildren(...lines.map(([label, value], i) => {
      const row = document.createElement('div');
      if (i === 0) { row.className = 'tip-title'; row.textContent = label; return row; }
      const v = document.createElement('strong'); v.textContent = value;
      const l = document.createElement('span'); l.textContent = label;
      row.append(v, ' ', l); return row;
    }));
    tip.hidden = false;
    const pr = plot.getBoundingClientRect(), er = el.getBoundingClientRect();
    const x = Math.min(Math.max(er.left + er.width / 2 - pr.left, 70), pr.width - 70);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(er.top - pr.top - 8, 0)}px`;
    svg.querySelectorAll('.hit.on').forEach(n => n.classList.remove('on'));
    el.classList.add('on');
  };
  const hide = () => { tip.hidden = true; svg.querySelectorAll('.hit.on').forEach(n => n.classList.remove('on')); };
  svg.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
  svg.addEventListener('pointerdown', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); else hide(); });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
  svg.addEventListener('focusout', hide);
  return box;
}

function table(headers, rows) {
  const t = document.createElement('table');
  t.className = 'data-table';
  const thead = document.createElement('thead'), tr = document.createElement('tr');
  for (const h of headers) { const th = document.createElement('th'); th.textContent = h; tr.append(th); }
  thead.append(tr); t.append(thead);
  const tb = document.createElement('tbody');
  for (const r of rows) {
    const row = document.createElement('tr');
    r.forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i > 0) td.className = 'num'; row.append(td); });
    tb.append(row);
  }
  t.append(tb);
  return t;
}

/** Spending per main category vs its budget: horizontal bars with a budget tick. */
export function categoryBars(rows, { title = 'Spending by category' } = {}) {
  const W = 340, rowH = 40, top = 4, labelW = 0;
  const H = top + rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map(r => Math.max(r.spent, r.budget)));
  const x0 = labelW, x1 = W - 4;
  const sx = (v) => x0 + (Math.max(0, v) / max) * (x1 - x0);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title, class: 'chart-svg' });
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    svg.append(txt(0, y + 13, r.label, { class: 'lbl' }));
    const over = r.spent > r.budget;
    svg.append(txt(W - 2, y + 13, `${fmt(r.spent, { round: true })} of ${fmt(r.budget, { round: true })}`, { class: 'val', 'text-anchor': 'end' }));
    const by = y + 19, bh = 12;
    svg.append(s('rect', { x: x0, y: by, width: x1 - x0, height: bh, rx: 4, class: 'track' }));
    const inside = Math.min(r.spent, r.budget);
    if (inside > 0) svg.append(s('path', { d: barPath(x0, sx(inside), by, bh, over ? 0 : 4), class: 'bar s1' }));
    if (over) svg.append(s('path', { d: barPath(sx(r.budget) + 2, sx(r.spent), by, bh), class: 'bar over' }));
    if (r.budget > 0) svg.append(s('rect', { x: sx(r.budget) - 1, y: by - 3, width: 2, height: bh + 6, class: 'tick' }));
    const hit = s('rect', {
      x: 0, y, width: W, height: rowH, class: 'hit', tabindex: 0, fill: 'transparent',
      'data-tip': JSON.stringify([[r.label], [fmt(r.spent), 'spent'], [fmt(r.budget), 'budget'], [fmt(r.budget - r.spent), over ? 'over budget' : 'left']]),
    });
    svg.append(hit);
  });
  const tbl = table(['Category', 'Spent', 'Budget', 'Left'], rows.map(r => [r.label, fmt(r.spent), fmt(r.budget), fmt(r.budget - r.spent)]));
  const legend = legendRow([['rect', 's1', 'Spent'], ['tick', '', 'Budget'], ['rect', 'over', 'Over budget']]);
  return wrap(title, svg, tbl, legend);
}

/** Month-end result (carry-over) per month: diverging columns around zero. */
export function resultColumns(points, { title = 'Month-end result' } = {}) {
  const W = 340, H = 190, padL = 38, padB = 22, padT = 16;
  const vals = points.map(p => p.value);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const step = niceStep(hi - lo || 100000);
  const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step || step;
  const sy = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title, class: 'chart-svg' });
  for (let v = yMin; v <= yMax + 1; v += step) {
    svg.append(s('line', { x1: padL, x2: W, y1: sy(v), y2: sy(v), class: v === 0 ? 'axis' : 'grid' }));
    svg.append(txt(padL - 4, sy(v) + 3, compact(v), { class: 'tick-lbl', 'text-anchor': 'end' }));
  }
  const n = points.length, band = (W - padL) / Math.max(n, 1), bw = Math.min(18, band - 3);
  // label the last bar, plus the lowest and highest when they are not right next to another label
  const extremes = new Set([n - 1]);
  for (const i of [vals.indexOf(Math.min(...vals)), vals.indexOf(Math.max(...vals))]) {
    if ([...extremes].every(j => Math.abs(j - i) > 1)) extremes.add(i);
  }
  points.forEach((p, i) => {
    const x = padL + i * band + (band - bw) / 2;
    svg.append(s('path', { d: colPath(x, bw, sy(0), sy(p.value)), class: `bar ${p.value >= 0 ? 'pos' : 'neg'}${p.live ? '' : ' hist'}` }));
    if (i % Math.ceil(n / 6) === 0 || i === n - 1) svg.append(txt(x + bw / 2, H - 6, monthLabel(p.month).slice(0, 3), { class: 'tick-lbl', 'text-anchor': 'middle' }));
    if (extremes.has(i)) svg.append(txt(x + bw / 2, p.value >= 0 ? sy(p.value) - 4 : sy(p.value) + 11, compact(p.value), { class: 'val small', 'text-anchor': 'middle' }));
    svg.append(s('rect', { x: padL + i * band, y: padT, width: band, height: H - padT - padB, class: 'hit', tabindex: 0, fill: 'transparent',
      'data-tip': JSON.stringify([[monthLabel(p.month, true)], [fmt(p.value), 'at month end'], ...(p.live ? [] : [['Coin Master', '']])]) }));
  });
  const tbl = table(['Month', 'Result'], points.map(p => [monthLabel(p.month), fmt(p.value)]));
  const legend = legendRow([['rect', 'pos', 'Positive'], ['rect', 'neg', 'Negative']]);
  return wrap(title, svg, tbl, legend);
}

/** Spent (columns) vs budget (line) per month. One axis, one unit. */
export function spentVsBudget(points, { title = 'Spent vs budget' } = {}) {
  const W = 340, H = 190, padL = 38, padB = 22, padT = 12;
  const hi = Math.max(1, ...points.flatMap(p => [p.spent, p.budget]));
  const step = niceStep(hi);
  const yMax = Math.ceil(hi / step) * step;
  const sy = (v) => padT + (1 - v / yMax) * (H - padT - padB);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title, class: 'chart-svg' });
  for (let v = 0; v <= yMax + 1; v += step) {
    svg.append(s('line', { x1: padL, x2: W, y1: sy(v), y2: sy(v), class: v === 0 ? 'axis' : 'grid' }));
    svg.append(txt(padL - 4, sy(v) + 3, compact(v), { class: 'tick-lbl', 'text-anchor': 'end' }));
  }
  const n = points.length, band = (W - padL) / Math.max(n, 1), bw = Math.min(18, band - 3);
  let line = '';
  points.forEach((p, i) => {
    const x = padL + i * band + (band - bw) / 2;
    svg.append(s('path', { d: colPath(x, bw, sy(0), sy(p.spent)), class: 'bar s1' + (p.live ? '' : ' hist') }));
    line += `${i ? 'L' : 'M'}${x + bw / 2},${sy(p.budget)}`;
    if (i % Math.ceil(n / 6) === 0 || i === n - 1) svg.append(txt(x + bw / 2, H - 6, monthLabel(p.month).slice(0, 3), { class: 'tick-lbl', 'text-anchor': 'middle' }));
  });
  svg.append(s('path', { d: line, class: 'line budget' }));
  points.forEach((p, i) => {
    svg.append(s('rect', { x: padL + i * band, y: padT, width: band, height: H - padT - padB, class: 'hit', tabindex: 0, fill: 'transparent',
      'data-tip': JSON.stringify([[monthLabel(p.month, true)], [fmt(p.spent), 'spent'], [fmt(p.budget), 'budget']]) }));
  });
  const tbl = table(['Month', 'Spent', 'Budget'], points.map(p => [monthLabel(p.month), fmt(p.spent), fmt(p.budget)]));
  const legend = legendRow([['rect', 's1', 'Spent'], ['line', 'budget', 'Budget']]);
  return wrap(title, svg, tbl, legend);
}

function legendRow(items) {
  const row = document.createElement('div');
  row.className = 'legend';
  for (const [kind, cls, label] of items) {
    const it = document.createElement('span'); it.className = 'legend-item';
    const key = document.createElement('span'); key.className = `key key-${kind} ${cls}`;
    const l = document.createElement('span'); l.textContent = label;
    it.append(key, l); row.append(it);
  }
  return row;
}
