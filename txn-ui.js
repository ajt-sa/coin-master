// Transaction rows, detail sheet, the categorise sheet ("just this once" / "make it a rule")
// and the rule editor. Shared by the dashboard, Update and Activity screens.
import * as E from './engine.js';
import { h, icon, chip, openSheet, closeAllSheets, toast, field, confirmSheet, shortDate } from './ui.js';
import { app, isOwner, mutate, calc, undoLast } from './app.js';

const fmt = E.fmt;
const TYPE_LABEL = { expense: 'Bucket', income: 'Income', transfer: 'Transfer', oneoff: 'One-off', loan: 'Loan', settle: 'Card bill', ignore: 'Ignored' };

export function accountName(id) {
  const a = app.state.accounts.find(x => x.id === id);
  return a ? a.name : id;
}
export function catName(id) {
  if (!id) return null;
  const s = E.subIndex(app.state).get(id);
  return s ? s.name : id;
}
export function describeCategory(t) {
  if (t.type === 'expense') return t.cat ? catName(t.cat) : 'Not sorted';
  if (t.type === 'income') return catName(t.cat) || 'Income';
  if (t.type === 'loan') { const L = (app.state.loans || []).find(l => l.id === t.loan); return `Loan${L ? ': ' + L.name : ''}`; }
  if (t.type === 'oneoff') return t.tag ? `One-off: ${t.tag}` : 'One-off';
  return TYPE_LABEL[t.type] || t.type;
}

export function txnRow(t, { onclick, selectable = false, selected = false, onselect } = {}) {
  const dateMonth = E.ym(t.date);
  const rebooked = t.bm && dateMonth !== t.bm;
  const meta = [describeCategory(t), accountName(t.src), shortDate(t.date)];
  return h('li.txrow', { class: [t.rev ? 'needs' : '', selected ? 'selected' : ''].join(' ') },
    selectable ? h('input.sel', { type: 'checkbox', checked: selected, 'aria-label': 'Select', onchange: (e) => onselect && onselect(e.target.checked) }) : null,
    h('button.txrow-main', { type: 'button', onclick },
      h('span.tx-text',
        h('span.tx-title', E.describeTxn(t)),
        h('span.tx-meta', meta.join(' · ')),
        (t.rev || rebooked || t.note) ? h('span.tx-flags',
          t.rev ? h('span.flag.warn', icon('alert', 'sm'), t.dupOf ? 'Possible duplicate' : (t.hint || 'To review')) : null,
          rebooked ? h('span.flag', icon('loop', 'sm'), `counts in ${E.monthLabel(t.bm)}`) : null,
          t.note ? h('span.flag', t.note) : null) : null),
      h('span.tx-amt', { class: t.amt > 0 ? 'pos' : '' }, fmt(t.amt, { sign: true }))));
}

function liveMonthsAround(m) {
  const start = app.state.settings.startMonth;
  const list = [E.addMonths(m, -1), m, E.addMonths(m, 1)].filter(x => x >= start);
  return [...new Set(list)];
}

// ───────────────────────── detail sheet ─────────────────────────

