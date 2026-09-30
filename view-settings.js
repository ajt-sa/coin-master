// Settings: budget plan (versioned by month), rules, loans, accounts & balances, sync & security, backup, help.
import * as E from './engine.js';
import * as C from './crypto.js';
import { h, icon, chip, openSheet, toast, field, empty, confirmSheet, relTime, segmented } from './ui.js';
import { app, isOwner, mutate, render, calc, publishNow, reloadRemote, forgetDevice, changePassphrase, replaceState, connectGitHub } from './app.js';
import { openRuleEditor, describeRule, describeAction, txnRow, openTxn, accountName, catName } from './txn-ui.js';
import * as VU from './view-update.js'; // namespace import: the invoice-dates sheet lives in Update

const fmt = E.fmt;

export function renderSettings() {
  if (!isOwner()) return viewerSettings();
  const loansOpen = E.loanSummary(app.state).filter(l => l.open).length;
  const rows = [
    ['wallet', 'Budget plan', 'Buckets and monthly amounts, from a chosen month on', openTemplate],
    ['rule', 'Rules', `${app.state.rules.filter(r => r.on !== false).length} active: how new transactions get filed`, openRules],
    ['tag', 'Loans & pending returns', loansOpen ? `${loansOpen} open` : 'None open', openLoans],
    ['bank', 'Accounts & balance check', 'Girokonto and cards, money-left breakdown', openAccounts],
    ['cloud', 'Sync & security', app.cfg.local ? 'Only on this phone: connect GitHub' : `${app.cfg.owner}/${app.cfg.repo}`, openSync],
    ['file', 'Backup', 'Download or restore everything', openBackup],
    ['eye', 'How it works', 'The 2-minute monthly routine', openHelp],
  ];
  return h('div.stack',
    h('section.card.menu', rows.map(([ic, title, sub, fn]) => h('button.row-btn', { type: 'button', onclick: fn }, icon(ic), h('span.grow', h('strong', title), h('span.muted.small.block', sub)), icon('right', 'chev')))),
    h('p.muted.small.center', `Coin Master · data rev ${app.state.meta?.rev || 0}`));
}

function viewerSettings() {
  return h('div.stack',
    h('section.card',
      h('h2', 'View-only phone'),
      h('p.muted', `Numbers update whenever the budget is published. Last update ${relTime(app.state.meta?.updated)}.`),
      h('button.btn.wide', { type: 'button', onclick: () => reloadRemote(true) }, icon('loop'), 'Refresh now')),
    h('section.card', h('h3', 'How to read it'),
      h('p', h('strong', 'Money left'), ' is what remains of this month once everything booked so far is counted, including what was carried over from last month.'),
      h('p', h('strong', 'Buckets'), ' show each budget line: how much is left. Red means over budget.'),
      h('p', h('strong', 'Outside the budget'), ' are trips, one-offs and transfers from savings. They do not touch the buckets.')),
    h('section.card', h('button.btn.danger.ghost.wide', { type: 'button', onclick: async () => {
      if (await confirmSheet({ title: 'Forget this phone?', message: 'Removes the passphrase and the saved copy from this phone. You can set it up again any time.', confirm: 'Forget', danger: true })) forgetDevice();
    } }, 'Forget this phone')));
}

// ───────────────────────── budget plan ─────────────────────────

