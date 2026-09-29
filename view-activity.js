// Activity: every transaction of a month, searchable; bulk filing and manual entries for the owner.
import * as E from './engine.js';
import { h, icon, chip, openSheet, field, empty, dayHeading, toast } from './ui.js';
import { app, isOwner, mutate, render, monthSwitcher, undoLast } from './app.js';
import { txnRow, openTxn, openCategorize, accountName } from './txn-ui.js';

const fmt = E.fmt;

const FILTERS = [
  ['all', 'All'], ['review', 'To review'], ['budget', 'Buckets'], ['income', 'Income'], ['outside', 'Outside budget'],
];

function matches(t, filter, q) {
  if (filter === 'review' && !t.rev) return false;
  if (filter === 'budget' && t.type !== 'expense') return false;
  if (filter === 'income' && t.type !== 'income') return false;
  if (filter === 'outside' && !['transfer', 'oneoff', 'loan', 'settle', 'ignore'].includes(t.type)) return false;
  if (['transfer', 'oneoff', 'loan', 'settle'].includes(filter) && t.type !== filter) return false;
  if (filter.startsWith('src:') && t.src !== filter.slice(4)) return false;
  if (filter.startsWith('cat:') && t.cat !== filter.slice(4)) return false;
  if (q) {
    const hay = E.norm(`${t.cp} ${t.purpose} ${t.note || ''} ${t.tag || ''} ${(t.amt / 100).toFixed(2)} ${fmt(t.amt)}`);
    if (!E.norm(q).split(' ').every(w => hay.includes(w))) return false;
  }
  return true;
}

export function renderActivity() {
  const m = app.route.month;
  const filter = app.route.filter || 'all';
  const q = app.route.q || '';
  const sel = app.actSel || (app.actSel = new Set());
  const selecting = !!app.actSelecting;
  const listHost = h('div.listhost');
  const drawList = () => {
    const all = E.txnsForMonth(app.state, m).filter(t => matches(t, filter, app.route.q || ''));
    if (!all.length) {
      const hist = app.state.history && app.state.history[m];
      listHost.replaceChildren(hist && !q && filter === 'all' ? empty('Only totals for this month', 'Coin Master kept this month as totals. Transactions are stored from April 2026 on.')
        : empty('No transactions', q ? 'Nothing matches your search.' : filter !== 'all' ? 'Nothing in this filter.' : 'Import a George export under Update.'));
      return;
    }
    const byDay = new Map();
    for (const t of all) { if (!byDay.has(t.date)) byDay.set(t.date, []); byDay.get(t.date).push(t); }
    const inSum = all.filter(t => t.amt > 0).reduce((s, t) => s + t.amt, 0), outSum = all.filter(t => t.amt < 0).reduce((s, t) => s + t.amt, 0);
    listHost.replaceChildren(
      h('p.muted.small', `${all.length} transactions · in ${fmt(inSum)} · out ${fmt(outSum)}`),
      ...[...byDay.entries()].map(([day, txs]) => h('section.day',
        h('h3.day-head', dayHeading(day)),
        h('ul.txlist', txs.map(t => txnRow(t, {
          selectable: selecting && !t.arch, selected: sel.has(t.id),
          onselect: (on) => { if (on) sel.add(t.id); else sel.delete(t.id); drawBulk(); },
          onclick: () => selecting && !t.arch ? (sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id), drawList(), drawBulk()) : openTxn(t.id),
        }))))));
  };
  const bulkHost = h('div');
  const drawBulk = () => {
    bulkHost.replaceChildren(selecting ? h('div.bulkbar.sticky',
      h('span', `${sel.size} selected`),
      h('button.btn.small.primary', { type: 'button', disabled: !sel.size, onclick: () => openCategorize([...sel], { onDone: () => { sel.clear(); app.actSelecting = false; } }) }, 'File selected…')) : '');
  };
  const search = h('input.search', {
    type: 'search', placeholder: 'Search', value: q, 'aria-label': 'Search',
    oninput: (e) => { app.route.q = e.target.value; drawList(); },
  });
  const selectedMonth = E.monthLabel(m, true);
  const head = h('div.toolbar',
    h('div.searchbox', icon('search'), search),
    isOwner() ? h('button.icon-btn', { type: 'button', 'aria-label': selecting ? 'Stop selecting' : 'Select several', onclick: () => { app.actSelecting = !selecting; if (!app.actSelecting) sel.clear(); render(); } }, icon(selecting ? 'x' : 'check')) : null,
    isOwner() ? h('button.icon-btn', { type: 'button', 'aria-label': 'Add a transaction by hand', onclick: () => addManual(m) }, icon('plus')) : null);
  const extraFilters = [];
  if (filter.startsWith('src:')) extraFilters.push([filter, accountName(filter.slice(4))]);
  if (['transfer', 'oneoff', 'loan', 'settle'].includes(filter)) extraFilters.push([filter, { transfer: 'Transfers', oneoff: 'One-offs', loan: 'Loans', settle: 'Card bills' }[filter]]);
  const chips = h('div.chips.scroll', [...FILTERS, ...extraFilters].map(([k, label]) => chip(label, { on: filter === k, onclick: () => { app.route.filter = k; render(); } })),
    app.state.accounts.filter(a => `src:${a.id}` !== filter).map(a => chip(a.name, { onclick: () => { app.route.filter = `src:${a.id}`; render(); } })));
  drawList(); drawBulk();
  return h('div.stack', monthSwitcher(), head, chips, bulkHost, h('div', { 'aria-label': `Transactions ${selectedMonth}` }, listHost));
}