export function openTxn(id) {
  const sheet = openSheet({ title: '', body: () => '' });
  const draw = () => {
    const t = app.state.txns.find(x => x.id === id);
    if (!t) { sheet.close(); return; }
    const editable = isOwner() && !t.arch;
    const rule = t.rule && app.state.rules.find(r => r.id === t.rule);
    const source = t.arch ? (t.man ? 'Coin Master: your category (read-only)' : 'Archive: sorted by the new rules, for reference') : t.man ? 'You decided' : rule ? `Rule: ${rule.name || 'unnamed'}` : t.rule === 'sys-loan' ? 'Loan convention ("Loan: …")' : t.auto ? 'Created automatically' : '—';
    const rows = [
      ['Account', accountName(t.src)],
      ['Bank date', new Date(t.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })],
      editable && E.isCounted(t) ? null : ['Counts in', E.monthLabel(t.bm, true) + (t.bm !== E.ym(t.date) ? ' (re-booked)' : '')],
      ['Category', describeCategory(t)],
      ['Filed by', source],
      t.purpose ? ['Purpose', t.purpose] : null,
      t.iban || t.acct ? ['Partner account', [t.iban, t.acct].filter(Boolean).join(' · ')] : null,
      t.note ? ['Note', t.note] : null,
    ].filter(Boolean);
    sheet.set({
      title: E.describeTxn(t),
      subtitle: fmt(t.amt, { sign: true }),
      body: h('div.stack-sm',
        t.rev ? h('p.notice.warn', icon('alert', 'sm'), t.dupOf ? 'This looks like a duplicate of an earlier entry.' : (t.hint || 'Needs a look')) : null,
        editable && E.isCounted(t) ? h('div.chips', h('span.chips-label', 'Counts in'),
          liveMonthsAround(t.bm).map(mm => chip(E.monthLabel(mm), { on: mm === t.bm, onclick: () => { if (mm !== t.bm) mutate(s => E.decide(s, t.id, { bm: mm }), { label: `Now counts in ${E.monthLabel(mm, true)}` }); } }))) : null,
        h('dl.kv', rows.map(([k, v]) => [h('dt', k), h('dd', v)])),
        t.dupOf ? dupBlock(t) : null,
      ),
      footer: editable ? [
        h('button.btn.ghost', { type: 'button', onclick: () => openNote(t) }, 'Note'),
        h('button.btn.primary', { type: 'button', onclick: () => openCategorize([t.id]) }, 'Change'),
      ] : null,
    });
  };
  draw();
  sheet.redraw = draw;
  app.redrawSheets.add(draw);
  const close = sheet.close;
  sheet.close = () => { app.redrawSheets.delete(draw); close(); };
}

function dupBlock(t) {
  const orig = app.state.txns.find(x => x.id === t.dupOf);
  return h('div.dup',
    h('p.muted', 'Earlier entry'),
    orig ? h('ul.txlist', txnRow(orig, { onclick: () => openTxn(orig.id) })) : h('p.muted', '(removed)'),
    h('div.btn-row',
      h('button.btn.danger', { type: 'button', onclick: () => { mutate(s => E.dropDuplicate(s, t.id), { label: 'Duplicate removed' }); } }, 'Remove this duplicate'),
      h('button.btn.ghost', { type: 'button', onclick: () => mutate(s => { const x = s.txns.find(y => y.id === t.id); delete x.dupOf; x.hint = 'Kept (not a duplicate)'; if (x.type === 'expense' && !x.cat) x.rev = 1; else x.rev = 0; }) }, 'Keep both')));
}

function openNote(t) {
  const input = h('input', { type: 'text', value: t.note || '', placeholder: 'e.g. birthday present', maxlength: 120 });
  const sh = openSheet({
    title: 'Note', body: field('Visible on both phones', input),
    footer: [h('button.btn.primary', { type: 'button', onclick: () => { sh.close(); mutate(s => { const x = s.txns.find(y => y.id === t.id); if (input.value.trim()) x.note = input.value.trim(); else delete x.note; }); } }, 'Save')],
  });
  setTimeout(() => input.focus(), 50);
}

// ───────────────────────── categorise ─────────────────────────

function recentCats() {
  const seen = [];
  for (let i = app.state.txns.length - 1; i >= 0 && seen.length < 6; i--) {
    const t = app.state.txns[i];
    if (t.man && !t.arch && t.type === 'expense' && t.cat && !seen.includes(t.cat)) seen.push(t.cat);
  }
  for (const d of ['food.groceries', 'misc.misc', 'food.restaurants', 'transport.fuel']) if (seen.length < 6 && !seen.includes(d)) seen.push(d);
  return seen;
}

function knownTags() {
  const tags = new Set();
  for (const t of app.state.txns) if (t.tag && !t.arch) tags.add(t.tag);
  for (const L of app.state.loans || []) if (!L.closed) tags.add(L.name);
  return [...tags].slice(-12).reverse();
}

/**
 * Categorise one or more transactions. A tap on a bucket applies it immediately
 * ("just this once"); the toast then offers "Make it a rule".
 */