function openTemplate() {
  const cur = E.ym(E.todayISO()) < app.state.settings.startMonth ? app.state.settings.startMonth : E.ym(E.todayISO());
  let from = cur;
  let lines, income;
  const load = () => { const t = E.templateFor(app.state, from); lines = { ...t.lines }; income = { ...(t.income || {}) }; };
  load();
  const sheet = openSheet({ title: 'Budget plan', tall: true, body: () => '' });
  const cats = () => app.state.cats;
  const draw = () => {
    const versions = (app.state.templates || []).map(v => v.from).sort();
    const amountInput = (obj, id) => h('input.amount', {
      type: 'text', inputmode: 'decimal', value: ((obj[id] || 0) / 100).toFixed(2), 'aria-label': 'Amount',
      // typing updates totals in place; no redraw, so tapping Save right after typing always works
      oninput: (e) => { const v = E.toCents(e.target.value); if (v === null || v < 0) return; if (v === 0 && obj === lines) delete obj[id]; else obj[id] = v; updateTotals(); },
      onchange: (e) => { e.target.value = ((obj[id] || 0) / 100).toFixed(2); },
    });
    const allocBox = h('div.alloc');
    const catTotals = new Map();
    const updateTotals = () => {
      const total = Object.values(lines).reduce((s, v) => s + v, 0);
      const incTotal = Object.values(income).reduce((s, v) => s + v, 0);
      const diff = incTotal - total;
      allocBox.className = 'alloc ' + (diff === 0 ? 'ok' : 'warn');
      allocBox.replaceChildren(
        h('span', 'Planned income ', h('strong', fmt(incTotal))),
        h('span', 'Budgeted ', h('strong', fmt(total))),
        h('span', diff === 0 ? 'Every euro has a job ✓' : diff > 0 ? `${fmt(diff)} not yet assigned` : `${fmt(-diff)} more budgeted than planned income`));
      for (const [c, el] of catTotals) el.textContent = fmt(c.subs.reduce((s, x) => s + (lines[x.id] || 0), 0), { round: true });
    };
    const totalEl = (c) => { const el = h('span.muted.small'); catTotals.set(c, el); return el; };
    const body = h('div.stack-sm',
      h('div.chips.wrap', h('span.chips-label', 'Applies from'),
        [cur, E.addMonths(cur, 1), E.addMonths(cur, 2)].map(m => chip(E.monthLabel(m), { on: m === from, onclick: () => { from = m; load(); draw(); } }))),
      h('p.muted.small', `Earlier months keep the plan they had. Versions: ${versions.map(v => E.monthLabel(v)).join(', ')}.`),
      allocBox,
      cats().filter(c => !c.income).map(c => h('details.catgroup', { open: true },
        h('summary', h('span.grow', c.name), totalEl(c)),
        c.subs.map(sb => h('div.plan-row',
          h('button.link.plan-name', { type: 'button', onclick: () => editSub(c, sb, draw) }, sb.name, h('span.muted.small', sb.variable ? ' · day-to-day' : ' · fixed')),
          amountInput(lines, sb.id))),
        h('button.link.small', { type: 'button', onclick: () => addSub(c, (id) => { lines[id] = 0; draw(); }) }, icon('plus', 'sm'), `Add to ${c.name}`))),
      h('button.link', { type: 'button', onclick: () => addMain(draw) }, icon('plus', 'sm'), 'Add a main category'),
      h('details.catgroup', { open: true }, h('summary', 'Planned income'),
        cats().find(c => c.income).subs.map(sb => h('div.plan-row', h('span.plan-name', sb.name), amountInput(income, sb.id)))),
    );
    updateTotals();
    sheet.set({
      title: 'Budget plan', subtitle: `From ${E.monthLabel(from, true)} on`,
      body,
      footer: [h('button.btn.primary', { type: 'button', onclick: () => {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        const clean = Object.fromEntries(Object.entries(lines).filter(([, v]) => v > 0));
        sheet.close();
        mutate(s => E.setTemplate(s, from, clean, { ...income }), { label: `Plan saved from ${E.monthLabel(from)}` });
      } }, `Save from ${E.monthLabel(from)}`)],
    });
  };
  draw();
}

