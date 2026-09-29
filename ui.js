// Tiny DOM toolkit: element builder, icons, sheets, toasts, common widgets.
// All text goes in through textContent (bank texts are untrusted input).

export function h(tag, attrs, ...kids) {
  const [head, ...classes] = tag.split('.');
  const [name, id] = head.split('#');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  update: 'M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4.9a7.7 7.7 0 0 0-2.4-1.4L14.3 2h-4l-.4 2.6a7.7 7.7 0 0 0-2.4 1.4l-2.4-.9-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-.9a7.7 7.7 0 0 0 2.4 1.4l.4 2.6h4l.4-2.6a7.7 7.7 0 0 0 2.4-1.4l2.4.9 2-3.4z',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14',
  alert: 'M12 8v5m0 3.5h.01M10.3 3.9 1.8 18.5A2 2 0 0 0 3.5 21.5h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  card: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3 10h18',
  bank: 'M3 10h18L12 4zM5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 21h18',
  swap: 'M7 7h13l-4-4M17 17H4l4 4',
  loop: 'M20 11a8 8 0 0 0-14.6-4.5L4 8m0-5v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16m0 5v-5h-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.3-4.3',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  cloud: 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z',
  trip: 'M2 16l20-8-7 13-3-6z',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4m8-4v4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
  rule: 'M4 5h16M4 12h10M4 19h6m7-3 2 2 4-4',
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h14V9H6.5A2.5 2.5 0 0 1 4 7.5zM16.5 14h.01',
};
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.more);
  svg.append(p);
  return svg;
}

// ───────────── toasts ─────────────
let toastTimer;
export function toast(message, { actions = [], kind = '', ms = 4500 } = {}) {
  const host = document.getElementById('toast');
  clearTimeout(toastTimer);
  host.replaceChildren(h('div.toast-inner', { class: kind, role: 'status' },
    h('span', message),
    actions.map(([label, fn]) => h('button.link', { type: 'button', onclick: () => { host.replaceChildren(); fn(); } }, label))));
  host.hidden = false;
  toastTimer = setTimeout(() => { host.hidden = true; host.replaceChildren(); }, ms);
}

// ───────────── bottom sheets ─────────────
const sheets = [];
export function openSheet({ title, subtitle, body, footer, onClose, tall = false }) {
  const host = document.getElementById('sheets');
  const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Details', class: tall ? 'tall' : '' });
  const backdrop = h('div.backdrop', { onclick: () => close() });
  const wrap = h('div.sheet-wrap', backdrop, panel);
  const api = {
    el: panel,
    close,
    set(content) { render(content); },
  };
  function render(content = {}) {
    const t = content.title ?? title, st = content.subtitle ?? subtitle, b = content.body ?? body, f = content.footer ?? footer;
    panel.replaceChildren(...[
      h('div.sheet-grip'),
      h('header.sheet-head',
        h('div', h('h2', t), st ? h('p.muted', st) : null),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'))),
      h('div.sheet-body', typeof b === 'function' ? b(api) : b),
      f ? h('footer.sheet-foot', typeof f === 'function' ? f(api) : f) : null,
    ].filter(Boolean));
  }
  function close() {
    const i = sheets.indexOf(api);
    if (i >= 0) sheets.splice(i, 1);
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 160);
    document.body.classList.toggle('sheet-open', sheets.length > 0);
    if (onClose) onClose();
  }
  render();
  host.append(wrap);
  sheets.push(api);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => wrap.classList.add('open'));
  return api;
}
export function closeAllSheets() { [...sheets].forEach(s => s.close()); }
export function topSheet() { return sheets[sheets.length - 1] || null; }

export function confirmSheet({ title, message, confirm = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise(resolve => {
    let done = false;
    const sh = openSheet({
      title, body: h('p', message),
      footer: [h('button.btn.ghost', { type: 'button', onclick: () => { done = true; sh.close(); resolve(false); } }, cancel),
        h('button.btn', { type: 'button', class: danger ? 'danger' : 'primary', onclick: () => { done = true; sh.close(); resolve(true); } }, confirm)],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

// ───────────── widgets ─────────────
export function meter(spent, budget, { variable = true } = {}) {
  const pct = budget > 0 ? spent / budget : (spent > 0 ? 1.01 : 0);
  const w = Math.max(0, Math.min(1, pct)) * 100;
  const state = pct > 1.0001 ? 'over' : pct >= 0.9 ? (variable ? 'near' : 'ok') : 'ok';
  const m = h('div.meter', { class: state, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct * 100) },
    h('div.meter-fill', { style: { width: `${w}%` } }));
  return m;
}

export function chip(label, { on = false, onclick, cls = '' } = {}) {
  return h('button.chip', { type: 'button', class: [on ? 'on' : '', cls].join(' '), 'aria-pressed': on ? 'true' : 'false', onclick }, label);
}

export function segmented(options, value, onchange) {
  return h('div.segmented', { role: 'tablist' }, options.map(([v, label]) =>
    h('button', { type: 'button', role: 'tab', class: v === value ? 'on' : '', 'aria-selected': v === value ? 'true' : 'false', onclick: () => onchange(v) }, label)));
}

export function field(label, input, hint) {
  return h('label.field', h('span.field-label', label), input, hint ? h('span.field-hint', hint) : null);
}

export function empty(title, text, action) {
  return h('div.empty', h('p.empty-title', title), text ? h('p.muted', text) : null, action || null);
}

export function relTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso), now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ` ${time}`;
}

export function shortDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export function dayHeading(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
