// Budget dashboard: the quick-glance screen for both phones.
import * as E from './engine.js';
import { h, icon, meter, segmented, openSheet, empty } from './ui.js';
import { categoryBars, resultColumns, spentVsBudget } from './charts.js';
import { app, isOwner, navigate, monthSwitcher, txnRow, openTxn, uiPref, setUiPref, calc } from './app.js';

const fmt = E.fmt;

export function renderBudget() {
  const { months } = calc();
  const m = app.route.month;
  const f = months.get(m);
  if (!f) return empty('No data for this month', 'Pick another month.');
  const idx = E.subIndex(app.state);
  const out = [monthSwitcher()];
  out.push(f.history ? historyHero(f) : liveHero(f, m));
  if (isOwner() && !f.history) out.push(attentionCard());
  out.push(bucketsSection(f, idx, m));
  if (!f.history) {
    const outside = outsideCard(f, m);
    if (outside) out.push(outside);
    out.push(cardsCard());
  }
  out.push(chartsSection(f, months, idx, m));
  if (f.history && f.notes && f.notes.length) out.push(h('section.card', h('h3', 'Notes from Coin Master'), f.notes.map(n => h('p.muted', n))));
  return h('div.stack', out);
}

function liveHero(f, m) {
  const left = f.closing;
  const today = E.todayISO();
  const isCurrent = E.ym(today) === m;
  const daysLeft = isCurrent ? E.daysInMonth(m) - Number(today.slice(8, 10)) : null;
  const bucketSpent = f.spentTotal - f.uncatSpent;
  return h('section.card.hero',
    h('p.hero-label', f.future ? 'Already booked for this month' : 'Money left this month'),
    h('p.hero-value', { class: left < 0 ? 'neg' : '' }, fmt(left)),
    h('p.muted', `${f.budgetTotal - bucketSpent >= 0 ? `Budget still open ${fmt(f.budgetTotal - bucketSpent, { round: true })}` : `Buckets over budget by ${fmt(bucketSpent - f.budgetTotal, { round: true })}`}${daysLeft !== null ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}`),
    meter(bucketSpent, f.budgetTotal),
    freshness(m),
    h('div.kpis',
      kpi('Income', fmt(f.incomeTotal, { round: true }), `plan ${fmt(Object.values(f.incomePlan).reduce((s, v) => s + v, 0), { round: true })}`),
      kpi('Spent', fmt(bucketSpent, { round: true }), `budget ${fmt(f.budgetTotal, { round: true })}`),
      kpi('Carried in', fmt(f.opening, { round: true }), `from ${E.monthLabel(E.addMonths(m, -1))}`, f.opening < 0),
      kpi('If buckets end on budget', fmt(f.projClosing, { round: true }), 'month-end estimate', f.projClosing < 0),
    ));
}