export function openCategorize(ids, { onDone } = {}) {
  const txs = ids.map(id => app.state.txns.find(t => t.id === id)).filter(Boolean);
  if (!txs.length) return;
  const single = txs.length === 1 ? txs[0] : null;
  const total = txs.reduce((s, t) => s + t.amt, 0);
  let mode = single ? (single.type === 'expense' || single.type === 'settle' || single.type === 'ignore' ? 'expense' : single.type) : (total > 0 ? 'transfer' : 'expense');
  let bm = single ? single.bm : null;
  const sheet = openSheet({ title: '', tall: true, body: () => '' });

  const apply = (changes, label) => {
    const act = { ...changes };
    if (single && bm && bm !== single.bm) act.bm = bm;
    closeAllSheets(); // the toast confirms; fewer taps than returning to the detail sheet
    mutate(s => { for (const t of txs) E.decide(s, t.id, act); }, { label: null });
    if (onDone) onDone();
    const actions = [['Undo', () => undoLast()]];
    if (single && !single.auto && ['expense', 'income', 'transfer', 'oneoff', 'ignore'].includes(act.type)) {
      actions.unshift(['Make it a rule', () => openRuleEditor(E.suggestRule(app.state, single, act), { isNew: true, fromTxn: single })]);
    }
    toast(label || (single ? 'Filed' : `${txs.length} filed`), { actions, ms: 6000 });
  };

  const draw = () => {
    const monthChips = single ? h('div.chips',
      h('span.chips-label', 'Counts in'),
      liveMonthsAround(single.bm).map(mm => chip(E.monthLabel(mm), { on: mm === bm, onclick: () => { bm = mm; draw(); } }))) : null;
    const typeChips = h('div.chips.wrap',
      [['expense', 'Bucket'], ['income', 'Income'], ['transfer', 'Transfer'], ['oneoff', 'One-off'], ['loan', 'Loan'], ['more', 'More…']].map(([k, label]) =>
        chip(label, { on: mode === k, onclick: () => { mode = k; draw(); } })));
    let body;
    if (mode === 'expense') {
      const idx = E.subIndex(app.state);
      body = h('div',
        h('p.label', 'Recent'),
        h('div.bucket-grid', recentCats().filter(id => idx.has(id)).map(id => bucketBtn(id, idx))),
        app.state.cats.filter(c => !c.income).map(c => h('details.catgroup', { open: single && single.cat && idx.get(single.cat)?.main === c.id ? true : undefined },
          h('summary', c.name),
          h('div.bucket-grid', c.subs.map(sb => bucketBtn(sb.id, idx))))));
    } else if (mode === 'income') {
      const inc = app.state.cats.find(c => c.income);
      body = h('div.bucket-grid', inc.subs.map(sb => h('button.bucket-btn', { type: 'button', class: single && single.cat === sb.id ? 'on' : '', onclick: () => apply({ type: 'income', cat: sb.id }, `Income: ${sb.name}`) }, sb.name)));
    } else if (mode === 'transfer') {
      body = h('div', h('p.muted', 'Money moved between your own accounts or from savings. It changes the month result but no bucket.'),
        h('button.btn.primary.wide', { type: 'button', onclick: () => apply({ type: 'transfer' }, 'Filed as transfer') }, 'File as transfer'));
    } else if (mode === 'oneoff' || mode === 'loan') {
      const input = h('input', { type: 'text', placeholder: mode === 'loan' ? 'e.g. Zalando order Sep' : 'e.g. Italy trip', value: single && single.tag ? single.tag : '', maxlength: 60 });
      const tags = knownTags();
      body = h('div',
        h('p.muted', mode === 'loan' ? 'A purchase you expect money back for, or money lent. Refunds with the same name close it; only what you keep counts.' : 'Outside the monthly budget, e.g. a trip or a big purchase funded from savings. Give it a name so its funding transfer can go under the same name.'),
        field(mode === 'loan' ? 'Loan name' : 'Name (optional)', input),
        tags.length ? h('div.chips.wrap', tags.map(tg => chip(tg, { onclick: () => { input.value = tg; } }))) : null,
        h('button.btn.primary.wide', { type: 'button', onclick: () => {
          const tag = input.value.trim();
          if (mode === 'loan' && !tag) { input.focus(); return; }
          apply(mode === 'loan' ? { type: 'loan', tag, loan: E.loanKey(tag) } : { type: 'oneoff', tag: tag || null }, mode === 'loan' ? `Loan: ${tag}` : 'Filed as one-off');
        } }, mode === 'loan' ? 'Save as loan' : 'File as one-off'));
    } else {
      body = h('div.stack-sm',
        h('button.row-btn', { type: 'button', onclick: () => apply({ type: 'settle' }, 'Filed as card bill') }, h('span.grow', h('strong', 'Card bill payment'), h('span.muted.small.block', 'Current account ↔ credit card. Never counted twice.'))),
        h('button.row-btn', { type: 'button', onclick: () => apply({ type: 'ignore' }, 'Ignored') }, h('span.grow', h('strong', 'Ignore'), h('span.muted.small.block', 'Leave out of every calculation (e.g. a bank notice).'))));
    }
    sheet.set({
      title: single ? E.describeTxn(single) : `${txs.length} transactions`,
      subtitle: single ? `${fmt(single.amt, { sign: true })} · ${accountName(single.src)} · ${shortDate(single.date)}` : `Together ${fmt(total, { sign: true })}`,
      body: h('div.stack-sm', single && single.purpose ? h('p.muted.small.clamp', single.purpose) : null, monthChips, typeChips, body),
    });
  };
  const bucketBtn = (id, idx) => h('button.bucket-btn', { type: 'button', class: single && single.cat === id ? 'on' : '', onclick: () => apply({ type: 'expense', cat: id }, `Filed to ${idx.get(id).name}`) }, idx.get(id).name);
  draw();
}