function addManual(m) {
  const today = E.todayISO();
  const defDate = E.ym(today) === m ? today : `${m}-01`;
  const acc = h('select', app.state.accounts.map(a => h('option', { value: a.id, selected: a.manual }, a.name)));
  const date = h('input', { type: 'date', value: defDate });
  const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: '12,50' });
  let dir = 'out';
  const dirChips = h('div.chips');
  const drawDir = () => dirChips.replaceChildren(chip('Money out', { on: dir === 'out', onclick: () => { dir = 'out'; drawDir(); } }), chip('Money in', { on: dir === 'in', onclick: () => { dir = 'in'; drawDir(); } }));
  drawDir();
  const merchant = h('input', { type: 'text', placeholder: 'e.g. Zalando', maxlength: 80 });
  const purpose = h('input', { type: 'text', placeholder: 'optional', maxlength: 140 });
  const sheet = openSheet({
    title: 'Add by hand', subtitle: 'For cash or a card without an export',
    body: h('div.stack-sm', field('Account', acc), field('Date', date), field('Amount', amount), dirChips, field('Merchant or person', merchant), field('Details', purpose),
      h('p.muted.small', 'If the same payment later arrives in a bank export, the app flags it as a possible duplicate so it is never counted twice.')),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      const cents = E.toCents(amount.value);
      if (!cents || !date.value || !merchant.value.trim()) { (!cents ? amount : !date.value ? date : merchant).focus(); return; }
      const amt = dir === 'out' ? -Math.abs(cents) : Math.abs(cents);
      const id = E.newId('man');
      sheet.close();
      let t;
      mutate(s => {
        t = { id, fp: id, occ: 1, src: acc.value, date: date.value, amt, cp: merchant.value.trim(), purpose: purpose.value.trim(), iban: '', acct: '', bank: '', batch: 'manual', a: 0, manual: 1 };
        Object.assign(t, E.categorize(s, t));
        s.txns.push(t);
      }, { label: null });
      toast('Added', { actions: [['Undo', () => undoLast()]] });
      openCategorize([id]);
    } }, 'Add')],
  });
  setTimeout(() => amount.focus(), 60);
}