function freshness(m) {
  const last = E.lastBankDate(app.state);
  if (!last) return h('p.fresh.warn', icon('alert', 'sm'), 'No bank export imported yet');
  const d = new Date(last + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const stale = last < `${m}-01` && m <= E.ym(E.todayISO());
  return h('p.fresh', { class: stale ? 'warn' : '' }, icon(stale ? 'alert' : 'check', 'sm'), stale ? `No bank data for this month yet · last booking ${d}` : `Bank data up to ${d}`);
}

function historyHero(f) {
  return h('section.card.hero',
    h('p.hero-label', 'Month ended at'),
    h('p.hero-value', { class: f.closing < 0 ? 'neg' : '' }, fmt(f.closing)),
    h('p.badge-line', icon('lock', 'sm'), 'From Coin Master · read-only'),
    h('div.kpis',
      kpi('Income', fmt(f.incomeTotal, { round: true })),
      kpi('Spent', fmt(f.spentTotal - f.uncatSpent, { round: true }), `budget ${fmt(f.budgetTotal, { round: true })}`),
      kpi('Carried in', fmt(f.opening, { round: true }), null, f.opening < 0),
      kpi('Outside budget (net)', fmt(-f.uncatSpent, { round: true })),
    ));
}

function kpi(label, value, sub, neg = false) {
  return h('div.kpi', h('p.kpi-label', label), h('p.kpi-value', { class: neg ? 'neg' : '' }, value), sub ? h('p.kpi-sub', sub) : null);
}

function attentionCard() {
  const q = E.reviewQueue(app.state);
  const rec = calc().rec;
  const giroCheck = rec.lastCheck.giro;
  const lastImport = (app.state.imports || []).at(-1);
  const checkedSinceImport = giroCheck && lastImport && giroCheck.at >= lastImport.at;
  if (!lastImport) {
    return h('button.card.slim.attention', { type: 'button', onclick: () => navigate('update') }, icon('update'),
      h('div', h('strong', 'First update'), h('p.muted', `Import the George exports from 1 ${E.monthLabel(app.state.settings.startMonth, true).split(' ')[0]} until today (current account and cards).`)),
      icon('right', 'chev'));
  }
  if (!q.length && checkedSinceImport) {
    return h('section.card.slim.ok', icon('check'), h('div', h('strong', 'All filed'), h('p.muted', `Last update ${new Date(lastImport.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${giroCheck && Math.abs(giroCheck.diff) < 1 ? ' · balance matches George' : ''}`)));
  }
  return h('button.card.slim.attention', { type: 'button', onclick: () => navigate('update') },
    icon('alert'),
    h('div', h('strong', q.length ? `${q.length} transaction${q.length === 1 ? '' : 's'} to look at` : 'Check the balance'),
      h('p.muted', q.length ? 'Only new and unclear ones. Most take one tap.' : 'Compare with George once after an update.')),
    icon('right', 'chev'));
}

function bucketsSection(f, idx, m) {
  const mode = uiPref('buckets', 'day');
  const subs = new Set([...Object.keys(f.budget), ...Object.keys(f.spent)]);
  const groups = [];
  for (const c of app.state.cats) {
    if (c.income) continue;
    const rows = c.subs.filter(s => subs.has(s.id) && ((f.budget[s.id] || 0) !== 0 || (f.spent[s.id] || 0) !== 0));
    const known = rows.length ? rows : [];
    const pick = known.filter(s => mode === 'all' || (mode === 'day' ? s.variable : !s.variable));
    if (pick.length) groups.push([c, pick]);
  }
  const extra = [];
  if (f.history && f.uncatSpent) extra.push(h('p.muted.small', `Coin Master "Net uncategorised": ${fmt(f.uncatSpent)}`));
  if (!f.history && f.uncatSpent) extra.push(bucketRow({ id: null, name: 'Not yet sorted', variable: true }, 0, f.uncatSpent, m, true));
  return h('section.card',
    h('div.section-head', h('h2', 'Buckets'),
      segmented([['day', 'Day-to-day'], ['fixed', 'Fixed'], ['all', 'All']], mode, (v) => { setUiPref('buckets', v); })),
    groups.length ? groups.map(([c, rows]) => {
      const b = rows.reduce((s, r) => s + (f.budget[r.id] || 0), 0), sp = rows.reduce((s, r) => s + (f.spent[r.id] || 0), 0);
      return h('div.group',
        rows.length > 1 ? h('div.group-head', h('span', c.name), h('span.muted', `${fmt(b - sp, { round: true })} left of ${fmt(b, { round: true })}`)) : null,
        rows.map(s => bucketRow(s, f.budget[s.id] || 0, f.spent[s.id] || 0, m, false, rows.length === 1 ? c.name : null)));
    }) : empty('Nothing here', 'No buckets of this kind this month.'),
    extra);
}

function bucketRow(sub, budget, spent, m, unsorted = false, groupName = null) {
  const left = budget - spent;
  const over = spent > budget + 0.5;
  let status;
  if (unsorted) status = h('span.status.warn', icon('alert', 'sm'), `${fmt(spent)} waiting for review`);
  else if (!sub.variable && !over) status = spent === 0 ? h('span.muted', 'Not paid yet') : spent >= budget * 0.9 ? h('span.status.good', icon('check', 'sm'), 'Paid') : h('span.muted', `${fmt(spent)} so far`);
  else if (over) status = h('span.status.bad', icon('alert', 'sm'), `Over by ${fmt(-left)}`);
  else status = h('span.muted', `${fmt(spent)} of ${fmt(budget, { round: true })}`);
  return h('button.bucket', { type: 'button', onclick: () => openBucket(sub, m, budget, spent) },
    h('div.bucket-top',
      h('span.bucket-name', groupName && groupName !== sub.name ? `${groupName} · ${sub.name}` : sub.name),
      h('span.bucket-left', { class: over ? 'neg' : '' }, unsorted ? '' : sub.variable || over ? `${fmt(left)} ${over ? '' : 'left'}`.trim() : fmt(budget))),
    unsorted ? null : meter(spent, budget, { variable: sub.variable }),
    h('div.bucket-sub', status));
}

function openBucket(sub, m, budget, spent) {
  const f = calc().months.get(m);
  const txs = app.state.txns.filter(t => t.bm === m && (sub.id ? (t.cat === sub.id || (t.type === 'loan' && app.state.loans.find(L => L.id === t.loan && L.closed && L.keptCat === sub.id))) : (t.type === 'expense' && !t.cat)))
    .sort((a, b) => b.date.localeCompare(a.date));
  openSheet({
    title: sub.name,
    subtitle: f.history ? `${E.monthLabel(m, true)} · from Coin Master` : `${E.monthLabel(m, true)} · ${fmt(spent)} of ${fmt(budget)}`,
    body: () => h('div',
      budget ? h('div.sheet-meter', meter(spent, budget, { variable: sub.variable }), h('p.muted', spent > budget ? `Over by ${fmt(spent - budget)}` : `${fmt(budget - spent)} left`)) : null,
      txs.length ? h('ul.txlist', txs.map(t => txnRow(t, { onclick: () => openTxn(t.id) }))) :
        f.history && !txs.length ? empty('Only totals', 'Coin Master kept this month as totals; transactions are stored from April 2026 on.') : empty('No transactions yet'),
    ),
  });
}

function outsideCard(f, m) {
  const items = [];
  if (f.oneoffs) items.push(['One-offs & trips', f.oneoffs]);
  if (f.transfers) items.push(['Transfers in/out', f.transfers]);
  if (f.loansOpen) items.push(['Open loans & returns', f.loansOpen]);
  if (!items.length) return null;
  return h('section.card',
    h('div.section-head', h('h2', 'Outside the budget'), h('span.muted.small', 'not in any bucket')),
    items.map(([label, amt]) => h('button.row-btn', { type: 'button', onclick: () => openOutside(m) },
      h('span.grow', label), h('span.amt', { class: amt < 0 ? 'neg' : 'pos' }, fmt(amt, { sign: true })), icon('right', 'chev'))),
    h('p.muted.small', 'These still change the month result. A one-off paid from savings nets to zero once its funding transfer carries the same name.'));
}

/** One-offs grouped by name (spent vs funded), the transfer log and open loans for a month. */
function openOutside(m) {
  const txs = app.state.txns.filter(t => t.bm === m && ['oneoff', 'transfer', 'loan'].includes(t.type));
  const groups = new Map();
  for (const t of txs.filter(x => x.type === 'oneoff')) {
    const k = t.tag || 'Without a name';
    const g = groups.get(k) || { name: k, out: 0, in: 0, txs: [] };
    if (t.amt < 0) g.out += t.amt; else g.in += t.amt;
    g.txs.push(t); groups.set(k, g);
  }
  const transfers = txs.filter(t => t.type === 'transfer').sort((a, b) => b.date.localeCompare(a.date));
  const loans = E.loanSummary(app.state).filter(L => L.month === m || L.txs.some(t => t.bm === m));
  const groupRow = (g) => {
    const list = h('ul.txlist.compact', { hidden: true }, g.txs.map(t => txnRow(t, { onclick: () => openTxn(t.id) })));
    const net = g.out + g.in;
    return h('div.og',
      h('button.row-btn', { type: 'button', onclick: () => { list.hidden = !list.hidden; } },
        h('span.grow', h('strong', g.name), h('span.muted.small.block', `spent ${fmt(g.out)}${g.in ? ` · funded ${fmt(g.in)}` : ' · no funding yet'}`)),
        h('span.amt', { class: net < 0 ? 'neg' : '' }, fmt(net, { sign: true }))),
      list);
  };
  openSheet({
    title: 'Outside the budget', subtitle: E.monthLabel(m, true), tall: true,
    body: h('div.stack-sm',
      groups.size ? [h('h3', 'One-offs & trips'), [...groups.values()].sort((a, b) => a.out - b.out).map(groupRow)] : null,
      transfers.length ? [h('h3', 'Transfer log'), h('ul.txlist', transfers.map(t => txnRow(t, { onclick: () => openTxn(t.id) })))] : null,
      loans.length ? [h('h3', 'Loans & pending returns'), loans.map(L => h('div.row-btn', h('span.grow', h('strong', L.name), h('span.muted.small.block', L.closed ? 'closed' : 'open')), h('span.amt', fmt(L.balance, { sign: true }))))] : null,
      !groups.size && !transfers.length && !loans.length ? empty('Nothing outside the budget') : null),
  });
}

function cardsCard() {
  const cards = E.cardSummary(app.state);
  return h('section.card',
    h('div.section-head', h('h2', 'Credit cards')),
    cards.map(c => h('button.row-btn', { type: 'button', onclick: () => navigate('activity', { filter: 'src:' + c.id }) },
      icon('card'),
      h('span.grow', h('span', c.name), h('span.muted.small.block', c.lastPayment ? `last bill ${fmt(c.lastPayment.amt)} paid ${new Date(c.lastPayment.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'running balance')),
      h('span.amt', c.owed > 0 ? fmt(c.owed) : fmt(0)))),
    h('p.muted.small', 'Card spending counts in the buckets when it happens; the monthly card bill is a transfer.'));
}

function chartsSection(f, months, idx, m) {
  const rows = [];
  for (const c of app.state.cats) {
    if (c.income) continue;
    const budget = c.subs.reduce((s, x) => s + (f.budget[x.id] || 0), 0), spent = c.subs.reduce((s, x) => s + (f.spent[x.id] || 0), 0);
    if (budget || spent) rows.push({ label: c.name, budget, spent });
  }
  rows.sort((a, b) => b.spent - a.spent);
  const today = E.ym(E.todayISO());
  const series = [...months.values()].filter(x => x.month <= (m > today ? m : today) && !x.future);
  const last = series.slice(-14);
  return h('section.charts',
    categoryBars(rows, { title: `Spending by category · ${E.monthLabel(m)}` }),
    resultColumns(last.map(x => ({ month: x.month, value: x.closing, live: !x.history })), { title: 'Month-end result' }),
    spentVsBudget(last.slice(-12).map(x => ({ month: x.month, spent: x.spentTotal - x.uncatSpent, budget: x.budgetTotal, live: !x.history })), { title: 'Spent vs budget' }));
}