// ───────────────────────── rule editor ─────────────────────────

const FIELD_OPS = {
  cp: ['contains', 'word', 'startsWith', 'equals', 'notContains', 'regex'],
  purpose: ['contains', 'word', 'startsWith', 'equals', 'notContains', 'regex'],
  text: ['contains', 'word', 'notContains', 'regex'],
  iban: ['contains', 'equals'],
  src: ['is'],
  amt: ['between', 'lt', 'gt', 'sign'],
};
const OP_LABEL = { ...E.TEXT_OPS, ...E.AMT_OPS, is: 'is' };

export function describeRule(r) {
  const parts = r.conds.map(c => {
    const f = { cp: 'merchant', purpose: 'purpose', text: 'merchant or purpose', iban: 'partner account' }[c.f] || c.f;
    if (c.f === 'amt') {
      if (c.op === 'sign') return c.v === 'in' ? 'money in' : 'money out';
      if (c.op === 'between') return `amount ${fmt(c.v[0])} to ${fmt(c.v[1])}`;
      return `amount ${c.op === 'lt' ? 'below' : 'above'} ${fmt(c.v)}`;
    }
    if (c.f === 'src') return `paid from ${(Array.isArray(c.v) ? c.v : [c.v]).map(accountName).join(' or ')}`;
    const v = Array.isArray(c.v) ? (c.v.length > 3 ? `${c.v.slice(0, 3).join(', ')} … (+${c.v.length - 3})` : c.v.join(' / ')) : c.v;
    return `${f} ${OP_LABEL[c.op] || c.op} "${v}"`;
  });
  return parts.join(' and ');
}
export function describeAction(a) {
  const t = a.type === 'expense' ? (catName(a.cat) || 'a bucket (pick one)') : a.type === 'income' ? `Income: ${catName(a.cat)}` : (TYPE_LABEL[a.type] || a.type);
  const bm = a.bm === 'salary' ? ' · salary month' : a.bm === 'next' ? ' · next month' : '';
  return t + bm + (a.review ? ' · always check' : '');
}