function editSub(cat, sub, redraw) {
  const name = h('input', { type: 'text', value: sub.name, maxlength: 40 });
  let variable = !!sub.variable;
  const kind = h('div');
  const drawKind = () => kind.replaceChildren(segmented([['day', 'Day-to-day'], ['fixed', 'Fixed cost']], variable ? 'day' : 'fixed', (v) => { variable = v === 'day'; drawKind(); }));
  drawKind();
  const sheet = openSheet({
    title: 'Bucket', subtitle: cat.name,
    body: h('div.stack-sm', field('Name', name), field('Kind', kind, 'Day-to-day buckets show on the first dashboard tab.')),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      const n = name.value.trim(); if (!n) return;
      sheet.close();
      mutate(s => { const x = s.cats.find(c => c.id === cat.id).subs.find(y => y.id === sub.id); x.name = n; if (variable) x.variable = true; else delete x.variable; }, { label: 'Bucket updated' });
      redraw();
    } }, 'Save')],
  });
}

function addSub(cat, onAdded) {
  const name = h('input', { type: 'text', placeholder: 'e.g. Car insurance', maxlength: 40 });
  const sheet = openSheet({
    title: `New bucket in ${cat.name}`, body: field('Name', name),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      const n = name.value.trim(); if (!n) return;
      const id = `${cat.id}.${E.norm(n).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'x'}${Date.now().toString(36).slice(-3)}`;
      sheet.close();
      mutate(s => { s.cats.find(c => c.id === cat.id).subs.push({ id, name: n }); }, { label: null });
      onAdded(id);
    } }, 'Add')],
  });
  setTimeout(() => name.focus(), 60);
}

function addMain(redraw) {
  const name = h('input', { type: 'text', placeholder: 'e.g. Kids', maxlength: 40 });
  const sheet = openSheet({
    title: 'New main category', body: field('Name', name, 'Then add buckets to it.'),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      const n = name.value.trim(); if (!n) return;
      const id = E.norm(n).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) + Date.now().toString(36).slice(-3);
      sheet.close();
      mutate(s => { const inc = s.cats.findIndex(c => c.income); s.cats.splice(inc < 0 ? s.cats.length : inc, 0, { id, name: n, subs: [] }); }, { label: null });
      redraw();
    } }, 'Add')],
  });
  setTimeout(() => name.focus(), 60);
}

// ───────────────────────── rules ─────────────────────────

function openRules() {
  let q = '';
  const listHost = h('div');
  const counts = new Map();
  for (const t of app.state.txns) if (!t.arch && t.rule) counts.set(t.rule, (counts.get(t.rule) || 0) + 1);
  const drawList = () => {
    const rules = E.sortedRules({ rules: app.state.rules.map(r => ({ ...r, on: true })) });
    const shown = rules.filter(r => !q || E.norm(`${r.name} ${describeRule(r)} ${describeAction(r.act)}`).includes(E.norm(q)));
    listHost.replaceChildren(shown.length ? h('ul.rules', shown.map(r0 => {
      const r = app.state.rules.find(x => x.id === r0.id);
      return h('li', h('button.rule', { type: 'button', class: r.on === false ? 'off' : '', onclick: () => openRuleEditor(r) },
        h('span.rule-name', r.name || 'Unnamed rule', r.origin === 'system' ? h('span.pill', 'system') : r.origin === 'user' ? h('span.pill.accent', 'yours') : null, r.on === false ? h('span.pill', 'off') : null),
        h('span.rule-when', describeRule(r)),
        h('span.rule-then', '→ ', describeAction(r.act), counts.get(r.id) ? h('span.muted', ` · filed ${counts.get(r.id)}`) : null)));
    })) : empty('No rules match'));
  };
  const search = h('input.search', { type: 'search', placeholder: 'Search rules', oninput: (e) => { q = e.target.value; drawList(); } });
  drawList();
  openSheet({
    title: 'Rules', subtitle: 'The most specific matching rule wins. Your own rules win ties.', tall: true,
    body: h('div.stack-sm', h('div.searchbox', icon('search'), search), listHost),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => openRuleEditor({ id: E.newId('r'), name: '', conds: [{ f: 'cp', op: 'contains', v: '' }], act: { type: 'expense', cat: null, bm: 'date' }, prio: 0, origin: 'user', on: true }, { isNew: true }) }, icon('plus', 'sm'), 'New rule')],
  });
  app.redrawSheets.add(drawList);
}

