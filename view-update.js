// Update: import the George exports, then review only what is new and unclear.
import * as E from './engine.js';
import { readSpreadsheet } from './xlsx-lite.js';
import { h, icon, chip, openSheet, toast, field, empty, shortDate } from './ui.js';
import { app, mutate, calc, render, undoLast, publishNow } from './app.js';
import { txnRow, openTxn, openCategorize, accountName, describeCategory } from './txn-ui.js';

const fmt = E.fmt;

export function renderUpdate() {
  const q = E.reviewQueue(app.state);
  return h('div.stack',
    importCard(),
    app.lastImport ? summaryCard(app.lastImport) : null,
    invoiceCard(),
    balanceCard(),
    reviewSection(q),
    historyCard());
}

// ───────────────────────── import ─────────────────────────

function importCard() {
  const input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv', hidden: true, onchange: (e) => { const files = [...e.target.files]; e.target.value = ''; runImport(files); } });
  return h('section.card.import',
    h('h2', 'Update from George'),
    h('p.muted', 'Export this month so far for the current account and each credit card, then pick all the files at once. Transactions you already have are skipped automatically.'),
    input,
    h('button.btn.primary.wide.big', { type: 'button', disabled: app.busy, onclick: () => input.click() }, icon('update'), app.busy ? 'Reading files…' : 'Choose export files'));
}

async function runImport(fileList) {
  if (!fileList.length) return;
  app.busy = true; render();
  const files = [], problems = [];
  const track = { learned: [], newAccts: [] }; // remembered with the import, so undoing it forgets them too
  try {
    for (const f of fileList) {
      try {
        const rows = await readSpreadsheet(await f.arrayBuffer(), f.name);
        const records = E.parseSheetRows(rows);
        let accountId = E.detectAccount(app.state, f.name, records);
        if (!accountId) accountId = await askAccount(f.name, records, track);
        if (!accountId) { problems.push(`${f.name}: skipped`); continue; }
        files.push({ name: f.name, accountId, records });
      } catch (e) {
        problems.push(`${f.name}: ${e.message}`);
      }
    }
    if (files.length) {
      const plan = E.planImport(app.state, files);
      // Card purchases late in a month need that month's invoice closing date: ask before filing them.
      const questions = typeof E.invoiceQuestions === 'function' ? E.invoiceQuestions(app.state, { extra: plan.fresh, onlyExtra: true }) : [];
      const dates = questions.length ? await askInvoiceDates(questions) : null;
      const batchId = E.newId('imp');
      let res;
      mutate(s => {
        if (dates && dates.length) E.setInvoiceDates(s, dates);
        res = E.applyImport(s, plan, { batchId, ...track });
      }, { label: null, message: `Import: ${plan.fresh.length} new` });
      app.lastImport = { id: batchId, at: new Date().toISOString(), res: { added: res.added, known: res.known, review: res.review }, files: plan.files, problems };
      if (res.added) publishNow();
      window.scrollTo({ top: 0 });
    } else if (problems.length) {
      app.lastImport = { at: new Date().toISOString(), res: { added: 0, known: 0, review: 0 }, files: [], problems };
    }
  } finally {
    app.busy = false; render();
  }
}