export function openRuleEditor(rule, { isNew = false, fromTxn = null } = {}) {
  const r = structuredClone(rule);
  r.act = r.act || { type: 'expense', cat: null, bm: 'date' };
  const sheet = openSheet({ title: isNew ? 'New rule' : 'Edit rule', tall: true, body: () => '' });
  // Typing only updates the model and the live preview; the form is rebuilt only for
  // structural changes (field/operator/type), so a tap on "Save" is never lost to a redraw.
  const live = h('div.stack-sm');
  const saveBtn = h('button.btn.primary', { type: 'button', onclick: () => save() }, 'Save rule');
  let timer;
  const refresh = () => {
    const impact = E.ruleImpact(app.state, r);
    const warns = E.ruleWarnings(r);
    saveBtn.disabled = warns.length > 0 || !r.conds.length;
    live.replaceChildren(...[
      warns.length ? h('div.notice.warn', warns.map(w => h('p', w))) : null,
      h('div.impact',
        h('p', h('strong', `${impact.hits.length}`), ` transaction${impact.hits.length === 1 ? '' : 's'} match`, impact.differs.length ? ` · ${impact.differs.length} of them you filed differently (they stay as you decided)` : ''),
        impact.hits.length ? h('ul.txlist.compact', impact.hits.slice(-4).reverse().map(t => txnRow(t, {}))) : null),
    ].filter(Boolean));
  };
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 200); };
  const textValue = (c) => (e) => { const parts = e.target.value.split(',').map(x => x.trim()).filter(Boolean); c.v = parts.length > 1 ? parts : (parts[0] || ''); soon(); };
  const centsInto = (setter) => (e) => { const v = E.toCents(e.target.value); if (v !== null) { setter(v); soon(); } };

  const save = () => {
    clearTimeout(timer);
    r.conds = r.conds.filter(c => c.f === 'amt' || c.f === 'src' || (Array.isArray(c.v) ? c.v.length : String(c.v).trim()));
    if (E.ruleWarnings(r).length || !r.conds.length) { draw(); return; }
    r.origin = r.origin === 'system' ? 'system' : (r.origin || 'user');
    sheet.close();
    let filed = 0;
    mutate(s => {
      const i = s.rules.findIndex(x => x.id === r.id);
      if (i >= 0) s.rules[i] = r; else s.rules.push(r);
      filed = E.reapplyRules(s);
    }, { label: null });
    toast(filed ? `Rule saved · ${filed} waiting transaction${filed === 1 ? '' : 's'} filed` : 'Rule saved', { actions: [['Undo', () => undoLast()]] });
  };

  const draw = () => {
    const condRows = r.conds.map((c, i) => {
      const fieldSel = h('select', { 'aria-label': 'Field', onchange: (e) => { c.f = e.target.value; c.op = FIELD_OPS[c.f][0]; c.v = c.f === 'amt' ? 'out' : c.f === 'src' ? 'giro' : ''; if (c.f === 'amt') c.op = 'sign'; draw(); } },
        Object.entries(E.FIELDS).map(([k, label]) => h('option', { value: k, selected: k === c.f }, label)));
      const opSel = h('select', { 'aria-label': 'Condition', onchange: (e) => { c.op = e.target.value; if (c.f === 'amt') c.v = c.op === 'between' ? [-10000, 0] : c.op === 'sign' ? 'out' : 0; draw(); } },
        FIELD_OPS[c.f].map(op => h('option', { value: op, selected: op === c.op }, OP_LABEL[op] || op)));
      let valueEl;
      if (c.f === 'amt' && c.op === 'sign') valueEl = h('select', { onchange: (e) => { c.v = e.target.value; soon(); } }, h('option', { value: 'out', selected: c.v === 'out' }, 'money out'), h('option', { value: 'in', selected: c.v === 'in' }, 'money in'));
      else if (c.f === 'amt' && c.op === 'between') {
        const a = h('input', { type: 'text', inputmode: 'decimal', value: (c.v[0] / 100).toFixed(2), oninput: centsInto(v => { c.v[0] = v; }) });
        const b = h('input', { type: 'text', inputmode: 'decimal', value: (c.v[1] / 100).toFixed(2), oninput: centsInto(v => { c.v[1] = v; }) });
        valueEl = h('div.inline', a, h('span', 'to'), b);
      } else if (c.f === 'amt') valueEl = h('input', { type: 'text', inputmode: 'decimal', value: (c.v / 100).toFixed(2), oninput: centsInto(v => { c.v = v; }) });
      else if (c.f === 'src') valueEl = h('select', { onchange: (e) => { c.v = e.target.value; soon(); } }, app.state.accounts.map(a => h('option', { value: a.id, selected: (Array.isArray(c.v) ? c.v[0] : c.v) === a.id }, a.name)));
      else valueEl = h('input', { type: 'text', value: Array.isArray(c.v) ? c.v.join(', ') : c.v, placeholder: 'text (comma = any of)', autocapitalize: 'characters', oninput: textValue(c) });
      return h('div.cond', h('div.cond-top', fieldSel, opSel, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove condition', onclick: () => { r.conds.splice(i, 1); draw(); } }, icon('x'))), valueEl);
    });
    const typeSel = h('select', { onchange: (e) => { r.act.type = e.target.value; if (!['expense', 'income'].includes(r.act.type)) r.act.cat = null; draw(); } },
      Object.entries(E.TYPES).map(([k, label]) => h('option', { value: k, selected: k === r.act.type }, label)));
    const catSel = ['expense', 'income'].includes(r.act.type) ? h('select', { onchange: (e) => { r.act.cat = e.target.value || null; soon(); } },
      h('option', { value: '' }, 'Pick…'),
      app.state.cats.filter(c => (r.act.type === 'income') === !!c.income).map(c => h('optgroup', { label: c.name }, c.subs.map(sb => h('option', { value: sb.id, selected: sb.id === r.act.cat }, sb.name))))) : null;
    const bmSel = h('select', { onchange: (e) => { r.act.bm = e.target.value; } },
      [['date', 'Month of the bank date'], ['salary', 'Salary: from the 15th on, next month'], ['next', 'Always the next month']].map(([k, l]) => h('option', { value: k, selected: (r.act.bm || 'date') === k }, l)));
    const name = h('input', { type: 'text', value: r.name || '', placeholder: 'e.g. Groceries at Hofer', oninput: (e) => { r.name = e.target.value; } });
    const prio = h('select', { onchange: (e) => { r.prio = Number(e.target.value); } }, [[5, 'High'], [0, 'Normal'], [-2, 'Low']].map(([v, l]) => h('option', { value: v, selected: (r.prio || 0) === v }, l)));
    const review = h('input', { type: 'checkbox', checked: !!r.act.review, onchange: (e) => { r.act.review = e.target.checked ? (r.act.review === 'always' ? 'always' : true) : false; } });
    const onOff = h('input', { type: 'checkbox', checked: r.on !== false, onchange: (e) => { r.on = e.target.checked; } });
    sheet.set({
      title: isNew ? 'New rule' : (r.name || 'Edit rule'),
      subtitle: fromTxn ? `From: ${E.describeTxn(fromTxn)}` : r.note || null,
      body: h('div.stack-sm',
        field('Name', name),
        h('p.label', 'When all of these match'),
        condRows,
        h('button.link', { type: 'button', onclick: () => { r.conds.push({ f: 'purpose', op: 'contains', v: '' }); draw(); } }, icon('plus', 'sm'), 'Add condition'),
        h('p.label', 'Then'),
        field('File as', typeSel), catSel ? field(r.act.type === 'income' ? 'Income line' : 'Bucket', catSel) : null,
        field('Counts in', bmSel),
        h('label.check', review, 'Still show it for a quick check'),
        field('Priority when several rules match', prio),
        isNew ? null : h('label.check', onOff, 'Rule is active'),
        live,
      ),
      footer: [
        !isNew ? h('button.btn.danger.ghost', { type: 'button', onclick: async () => {
          if (await confirmSheet({ title: 'Delete rule?', message: 'Transactions it filed keep their category.', confirm: 'Delete', danger: true })) {
            sheet.close(); mutate(s => { s.rules = s.rules.filter(x => x.id !== r.id); }, { label: 'Rule deleted' });
          }
        } }, 'Delete') : null,
        saveBtn,
      ],
    });
    refresh();
  };
  draw();
}