// ───────────────────────── loans ─────────────────────────

function openLoans() {
  const sheet = openSheet({ title: 'Loans & pending returns', tall: true, body: () => '' });
  const draw = () => {
    const loans = E.loanSummary(app.state);
    sheet.set({
      body: loans.length ? h('ul.plain.loans', loans.map(L => h('li', h('button.row-btn', { type: 'button', onclick: () => openLoan(L.id) },
        h('span.grow', h('strong', L.name), h('span.muted.small.block', `${E.monthLabel(L.month)} · ${L.txs.length} transaction${L.txs.length === 1 ? '' : 's'}${L.closed ? ` · closed${L.keptCat ? ', kept in ' + catName(L.keptCat) : ''}` : ''}`)),
        h('span.amt', { class: L.balance < 0 ? 'neg' : 'pos' }, fmt(L.balance, { sign: true })), icon('right', 'chev'))))) :
        empty('No loans', 'Mark a transaction as “Loan” (e.g. an order you will partly return), or start the bank purpose with “Loan: name” / “Loan Return: name”.'),
    });
  };
  draw();
  app.redrawSheets.add(draw);
}

function openLoan(id) {
  const sheet = openSheet({ title: '', body: () => '' });
  const draw = () => {
    const L = E.loanSummary(app.state).find(x => x.id === id);
    if (!L) { sheet.close(); return; }
    const inc = new Set();
    sheet.set({
      title: L.name, subtitle: `${E.monthLabel(L.month, true)} · balance ${fmt(L.balance, { sign: true })}`,
      body: h('div.stack-sm',
        h('p.muted', L.closed ? (L.keptCat ? `Closed. ${fmt(-L.balance)} counts in ${catName(L.keptCat)}.` : 'Closed.') : 'Open: counts under “Outside the budget” until closed. Refunds and returns with the same name join it automatically.'),
        h('ul.txlist', L.txs.map(t => txnRow(t, { onclick: () => openTxn(t.id) })))),
      footer: L.closed ? [h('button.btn', { type: 'button', onclick: () => mutate(s => { const x = s.loans.find(y => y.id === id); x.closed = false; x.keptCat = null; }, { label: 'Reopened' }) }, 'Reopen')] :
        [h('button.btn.primary', { type: 'button', onclick: () => closeLoan(L) }, 'Close loan…')],
    });
  };
  draw();
  app.redrawSheets.add(draw);
}

function closeLoan(L) {
  const idx = E.subIndex(app.state);
  const sheet = openSheet({
    title: `Close “${L.name}”`, subtitle: L.balance === 0 ? 'Fully repaid' : `${fmt(-L.balance)} not coming back`,
    body: h('div.stack-sm',
      L.balance === 0 ? h('p.muted', 'Nothing left over: it simply disappears from the month.') : h('p.muted', 'Where does the part you keep count?'),
      L.balance !== 0 ? h('div.bucket-grid', [...idx.values()].filter(s => !s.income).map(s => h('button.bucket-btn', { type: 'button', onclick: () => { sheet.close(); mutate(st => { const x = st.loans.find(y => y.id === L.id); x.closed = true; x.keptCat = s.id; }, { label: `Closed · ${fmt(-L.balance)} in ${s.name}` }); } }, s.name))) : null,
      h('button.btn.wide', { type: 'button', onclick: () => { sheet.close(); mutate(st => { const x = st.loans.find(y => y.id === L.id); x.closed = true; x.keptCat = null; for (const t of st.txns) if (t.loan === L.id) t.type = 'oneoff'; }, { label: 'Closed as one-off' }); } }, L.balance === 0 ? 'Close' : 'Close as a one-off (outside the budget)')),
  });
}