function askAccount(fileName, records, track) {
  return new Promise(resolve => {
    let done = false;
    const idPart = E.fileIdPart(fileName);
    const cardLike = records.length && records.every(r => !r.partner && !r.iban);
    const remember = (id) => {
      done = true; sheet.close();
      mutate(s => {
        const a = s.accounts.find(x => x.id === id);
        if (idPart && idPart.length >= 4 && !a.ids.includes(idPart)) { a.ids.push(idPart); track.learned.push({ acct: id, id: idPart }); }
      }, { label: null });
      resolve(id);
    };
    const nameIn = h('input', { type: 'text', placeholder: cardLike ? 'e.g. Mastercard …1234' : 'e.g. Savings account' });
    const sheet = openSheet({
      title: 'Which account is this?', subtitle: `${fileName} · ${records.length} rows`,
      body: h('div.stack-sm',
        h('p.muted', 'Asked once; the app remembers it from the file name.'),
        app.state.accounts.map(a => h('button.row-btn', { type: 'button', onclick: () => remember(a.id) }, icon(a.kind === 'card' ? 'card' : 'bank'), h('span.grow', a.name))),
        h('details', h('summary', 'A new card or account'),
          field('Name', nameIn),
          h('button.btn.primary', { type: 'button', onclick: () => {
            const name = nameIn.value.trim(); if (!name) { nameIn.focus(); return; }
            const id = E.newId('acc');
            mutate(s => { s.accounts.push({ id, name, kind: cardLike ? 'card' : 'giro', ids: [idPart].filter(Boolean), anchor: { cents: 0, note: 'Added in the app: set the balance under Accounts' } }); }, { label: null });
            track.newAccts.push(id);
            done = true; sheet.close(); resolve(id);
          } }, 'Add account'))),
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

function summaryCard(li) {
  const { res, files, problems } = li;
  const canUndo = li.id && undoable(li.id);
  return h('section.card.summary',
    h('div.section-head', h('h2', res.added ? 'Imported' : 'Nothing new'), h('button.icon-btn', { type: 'button', 'aria-label': 'Dismiss', onclick: () => { app.lastImport = null; render(); } }, icon('x'))),
    h('p.big-line', h('span', h('strong', res.added), ' new'), h('span', h('strong', res.known), ' already known'), h('span', h('strong', res.review), ' to review')),
    files.map(f => h('p.file-line', icon('file', 'sm'), h('span', `${accountName(f.accountId)} · ${f.rows} rows`), h('span.muted.ellipsis', f.name))),
    (problems || []).map(p => h('p.notice.warn', p)),
    canUndo ? h('button.link.small', { type: 'button', onclick: () => confirmUndo(li.id) }, icon('undo', 'sm'), 'Wrong files? Undo this import') : null);
}

// ───────────────────────── undo an import ─────────────────────────

// (guarded: during an app update the page may briefly run the previous engine)
const undoable = (id) => typeof E.undoableImport === 'function' && E.undoableImport(app.state, id);
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** ['2026-08', '2026-09'] → "August and September 2026" */
function monthsText(ms) {
  const list = (names) => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  if (ms.every(m => m.slice(0, 4) === ms[0].slice(0, 4))) return `${list(ms.map(m => E.monthLabel(m, true).split(' ')[0]))} ${ms[0].slice(0, 4)}`;
  return list(ms.map(m => E.monthLabel(m, true)));
}

function confirmUndo(batchId) {
  const p = E.undoPreview(app.state, batchId, E.todayISO());
  if (!p) { toast('Nothing left to undo in that import'); render(); return; }
  const n = p.removed;
  const monthName = E.monthLabel(p.month, true).split(' ')[0];
  const sheet = openSheet({
    title: 'Undo this import?',
    subtitle: `Imported ${when(p.imp.at)}`,
    body: h('div.stack-sm',
      (p.imp.files || []).map(f => h('p.file-line', icon('file', 'sm'), h('span', `${accountName(f.accountId)} · ${f.rows} rows`), h('span.muted.ellipsis', f.name))),
      h('p', `Removes the ${n} transaction${n === 1 ? '' : 's'} it added` + (p.months.length
        ? ` (${monthsText(p.months)}). Months and carry-over are recalculated.`
        : `. ${n === 1 ? 'It did not count' : 'None of them counted'} in any month, so your figures stay the same.`)),
      h('p', p.filed ? `You had already filed ${p.filed} of them; those decisions go too. Your rules stay.` : 'Your rules stay.'),
      p.moneyBefore !== null && p.moneyAfter !== null && p.moneyBefore !== p.moneyAfter
        ? h('p', `Money left in ${monthName}: `, h('strong', fmt(p.moneyBefore)), ' → ', h('strong', fmt(p.moneyAfter))) : null,
      p.later
        ? h('p.notice.warn', icon('alert', 'sm'), `You updated again after this${p.later > 1 ? ` (${p.later} times)` : ''}; those updates stay. Afterwards, import the right files: anything missing is added back, the rest is skipped.`)
        : h('p.muted', 'Afterwards, import the right files as usual: these transactions are then treated as new.')),
    footer: [
      h('button.btn.ghost', { type: 'button', onclick: () => sheet.close() }, 'Cancel'),
      h('button.btn.danger', { type: 'button', onclick: () => { sheet.close(); undoImportNow(batchId); } }, 'Undo import'),
    ],
  });
}

function undoImportNow(batchId) {
  if (!undoable(batchId)) return;
  let res = null;
  mutate(s => { res = E.undoImport(s, batchId); }, { label: null, message: 'Undo import' });
  if (!res) return;
  if (app.lastImport && app.lastImport.id === batchId) app.lastImport = null;
  render();
  publishNow();
  toast(`Import undone: ${res.removed} transaction${res.removed === 1 ? '' : 's'} removed`, { actions: [['Undo', () => undoLast()]], ms: 8000 });
}

// ───────────────────────── card invoices ─────────────────────────

const monthName = (m) => E.monthLabel(m, true).split(' ')[0];

/**
 * Ask for card invoice closing dates. items from E.invoiceQuestions / E.invoiceItems.
 * prefill: start from the suggested date (during an update); otherwise only known dates are shown.
 * Resolves the changes as [{acc, month, close} | {acc, month, open} | {acc, month}] or null ("Later").
 */
export function askInvoiceDates(items, { title = 'Card invoices', prefill = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const today = E.todayISO();
    const rows = items.map(it => {
      const orig = { value: it.close || '', open: !it.close && !!it.open };
      return { it, orig, value: orig.value || (prefill && !orig.open ? it.suggestion : ''), open: orig.open };
    });
    const itemView = (st) => {
      const { it } = st;
      const preview = h('p.muted.small');
      const input = h('input', { type: 'date', value: st.value, min: `${it.month}-01`, max: `${it.month}-${String(E.daysInMonth(it.month)).padStart(2, '0')}`, disabled: st.open, 'aria-label': `${accountName(it.acc)} ${monthName(it.month)} invoice closed on`,
        oninput: (e) => { st.value = e.target.value; update(); } });
      const update = () => {
        if (st.open) { preview.textContent = `Everything so far counts in ${monthName(it.month)}.`; return; }
        if (!st.value) { preview.textContent = 'No date yet: purchases count in the month of their date.'; return; }
        if (st.value.slice(0, 7) !== it.month) { preview.textContent = `Pick a day in ${E.monthLabel(it.month, true)}.`; return; }
        const after = it.rows.filter(r => r.date > st.value);
        preview.textContent = after.length
          ? `${after.length} purchase${after.length === 1 ? '' : 's'} after that day (${fmt(-after.reduce((a, r) => a + r.amt, 0))}) count in ${monthName(E.addMonths(it.month, 1))}.`
          : `All of ${monthName(it.month)}'s purchases so far are on this invoice.`;
      };
      update();
      const hint = it.basis === 'bill' ? `Suggested ${shortDate(it.suggestion)}: matches the bill of ${fmt(it.bill)}`
        : it.basis === 'last' ? `Suggested ${shortDate(it.suggestion)}: same day as last month` : `Suggested ${shortDate(it.suggestion)}`;
      return h('div.stack-sm',
        h('h3', `${accountName(it.acc)} · ${monthName(it.month)} invoice`),
        field('Closed on', input, it.close ? null : hint),
        it.canBeOpen ? h('label.check', h('input', { type: 'checkbox', checked: st.open, onchange: (e) => { st.open = e.target.checked; input.disabled = st.open; update(); } }), 'Not closed yet') : null,
        preview);
    };
    const sheet = openSheet({
      title, subtitle: 'When did they close?', tall: items.length > 2,
      body: h('div.stack',
        h('p.muted.small', 'The closing date is on the card invoice in George. Purchases up to and including that day count in that month; later ones count in the next month.'),
        rows.map(itemView)),
      footer: [
        h('button.btn.ghost', { type: 'button', onclick: () => { done = true; sheet.close(); resolve(null); } }, prefill ? 'Later' : 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: () => {
          const bad = rows.find(st => !st.open && st.value && st.value.slice(0, 7) !== st.it.month);
          if (bad) { toast(`Pick a day in ${E.monthLabel(bad.it.month, true)} for the ${accountName(bad.it.acc)} invoice`, { kind: 'warn' }); return; }
          const out = [];
          for (const st of rows) {
            const { it, orig } = st;
            if (st.open) { out.push({ acc: it.acc, month: it.month, open: today }); continue; }
            if (st.value && st.value !== orig.value) out.push({ acc: it.acc, month: it.month, close: st.value });
            else if (!st.value && (orig.value || orig.open)) out.push({ acc: it.acc, month: it.month });
          }
          done = true; sheet.close(); resolve(out);
        } }, 'Save'),
      ],
      onClose: () => { if (!done) resolve(null); },
    });
  });
}

/** Settings → Accounts → card: every invoice month so far. */
export function openInvoiceDates(accId) {
  return askInvoiceDates(E.invoiceItems(app.state, accId), { title: `${accountName(accId)} invoices`, prefill: false }).then(saveInvoiceDates);
}

function saveInvoiceDates(entries) {
  if (!entries || !entries.length) return;
  let moved = 0;
  mutate(s => { moved = E.setInvoiceDates(s, entries); }, { label: null, message: 'Card invoice dates' });
  toast(moved ? `Saved · ${moved} card purchase${moved === 1 ? '' : 's'} moved to ${moved === 1 ? 'its' : 'their'} invoice month` : 'Closing dates saved',
    { actions: [['Undo', () => undoLast()]], ms: 6000 });
}

/** Missing closing dates, and invoices whose purchases do not add up to the bill. */
function invoiceCard() {
  if (typeof E.invoiceQuestions !== 'function') return null;
  const q = E.invoiceQuestions(app.state);
  const off = E.invoiceChecks(app.state).filter(x => !x.ok);
  if (!q.length && !off.length) return null;
  return h('section.card',
    h('div.section-head', h('h2', 'Card invoices'), h('span.muted.small', 'closing dates')),
    q.length ? [
      h('p', `Closing date missing: ${q.map(x => `${accountName(x.acc)} ${monthName(x.month)}`).join(', ')}.`),
      h('p.muted.small', 'Until then, late-month card purchases count in the month of their date.'),
      h('button.btn.primary.wide', { type: 'button', onclick: () => askInvoiceDates(q).then(saveInvoiceDates) }, 'Enter closing dates'),
    ] : null,
    off.map(x => h('div.stack-sm',
      h('p.notice.warn', icon('alert', 'sm'), `${accountName(x.acc)} ${monthName(x.month)} invoice: the bill is ${fmt(x.bill)}, but the purchases up to ${shortDate(x.close)} add up to ${fmt(x.sum)}.`),
      x.fix ? null : h('p.muted.small', 'No closing date makes them match: a purchase may be missing or doubled.'),
      h('div.btn-row',
        x.fix ? h('button.btn.small.primary', { type: 'button', onclick: () => saveInvoiceDates([{ acc: x.acc, month: x.month, close: x.fix }]) }, `Use ${shortDate(x.fix)}`) : null,
        h('button.btn.small.ghost', { type: 'button', onclick: () => askInvoiceDates(E.invoiceItems(app.state, x.acc).filter(i => i.month === x.month), { prefill: false }).then(saveInvoiceDates) }, 'Change date')))));
}

// ───────────────────────── balance check ─────────────────────────

function balanceCard() {
  const rec = calc().rec;
  const lastImport = (app.state.imports || []).at(-1);
  if (!lastImport) return null;
  const accs = app.state.accounts;
  const rows = accs.map(a => {
    const expected = rec.balances[a.id];
    const last = rec.lastCheck[a.id];
    const fresh = last && last.at >= lastImport.at && last.app === expected;
    return h('div.balance-row',
      h('div.grow', h('strong', a.name), h('span.muted.small.block', a.kind === 'card' ? `Balance ${fmt(expected)}${expected < 0 ? ` (you owe ${fmt(-expected)})` : ''}` : `Balance ${fmt(expected)}`)),
      fresh ? (Math.abs(last.diff) < 1 ? h('span.status.good', icon('check', 'sm'), 'matches') : h('span.status.bad', icon('alert', 'sm'), `${fmt(last.diff, { sign: true })} off`))
        : h('div.btn-row.tight',
          h('button.btn.small', { type: 'button', onclick: () => mutate(s => E.recordCheck(s, a.id, expected), { label: 'Balance confirmed' }) }, 'Matches'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => enterBalance(a, expected) }, 'Differs')));
  });
  return h('section.card',
    h('div.section-head', h('h2', 'Balance check'), h('span.muted.small', 'optional')),
    h('p.muted.small', 'Does George show the same balance right now?'),
    rows,
    h('p.muted.small', 'If a balance differs, a transaction is missing or doubled. Import a fresh export: known ones are skipped, missing ones are added.'));
}

function enterBalance(a, expected) {
  const input = h('input', { type: 'text', inputmode: 'decimal', placeholder: a.kind === 'card' ? 'e.g. -312,40' : 'e.g. 3.212,40' });
  const sheet = openSheet({
    title: `${a.name} in George`, subtitle: `The app expects ${fmt(expected)}`,
    body: h('div', field(a.kind === 'card' ? 'Card balance (negative when you owe)' : 'Current balance', input)),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      const v = E.toCents(input.value); if (v === null) { input.focus(); return; }
      sheet.close();
      let diff;
      mutate(s => { diff = E.recordCheck(s, a.id, v); }, { label: null });
      toast(Math.abs(diff) < 1 ? 'Matches George' : `Difference ${fmt(diff, { sign: true })}: look for a missing or doubled transaction`, { kind: Math.abs(diff) < 1 ? '' : 'warn', ms: 8000 });
    } }, 'Check')],
  });
  setTimeout(() => input.focus(), 60);
}