// ───────────────────────── accounts ─────────────────────────

function openAccounts() {
  const sheet = openSheet({ title: 'Accounts & balance check', tall: true, body: () => '' });
  const draw = () => {
    const rec = calc().rec;
    const f = calc().months.get(rec.month);
    const line = (label, v, strong) => h('div.kv-line', { class: strong ? 'strong' : '' }, h('span', label), h('span.amt', fmt(v)));
    sheet.set({
      body: h('div.stack-sm',
        app.state.accounts.map(a => {
          const last = rec.lastCheck[a.id];
          return h('button.row-btn', { type: 'button', onclick: () => editAccount(a) },
            icon(a.kind === 'card' ? 'card' : 'bank'),
            h('span.grow', h('strong', a.name), h('span.muted.small.block',
              last ? `George ${fmt(last.bank)} on ${new Date(last.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${Math.abs(last.diff) < 1 ? ' ✓' : ` (${fmt(last.diff, { sign: true })})`}` : 'not compared with George yet',
              a.manual ? ' · added by hand' : '', invoiceNote(a))),
            h('span.amt', fmt(rec.balances[a.id])));
        }),
        h('h3', 'Money left, from the balances'),
        h('div.kv-lines',
          app.state.accounts.map(a => line(a.name, rec.balances[a.id])),
          line('Accounts together', rec.accountsTotal, true),
          rec.future ? line('Already booked to later months', -rec.future) : null,
          rec.transit ? line('Card bills in transit', -rec.transit) : null,
          line(`= Money left, ${E.monthLabel(rec.month)}`, rec.derived, true),
          f ? line('Budget says (carry-over chain)', f.closing) : null),
        rec.diff === 0 ? h('p.status.good', icon('check', 'sm'), 'The budget and the balances agree to the cent.') :
          h('p.notice.warn', `They differ by ${fmt(rec.diff)}. This should not happen: an account start balance may need fixing (tap the account).`),
        h('p.muted.small', 'This replaces Coin Master\'s “Error Check”. Balances start from the Coin Master figures for 31 July 2026 and add every imported transaction since.')),
    });
  };
  draw();
  app.redrawSheets.add(draw);
}

/** " · invoice closed 26 Aug" for cards */
function invoiceNote(a) {
  if (a.kind !== 'card' || !a.invoices) return '';
  const last = Object.entries(a.invoices).filter(([m, e]) => e.close && m >= app.state.settings.startMonth).sort().at(-1);
  return last ? ` · invoice closed ${new Date(last[1].close + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
}

function editAccount(a) {
  const name = h('input', { type: 'text', value: a.name, maxlength: 40 });
  const anchor = h('input', { type: 'text', inputmode: 'decimal', value: ((a.anchor?.cents || 0) / 100).toFixed(2) });
  const ids = h('input', { type: 'text', value: (a.ids || []).join(', ') });
  const manual = h('input', { type: 'checkbox', checked: !!a.manual });
  const sheet = openSheet({
    title: a.name, subtitle: a.anchor?.note || '',
    body: h('div.stack-sm',
      field('Name', name),
      field('File names contain', ids, 'Used to recognise which account an export belongs to (IBAN or last 4 card digits).'),
      a.kind === 'card' ? h('label.check', manual, 'No export for this card: I add its payments by hand (the card bill is then mirrored automatically)') : null,
      a.kind === 'card' && typeof VU.openInvoiceDates === 'function' ? h('button.row-btn', { type: 'button', onclick: () => VU.openInvoiceDates(a.id) },
        icon('calendar'), h('span.grow', h('strong', 'Invoice closing dates'), h('span.muted.small.block', 'Purchases after the closing day count in the next month')), icon('right', 'chev')) : null,
      h('details', h('summary', 'Start balance (advanced)'),
        field('Balance before the first imported transaction', anchor, 'Only change this if the balance check is off from the start.'))),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => {
      const cents = E.toCents(anchor.value);
      sheet.close();
      mutate(s => {
        const x = s.accounts.find(y => y.id === a.id);
        x.name = name.value.trim() || x.name;
        x.ids = ids.value.split(',').map(v => v.trim()).filter(Boolean);
        if (x.kind === 'card') { if (manual.checked) x.manual = true; else delete x.manual; }
        if (cents !== null && cents !== (x.anchor?.cents || 0)) x.anchor = { ...(x.anchor || {}), cents, note: `Changed by hand ${E.todayISO()}` }; // keeps the start date
      }, { label: 'Account saved' });
    } }, 'Save')],
  });
}

// ───────────────────────── sync & security ─────────────────────────

function openSync() {
  const sheet = openSheet({ title: 'Sync & security', tall: true, body: () => '' });
  const draw = () => {
    const c = app.cfg;
    sheet.set({
      body: h('div.stack-sm',
        c.local ? h('div.notice.warn', 'Only on this phone. Connect GitHub so your wife\'s phone sees the numbers.') : null,
        c.local ? h('button.btn.primary.wide', { type: 'button', onclick: () => { sheet.close(); connectGitHub(); } }, 'Connect GitHub') :
          h('dl.kv',
            h('dt', 'Repository'), h('dd', `${c.owner}/${c.repo} (${c.branch || 'main'})`),
            h('dt', 'Data file'), h('dd', c.path || 'data/budget.enc.json'),
            h('dt', 'Access key'), h('dd', c.token ? `••••${c.token.slice(-4)}` : 'none'),
            h('dt', 'Last published'), h('dd', app.lastPublished ? relTime(app.lastPublished) : (app.dirty ? 'waiting…' : 'up to date')),
            app.syncError ? [h('dt', 'Problem'), h('dd.neg', app.syncError)] : null),
        c.local ? null : h('div.btn-row',
          h('button.btn', { type: 'button', onclick: () => publishNow() }, icon('cloud', 'sm'), 'Publish now'),
          h('button.btn.ghost', { type: 'button', onclick: () => reloadRemote(true) }, icon('loop', 'sm'), 'Reload')),
        c.local ? null : h('button.link', { type: 'button', onclick: () => replaceToken(draw) }, 'Replace the GitHub access key'),
        h('h3', 'Passphrase'),
        h('p.muted.small', 'Encrypts the data file. Your wife types it once on her phone. Changing it means she has to enter the new one.'),
        h('button.btn.wide', { type: 'button', onclick: () => changePassphraseSheet() }, icon('lock', 'sm'), 'Change passphrase'),
        h('h3', 'This phone'),
        h('button.btn.danger.ghost.wide', { type: 'button', onclick: async () => {
          if (await confirmSheet({ title: 'Forget this phone?', message: app.dirty ? 'There are unpublished changes on this phone. They will be lost.' : 'Removes the key, passphrase and saved copy from this phone. The published data stays on GitHub.', confirm: 'Forget', danger: true })) forgetDevice();
        } }, 'Forget this phone')),
    });
  };
  draw();
  app.redrawSheets.add(draw);
}

function replaceToken(redraw) {
  const input = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
  const sheet = openSheet({
    title: 'New GitHub access key', body: field('Fine-grained token with “Contents: Read and write” on this repository', input),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => { const v = input.value.trim(); if (!v) return; app.cfg.token = v; app.saveCfg(); sheet.close(); toast('Key saved'); publishNow(); redraw(); } }, 'Save')],
  });
}

function changePassphraseSheet() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'text', value: C.suggestPassphrase(), autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
  const strength = h('span.field-hint');
  const upd = () => { const s = C.passphraseStrength(next.value); strength.textContent = s.label; strength.className = 'field-hint ' + (s.ok ? '' : 'warn'); };
  next.addEventListener('input', upd); upd();
  const sheet = openSheet({
    title: 'Change passphrase',
    body: h('div.stack-sm', field('Current passphrase', cur), h('label.field', h('span.field-label', 'New passphrase'), next, strength),
      h('button.link.small', { type: 'button', onclick: () => { next.value = C.suggestPassphrase(); upd(); } }, 'Suggest another'),
      h('p.muted.small', 'Write it down somewhere safe (e.g. your password manager). Without it nobody, including you, can open the data.')),
    footer: [h('button.btn.primary', { type: 'button', onclick: async () => {
      if (!C.passphraseStrength(next.value).ok) { next.focus(); return; }
      try { await changePassphrase(cur.value, next.value); sheet.close(); toast('Passphrase changed. Enter the new one on your wife\'s phone.', { ms: 8000 }); }
      catch (e) { toast(e.message, { kind: 'warn' }); }
    } }, 'Change')],
  });
}

// ───────────────────────── backup ─────────────────────────

function openBackup() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const errs = E.validateState(obj);
      if (errs.length) throw new Error(errs.join(', '));
      if (await confirmSheet({ title: 'Restore this backup?', message: `${obj.txns.length} transactions, last changed ${obj.meta?.updated ? new Date(obj.meta.updated).toLocaleString('en-GB') : 'unknown'}. It replaces the current data on both phones.`, confirm: 'Restore', danger: true })) {
        replaceState(obj);
      }
    } catch (err) { toast('Not a valid backup: ' + err.message, { kind: 'warn' }); }
  } });
  openSheet({
    title: 'Backup',
    body: h('div.stack-sm',
      h('p.muted', 'GitHub keeps every published version of the encrypted file, so history is already safe. A backup file is readable without the passphrase: keep it private.'),
      h('button.btn.wide', { type: 'button', onclick: () => {
        const blob = new Blob([JSON.stringify(app.state, null, 1)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `coin-master-backup-${E.todayISO()}.json` });
        document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } }, icon('file', 'sm'), 'Download backup (unencrypted)'),
      input,
      h('button.btn.ghost.wide', { type: 'button', onclick: () => input.click() }, 'Restore from a backup file')),
  });
}

// ───────────────────────── help ─────────────────────────

function openHelp() {
  openSheet({
    title: 'How it works', tall: true,
    body: h('div.prose',
      h('h3', 'The routine (any time, as often as you like)'),
      h('ol',
        h('li', 'In George, export the transactions of this month so far (Excel) for the Girokonto and each credit card.'),
        h('li', 'Here: Update → Choose export files → select them all at once.'),
        h('li', 'Look at the few flagged ones. Most are one tap (✓). Done: your wife\'s phone shows the new numbers.')),
      h('h3', 'Why nothing is counted twice'),
      h('p', 'Every transaction gets a fingerprint from its date, amount, text and account. Known fingerprints are skipped, so overlapping exports are harmless. Two genuinely identical payments on one day are both kept. A payment that shows up late (e.g. Sunday → Tuesday) is added whenever it appears.'),
      h('h3', 'Decide once'),
      h('p', 'Whatever you decide for a transaction (bucket, one-off, month) is stored with it and never asked again. “Make it a rule” files similar ones automatically from then on.'),
      h('h3', 'Months'),
      h('p', 'Salaries arriving from the 15th on count for the next month, as in Coin Master. A purpose starting with a month name and a colon (“July: VFS fee”) counts in that month. Any transaction can be moved to another month from its detail sheet; the carry-over updates by itself.'),
      h('h3', 'Tags at the bank'),
      h('p', 'Your standing orders already carry unique purpose tags (MonthlyJKUParking …). Keep that habit for new ones, e.g. “MonthlyNewInsurance”: then a rule can match the tag instead of the amount.'),
      h('h3', 'Cards'),
      h('p', 'Card payments count in their bucket on the day you pay. The monthly card bill on the Girokonto is only a transfer. For a card without an export, add its payments with + under Activity; the bill is mirrored automatically.')),
  });
}