// ───────────────────────── review ─────────────────────────

const COUNTRY = { IT: 'Italy', HR: 'Croatia', CZK: 'Prague', CZ: 'Czechia', DE: 'Germany', CH: 'Switzerland', CHF: 'Switzerland', SI: 'Slovenia', HU: 'Hungary', SK: 'Slovakia', FR: 'France', ES: 'Spain', GR: 'Greece', NL: 'Netherlands', BE: 'Belgium', PL: 'Poland', GB: 'UK', GBP: 'UK', US: 'USA', USD: 'USA', FX: 'abroad' };

/** "7–10 Sept", "29 Aug–2 Sept", "7 Sept" */
export function dateRange(from, to) {
  const a = new Date(from + 'T12:00:00'), b = new Date(to + 'T12:00:00');
  const mon = (d) => d.toLocaleDateString('en-GB', { month: 'short' });
  if (from === to) return `${a.getDate()} ${mon(a)}`;
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${mon(b)}`;
  return `${a.getDate()} ${mon(a)}–${b.getDate()} ${mon(b)}`;
}

/** Clusters of review items that look like one trip: dated close together, with payments abroad. */
export function findTrips(q) {
  const cand = q.filter(t => !t.dupOf && !t.pre && t.amt < 0 && (E.abroadHint(t) || (t.type === 'expense' && !t.cat))).sort((a, b) => a.date.localeCompare(b.date));
  const clusters = [];
  let cur = [];
  for (const t of cand) {
    if (cur.length && (Date.parse(t.date) - Date.parse(cur[cur.length - 1].date)) / 86400000 > 2) { clusters.push(cur); cur = []; }
    cur.push(t);
  }
  if (cur.length) clusters.push(cur);
  return clusters.map(items => {
    const places = items.map(E.abroadHint).filter(Boolean);
    if (places.length < 2 || items.length < 3) return null;
    const top = Object.entries(places.reduce((m, p) => (m[p] = (m[p] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(([p]) => COUNTRY[p] || p).filter((v, i, a) => a.indexOf(v) === i).filter(x => x !== 'abroad');
    const from = items[0].date, to = items[items.length - 1].date;
    const name = `${top.slice(0, 2).join(' & ') || 'Trip'} ${dateRange(from, to)}`;
    return { items, name, total: items.reduce((s, t) => s + t.amt, 0), from, to };
  }).filter(Boolean);
}

const complete = (t) => !t.dupOf && ((t.type !== 'expense' && t.type !== 'income') || !!t.cat);
/** Safe to confirm in bulk: complete, not an "always check" rule, not a large bucket amount. */
const bulkOk = (t) => complete(t) && t.rev !== 2 && !(t.type === 'expense' && Math.abs(t.amt) >= 15000);

function reviewSection(q) {
  if (!q.length) {
    return h('section.card', empty('Nothing to review', (app.state.imports || []).length ? 'Everything new was filed by your rules.' : 'After your first import, anything the rules could not file shows up here.'));
  }
  const sel = app.sel || (app.sel = new Set());
  for (const id of [...sel]) if (!q.some(t => t.id === id)) sel.delete(id);
  const selecting = app.selecting;
  const trips = selecting ? [] : findTrips(q);
  const inTrip = new Set(trips.flatMap(tr => tr.items.map(t => t.id)));
  const rest = q.filter(t => !inTrip.has(t.id));
  const acceptable = rest.filter(bulkOk);
  const head = h('div.section-head',
    h('h2', `To review · ${q.length}`),
    h('button.link', { type: 'button', onclick: () => { app.selecting = !selecting; if (!app.selecting) sel.clear(); render(); } }, selecting ? 'Done' : 'Select'));
  const blocks = [head];
  if (!selecting && acceptable.length > 1) {
    blocks.push(h('button.btn.wide', { type: 'button', onclick: () => {
      mutate(s => { for (const t of acceptable) E.decide(s, t.id, {}); }, { label: null });
      toast(`${acceptable.length} suggestions accepted`, { actions: [['Undo', () => undoLast()]] });
    } }, icon('check'), `Accept ${acceptable.length} suggestions`));
    blocks.push(h('p.muted.small', 'Cash withdrawals, possible duplicates and large amounts are left for you to look at one by one.'));
  }
  for (const trip of trips) blocks.push(tripCard(trip));
  if (selecting) {
    blocks.push(h('div.bulkbar',
      h('span', `${sel.size} selected`),
      h('button.link', { type: 'button', onclick: () => { q.forEach(t => sel.add(t.id)); render(); } }, 'All'),
      h('button.btn.small.primary', { type: 'button', disabled: !sel.size, onclick: () => openCategorize([...sel], { onDone: () => { sel.clear(); app.selecting = false; } }) }, 'File selected…')));
  }
  blocks.push(h('ul.review', (selecting ? q : rest).map(t => reviewItem(t, selecting, sel))));
  return h('section.card', blocks);
}

function tripCard(trip) {
  const list = h('ul.review.trip-items', { hidden: true }, trip.items.map(t => reviewItem(t, false, new Set())));
  const toggle = h('button.link.small', { type: 'button', onclick: () => { list.hidden = !list.hidden; toggle.textContent = list.hidden ? `Show the ${trip.items.length} payments` : 'Hide payments'; } }, `Show the ${trip.items.length} payments`);
  return h('div.trip',
    h('div.trip-head', icon('trip'),
      h('div.grow', h('strong', `Trip? ${dateRange(trip.from, trip.to)}`), h('p.muted.small', `${trip.items.length} payments · ${fmt(trip.total)}`)),
      h('button.btn.small.primary', { type: 'button', onclick: () => bookTrip(trip) }, 'Book as trip')),
    toggle, list);
}

function bookTrip(trip) {
  const input = h('input', { type: 'text', value: trip.name, maxlength: 60 });
  const sheet = openSheet({
    title: 'Book as a trip', subtitle: `${trip.items.length} payments · ${fmt(trip.total)}`,
    body: h('div.stack-sm', h('p.muted', 'They become one-offs outside the monthly buckets, grouped under this name. If you move money from savings to pay for it, file that transfer as a one-off with the same name: the trip then nets to zero.'),
      field('Trip name', input), h('ul.txlist.compact', trip.items.map(t => txnRow(t, {})))),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      sheet.close();
      const tag = input.value.trim() || trip.name;
      mutate(s => { for (const t of trip.items) E.decide(s, t.id, { type: 'oneoff', tag }); }, { label: null });
      toast(`${trip.items.length} payments booked as “${tag}”`, { actions: [['Undo', () => undoLast()]] });
    } }, 'Book as trip')],
  });
}

function reviewItem(t, selecting, sel) {
  const suggestion = t.dupOf ? 'Duplicate?' : complete(t) ? describeCategory(t) : 'Pick a bucket';
  const accept = () => {
    mutate(s => E.decide(s, t.id, {}), { label: null });
    toast(`Filed: ${describeCategory({ ...t })}`, { actions: [['Undo', () => undoLast()]] });
  };
  return h('li.ritem', { class: sel.has(t.id) ? 'selected' : '' },
    selecting ? h('input.sel', { type: 'checkbox', checked: sel.has(t.id), 'aria-label': 'Select', onchange: (e) => { if (e.target.checked) sel.add(t.id); else sel.delete(t.id); render(); } }) : null,
    h('button.ritem-main', { type: 'button', onclick: () => selecting ? (sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id), render()) : openTxn(t.id) },
      h('span.ritem-top', h('span.tx-title', E.describeTxn(t, app.state)), h('span.tx-amt', { class: t.amt > 0 ? 'pos' : '' }, fmt(t.amt, { sign: true }))),
      h('span.tx-meta', `${accountName(t.src)} · ${shortDate(t.date)}${t.bm !== E.ym(t.date) ? ` · counts in ${E.monthLabel(t.bm)}` : ''}`),
      t.purpose ? h('span.tx-purpose', t.purpose) : null,
      h('span.flag.warn', icon('alert', 'sm'), t.dupOf ? 'Same amount and date as an earlier entry' : (t.hint || 'To review'))),
    selecting ? null : h('div.ritem-actions',
      t.pre ? h('button.btn.small', { type: 'button', onclick: () => mutate(s => E.dropDuplicate(s, t.id), { label: 'Removed' }) }, 'Remove') : null,
      t.dupOf ? h('button.btn.small', { type: 'button', onclick: () => openTxn(t.id) }, 'Compare') :
        complete(t) ? h('button.btn.small.primary', { type: 'button', onclick: accept }, icon('check', 'sm'), suggestion) : null,
      h('button.btn.small.ghost', { type: 'button', onclick: () => openCategorize([t.id]) }, complete(t) && !t.dupOf ? 'Change' : 'Pick…')));
}

function historyCard() {
  const st = app.state;
  const items = [...(st.imports || []), ...(st.undoneImports || []).map(u => ({ ...u, isUndone: true }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  if (!items.length) return null;
  const anyUndoable = items.some(i => !i.isUndone && undoable(i.id));
  const accounts = (i) => [...new Set((i.files || []).map(f => st.accounts.some(a => a.id === f.accountId) ? accountName(f.accountId) : 'other account'))].join(' + ');
  return h('section.card',
    h('h3', 'Recent updates'),
    h('ul.plain', items.map(i => h('li',
      h('div.grow',
        h('span.block', when(i.at), i.isUndone ? h('span.pill', 'undone') : null),
        h('span.muted.small.block', [accounts(i), i.isUndone ? `${i.removed} removed on ${when(i.undone)}` : `${i.added} new · ${i.known} known`].filter(Boolean).join(' · '))),
      !i.isUndone && undoable(i.id)
        ? h('button.link.small', { type: 'button', 'aria-label': `Undo the import of ${when(i.at)}`, onclick: () => confirmUndo(i.id) }, icon('undo', 'sm'), 'Undo')
        : null))),
    anyUndoable ? h('p.muted.small', 'Imported the wrong files? Undo that import, then import the right ones.') : null);
}
