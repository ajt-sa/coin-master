// Coin Master engine: import, fingerprints, rules, booking months, month maths,
// carry-over and reconciliation. Pure functions over a plain JSON state, no DOM.
// Shared by the phone app (browser) and the build/test scripts (Node).

export const SCHEMA = 1;

// ───────────────────────── money & dates ─────────────────────────

/** Parse a money value ("1.234,56", "-12.3", 12.3, "−7,00 €") into integer cents. */
export function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).trim().replace(/[€\s ]/g, '').replace(/[−–]/g, '-');
  if (!s) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else s = s.replace(/,/g, ''); // 1,234.56
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const EUR = typeof Intl !== 'undefined'
  ? new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : null;

/** €1,234.56 (minus sign as a true minus). */
export function fmt(cents, { sign = false, round = false } = {}) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '–';
  const v = round ? Math.round(cents / 100) : cents / 100;
  let s = EUR ? EUR.format(Math.abs(v)) : `€${Math.abs(v).toFixed(2)}`;
  if (round) s = s.replace(/\.00$/, '');
  if (v < 0 || (!round && cents < 0)) return '\u2212\u2060' + s;
  if (sign && v > 0) return '+\u2060' + s;
  return s;
}

export const ym = (date) => String(date).slice(0, 7);
export function addMonths(m, n) {
  let [y, mo] = m.split('-').map(Number);
  mo += n;
  y += Math.floor((mo - 1) / 12);
  mo = ((mo - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}
export function monthsBetween(a, b) { // inclusive list a..b
  const out = [];
  for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m);
  return out;
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(m, long = false) {
  const [y, mo] = m.split('-').map(Number);
  return `${(long ? MONTH_LONG : MONTH_SHORT)[mo - 1]} ${y}`;
}
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysInMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}

// ───────────────────────── text normalisation ─────────────────────────

/** Upper-case, umlauts folded (Ö→OE), accents stripped, whitespace collapsed. */
export function norm(s) {
  if (!s) return '';
  return String(s).toUpperCase()
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS').replace(/ẞ/g, 'SS')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// 64-bit FNV-1a → 13 base36 chars. Fingerprints are stored hashed to keep the data file small.
export function hash(str) {
  let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 | 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 13);
  }
  const a = (h1 >>> 0).toString(36).padStart(7, '0');
  const b = (h2 >>> 0).toString(36).padStart(7, '0');
  return a + b;
}

// ───────────────────────── bank export parsing ─────────────────────────

const HEADERS = {
  date: ['booking date', 'buchungsdatum', 'date', 'datum', 'valuta', 'value date', 'valutadatum'],
  partner: ['partner name', 'partnername', 'name', 'empfaenger', 'auftraggeber', 'payee'],
  iban: ['partner iban', 'iban', 'partner-iban'],
  bic: ['bic/swift', 'bic', 'swift'],
  acct: ['partner account number', 'partner kontonummer', 'kontonummer', 'account number'],
  bank: ['bank code', 'bankleitzahl', 'blz'],
  amount: ['amount', 'betrag', 'amount (eur)', 'betrag (eur)'],
  details: ['booking details', 'buchungsdetails', 'buchungs-details', 'details', 'verwendungszweck', 'purpose', 'reference', 'zahlungsreferenz'],
};

function headerKey(h) {
  const n = norm(h).toLowerCase().replace(/\s+/g, ' ');
  for (const [k, al] of Object.entries(HEADERS)) {
    if (al.some(a => norm(a).toLowerCase() === n)) return k;
  }
  return null;
}

function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v)) {
    return todayISO(v);
  }
  if (typeof v === 'number') { // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Turn a sheet (array of row arrays, first rows may be junk) into canonical
 * raw records {date, partner, iban, bic, acct, bank, amt, details}.
 */
export function parseSheetRows(rows) {
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = (rows[i] || []).map(headerKey);
    if (keys.includes('date') && keys.includes('amount')) { hi = i; map = keys; break; }
  }
  if (hi < 0) throw new Error('No "Booking Date" / "Amount" header row found. Is this a George export?');
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r || r.every(v => v === null || v === undefined || v === '')) continue;
    const rec = {};
    map.forEach((k, i) => { if (k && rec[k] === undefined) rec[k] = r[i]; });
    const date = toISODate(rec.date), amt = toCents(rec.amount);
    if (!date || amt === null) continue;
    const str = (x) => (x === null || x === undefined) ? '' : String(x).trim();
    out.push({
      date, amt,
      partner: str(rec.partner), iban: str(rec.iban).replace(/\s+/g, ''), bic: str(rec.bic),
      acct: str(rec.acct), bank: str(rec.bank), details: str(rec.details),
    });
  }
  return out;
}

/** Which account does a file belong to? Uses the IBAN / card number in the file name. */
export function detectAccount(state, fileName, records) {
  const name = norm(fileName).replace(/\s+/g, '');
  for (const a of state.accounts) {
    for (const id of a.ids || []) {
      if (id && name.includes(norm(id).replace(/\s+/g, ''))) return a.id;
    }
  }
  // Content heuristics: card exports have no partner names and George card book numbers
  const cardLike = records.length > 0 && records.every(r => !r.partner && !r.iban);
  if (cardLike) {
    const last4 = (fileName.match(/(\d{4})(?=[_\-.\s]|$)/) || [])[1];
    const byLast4 = state.accounts.find(a => a.kind === 'card' && last4 && (a.ids || []).includes(last4));
    if (byLast4) return byLast4.id;
  }
  return null;
}

/** Canonical transaction fields from a raw record for a given account. */
export function toTxnFields(state, raw, accountId) {
  const acc = state.accounts.find(a => a.id === accountId);
  if (acc && acc.kind === 'card') {
    // Card exports: merchant text sits in "Booking details"; Coin Master typed it into "Partner Name".
    return { src: accountId, date: raw.date, amt: raw.amt, cp: raw.details || raw.partner, purpose: '', iban: '', acct: '', bank: '' };
  }
  return {
    src: accountId, date: raw.date, amt: raw.amt, cp: raw.partner, purpose: raw.details,
    iban: raw.iban, acct: raw.acct, bank: raw.bank, bic: raw.bic,
  };
}

/** Stable identity of a booked transaction (without the twin counter). */
export function fingerprintKey(t) {
  const acc = t.src;
  const who = norm(t.iban || t.acct || '');
  return [acc, t.date, t.amt, norm(t.cp), norm(t.purpose), who].join('|');
}
export const fingerprint = (t) => hash(fingerprintKey(t));

// ───────────────────────── booking month helpers ─────────────────────────

const MONTH_WORDS = [
  ['JANUARY', 'JANUAR', 'JAENNER', 'JAN', 'JAENN'], ['FEBRUARY', 'FEBRUAR', 'FEB'], ['MARCH', 'MAERZ', 'MAR', 'MRZ'],
  ['APRIL', 'APR'], ['MAY', 'MAI'], ['JUNE', 'JUNI', 'JUN'], ['JULY', 'JULI', 'JUL'], ['AUGUST', 'AUG'],
  ['SEPTEMBER', 'SEPT', 'SEP'], ['OCTOBER', 'OKTOBER', 'OCT', 'OKT'], ['NOVEMBER', 'NOV'], ['DECEMBER', 'DEZEMBER', 'DEC', 'DEZ'],
];
const MONTH_TAG_RE = new RegExp(`^(${MONTH_WORDS.flat().sort((a, b) => b.length - a.length).join('|')})\\.?\\s*(\\d{4})?\\s*:`);

/** "July: Mahnoor gifts" → the most recent July on or before the transaction's month. */
export function monthTag(t) {
  const txt = norm(t.purpose) || norm(t.cp);
  const m = txt.match(MONTH_TAG_RE);
  if (!m) return null;
  const idx = MONTH_WORDS.findIndex(w => w.includes(m[1]));
  if (idx < 0) return null;
  const txM = ym(t.date);
  let y = m[2] ? Number(m[2]) : Number(txM.slice(0, 4));
  let cand = `${y}-${String(idx + 1).padStart(2, '0')}`;
  if (!m[2] && cand > txM) cand = `${y - 1}-${String(idx + 1).padStart(2, '0')}`;
  return cand;
}

/** Booking month for a transaction given the matched rule's month policy. */
export function bookingMonth(state, t, policy = 'date') {
  const s = state.settings || {};
  const salaryDay = s.salaryDay || 15;
  const tag = s.monthTags === false ? null : monthTag(t);
  // Card purchases count in the month of the invoice they are on (see "card invoices").
  const card = cardAccount(state, t.src);
  const base = card ? invoiceMonth(card, t.date) : ym(t.date);
  let m;
  if (policy === 'salary') {
    if (tag) m = addMonths(tag, 1);
    else m = Number(t.date.slice(8, 10)) >= salaryDay ? addMonths(ym(t.date), 1) : ym(t.date);
  } else if (policy === 'next') {
    m = addMonths(tag || base, 1);
  } else {
    m = tag || base;
  }
  return clampToLive(state, m);
}

export function clampToLive(state, m) {
  const start = state.settings.startMonth;
  return m < start ? start : m;
}

// ───────────────────────── card invoices ─────────────────────────
// A card purchase counts in the month of the invoice it is on (as in Coin Master): every card has
// a closing date per month, entered during the update. Purchases up to and including that day
// belong to that month's invoice, later ones to the next. acc.invoices = { 'YYYY-MM': { close } }
// or { open } ("not closed yet" as of that day). Without a date, a purchase counts in its own month.

export function cardAccount(state, id) {
  const a = (state.accounts || []).find(x => x.id === id);
  return a && a.kind === 'card' ? a : null;
}

/** Invoice month of a card purchase dated `date`. */
export function invoiceMonth(acc, date) {
  const M = ym(date);
  const e = acc && acc.invoices && acc.invoices[M];
  return e && e.close && date > e.close ? addMonths(M, 1) : M;
}

/** Closing dates of a card, including the Coin Master start (the last statement before the app took over). */
function invoicesOf(acc) {
  const inv = { ...(acc.invoices || {}) };
  if (acc.anchor && acc.anchor.date && !inv[ym(acc.anchor.date)]) inv[ym(acc.anchor.date)] = { close: acc.anchor.date };
  return inv;
}

/** Card rows that make up an invoice: purchases and refunds, not the monthly payment to the card. */
const onInvoice = (t) => !t.arch && !t.auto && t.type !== 'settle';

const BILL_RE = /KREDITKARTENRECHNUNG\s+([A-Z]+)\.?\s*(\d{4})/;
/** "s Kreditkartenrechnung Aug. 2026 … Kartenendnummer 1234" → '2026-08' */
export function billMonth(t) {
  const m = norm(t.purpose).match(BILL_RE) || norm(t.cp).match(BILL_RE);
  if (!m) return null;
  const idx = MONTH_WORDS.findIndex(w => w.includes(m[1]));
  return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, '0')}`;
}

/** The current-account debit that paid this card's invoice for month M (extra: rows about to be imported). */
export function cardBill(state, acc, M, extra = []) {
  const isBill = (t) => t.amt < 0 && accountKind(state, t.src) === 'giro' && billMonth(t) === M && (settlementCard(state, t) || {}).id === acc.id;
  return state.txns.find(isBill) || extra.find(isBill) || null;
}

const monthEnd = (M) => `${M}-${String(daysInMonth(M)).padStart(2, '0')}`;
const dayOf = (iso) => Number(iso.slice(8, 10));
const onDay = (M, day) => `${M}-${String(Math.min(day, daysInMonth(M))).padStart(2, '0')}`;

/** From which day of the month a card's closing date matters (the 20th, earlier if it ever closed earlier). */
function windowDay(acc) {
  const days = Object.values(invoicesOf(acc)).filter(e => e.close).map(e => dayOf(e.close) - 2);
  return Math.min(20, ...days);
}

/**
 * The closing day at which the purchases since the previous invoice add up to the bill. Days without
 * purchases are equivalent; the one nearest the card's usual closing day is returned.
 */
function matchClose(rows, prevClose, M, billCents) {
  const list = rows.filter(t => t.date > prevClose).sort((a, b) => a.date.localeCompare(b.date));
  const end = monthEnd(M);
  let sum = 0, i = 0;
  for (let d = `${M}-01`; d <= end; d = addDays(d, 1)) {
    while (i < list.length && list[i].date <= d) { sum += list[i].amt; i++; }
    if (-sum !== billCents) continue;
    const next = i < list.length ? list[i].date : null;
    let hi = d;
    while (hi < end && !(next && addDays(hi, 1) >= next)) hi = addDays(hi, 1);
    const want = onDay(M, dayOf(prevClose));
    return want < d ? d : want > hi ? hi : want;
  }
  return null;
}

/** Suggested closing date for a card's invoice of month M: from the bill if it is there, else last month's day. */
function suggestClose(state, acc, M, rows, extra = []) {
  const inv = invoicesOf(acc);
  const bill = cardBill(state, acc, M, extra);
  const prev = inv[addMonths(M, -1)];
  if (bill && prev && prev.close) {
    const d = matchClose(rows, prev.close, M, -bill.amt);
    if (d) return { suggestion: d, basis: 'bill', bill: -bill.amt };
  }
  const known = Object.keys(inv).filter(m => m < M && inv[m].close).sort();
  const day = known.length ? dayOf(inv[known.at(-1)].close) : 25;
  return { suggestion: onDay(M, day), basis: known.length ? 'last' : 'default', bill: bill ? -bill.amt : null };
}

function invoiceRows(state, acc, extra = []) {
  const fresh = extra.filter(x => x.src === acc.id).map(x => ({ ...x, type: x.type || categorize(state, x).type }));
  return state.txns.filter(t => t.src === acc.id && onInvoice(t)).concat(fresh.filter(onInvoice));
}

function invoiceItem(state, acc, M, rows, today, extra = []) {
  const e = (acc.invoices || {})[M] || {};
  return {
    acc: acc.id, month: M, close: e.close || null, open: e.open || null, canBeOpen: M === ym(today),
    rows: rows.filter(t => ym(t.date) === M).map(t => ({ date: t.date, amt: t.amt })),
    ...suggestClose(state, acc, M, rows, extra),
  };
}

/**
 * Card invoices whose closing date is needed: purchases from about the 20th of a month on, no
 * closing date for that month yet, and not already confirmed "not closed yet" for those days.
 * extra: rows about to be imported, so the question comes before they are filed;
 * onlyExtra: ask only about months those rows reach (the Update screen reminds about the rest).
 */
export function invoiceQuestions(state, { today = todayISO(), extra = [], onlyExtra = false } = {}) {
  const out = [];
  const start = state.settings.startMonth;
  for (const acc of state.accounts.filter(a => a.kind === 'card')) {
    const rows = invoiceRows(state, acc, extra);
    const wd = windowDay(acc);
    const months = new Set();
    const candidates = onlyExtra ? invoiceRows({ ...state, txns: [] }, acc, extra) : rows;
    for (const t of candidates) {
      const M = ym(t.date);
      if (M < start || dayOf(t.date) < wd) continue;
      const e = (acc.invoices || {})[M];
      if (e && (e.close || (e.open && t.date <= e.open))) continue;
      months.add(M);
    }
    for (const M of [...months].sort()) out.push(invoiceItem(state, acc, M, rows, today, extra));
  }
  return out;
}

/** All invoice months of one card from the first live month to today (Settings). */
export function invoiceItems(state, accId, today = todayISO()) {
  const acc = cardAccount(state, accId);
  if (!acc) return [];
  const rows = invoiceRows(state, acc);
  return monthsBetween(state.settings.startMonth, ym(today)).reverse().map(M => invoiceItem(state, acc, M, rows, today));
}

/** Invoices with a closing date and a bill on the current account: do the purchases add up to the bill? */
export function invoiceChecks(state) {
  const out = [];
  for (const acc of state.accounts.filter(a => a.kind === 'card')) {
    const inv = invoicesOf(acc);
    const rows = invoiceRows(state, acc);
    for (const M of Object.keys(inv).sort()) {
      const e = inv[M], prev = inv[addMonths(M, -1)];
      if (!e.close || M < state.settings.startMonth || !prev || !prev.close) continue;
      const bill = cardBill(state, acc, M);
      if (!bill) continue;
      const sum = -rows.filter(t => t.date > prev.close && t.date <= e.close).reduce((s, t) => s + t.amt, 0);
      const fix = sum === -bill.amt ? null : matchClose(rows, prev.close, M, -bill.amt);
      out.push({ acc: acc.id, month: M, close: e.close, bill: -bill.amt, sum, ok: sum === -bill.amt, fix: fix && fix !== e.close ? fix : null });
    }
  }
  return out;
}

const policyOf = (state, t) => { const r = t.rule && state.rules.find(x => x.id === t.rule); return (r && r.act && r.act.bm) || 'date'; };

/** Give card purchases the month of their invoice again (loans and months chosen by hand stay). */
function resortCards(state, accIds) {
  let moved = 0;
  for (const t of state.txns) {
    if (!accIds.has(t.src) || t.arch || t.a || t.bmMan || t.type === 'loan' || t.type === 'settle') continue;
    const m = bookingMonth(state, t, policyOf(state, t));
    if (m !== t.bm) { t.bm = m; if (isCounted(t)) moved++; }
  }
  return moved;
}

/** First use: keep months already moved by hand, and start from the Coin Master statements. */
export function ensureInvoices(state) {
  if (state.settings.invoices) return;
  for (const t of state.txns) {
    if (!cardAccount(state, t.src) || t.arch || t.a || t.bmMan || t.type === 'loan' || t.type === 'settle') continue;
    if (t.bm && t.bm !== bookingMonth(state, t, policyOf(state, t))) t.bmMan = 1;
  }
  for (const acc of state.accounts.filter(a => a.kind === 'card')) acc.invoices = invoicesOf(acc);
  state.settings.invoices = 1;
}

/**
 * Save closing dates: [{acc, month, close}] | [{acc, month, open}] ("not closed yet" as of that day)
 * | [{acc, month}] (forget). Card purchases move to their invoice month; returns how many moved.
 */
export function setInvoiceDates(state, entries) {
  ensureInvoices(state);
  const touched = new Set();
  for (const x of entries) {
    const acc = cardAccount(state, x.acc);
    if (!acc || !/^\d{4}-\d{2}$/.test(x.month || '')) continue;
    acc.invoices = acc.invoices || {};
    if (x.close && x.close.slice(0, 7) === x.month) acc.invoices[x.month] = { close: x.close };
    else if (x.open) acc.invoices[x.month] = { open: x.open };
    else delete acc.invoices[x.month];
    touched.add(acc.id);
  }
  const moved = resortCards(state, touched);
  touch(state);
  return moved;
}

// ───────────────────────── rules ─────────────────────────

export const FIELDS = {
  cp: 'Merchant', purpose: 'Purpose', text: 'Merchant or purpose',
  iban: 'Partner account', src: 'Paid from', amt: 'Amount',
};
export const TEXT_OPS = { contains: 'contains', word: 'contains word', startsWith: 'starts with', equals: 'is exactly', notContains: 'does not contain', regex: 'matches pattern' };
export const AMT_OPS = { between: 'is between', lt: 'is below', gt: 'is above', sign: 'direction' };

export const TYPES = {
  expense: 'Budget bucket', income: 'Income', transfer: 'Transfer (own accounts)',
  oneoff: 'One-off (outside budget)', loan: 'Loan / pending return', settle: 'Card settlement', ignore: 'Ignore',
};

function fieldValue(t, f) {
  switch (f) {
    case 'cp': return norm(t.cp);
    case 'purpose': return norm(t.purpose);
    case 'text': return (norm(t.cp) + ' | ' + norm(t.purpose));
    case 'iban': return norm((t.iban || '') + ' ' + (t.acct || '')).replace(/\s+/g, ' ');
    case 'src': return t.src;
    case 'amt': return t.amt;
    default: return '';
  }
}

const wordRe = new Map();
function testText(op, hay, needle) {
  const n = norm(needle);
  if (!n) return false;
  switch (op) {
    case 'contains': return hay.includes(n);
    case 'notContains': return !hay.includes(n);
    case 'startsWith': return hay.startsWith(n);
    case 'equals': return hay === n;
    case 'word': {
      let re = wordRe.get(n);
      if (!re) { re = new RegExp(`(^|[^A-Z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Z])`); wordRe.set(n, re); }
      return re.test(hay);
    }
    case 'regex': try { return new RegExp(needle, 'i').test(hay); } catch { return false; }
    default: return false;
  }
}

export function condMatches(c, t) {
  const v = fieldValue(t, c.f);
  if (c.f === 'amt') {
    const a = v;
    if (c.op === 'sign') return c.v === 'in' ? a > 0 : a < 0;
    if (c.op === 'lt') return a < c.v;
    if (c.op === 'gt') return a > c.v;
    if (c.op === 'between') { const [lo, hi] = c.v; return a >= Math.min(lo, hi) && a <= Math.max(lo, hi); }
    return false;
  }
  if (c.f === 'src') return Array.isArray(c.v) ? c.v.includes(v) : v === c.v;
  const vals = Array.isArray(c.v) ? c.v : [c.v];
  if (c.op === 'notContains') return vals.every(x => testText('notContains', v, x));
  return vals.some(x => testText(c.op, v, x));
}

export function ruleMatches(rule, t) {
  return rule.on !== false && rule.conds.length > 0 && rule.conds.every(c => condMatches(c, t));
}

/** More specific rules win: text conditions count fully, amount/account conditions half. */
export function ruleScore(r) {
  const base = r.conds.reduce((s, c) => s + (c.f === 'amt' || c.f === 'src' ? 0.5 : 1), 0);
  return base * 100 + (r.prio || 0) * 10 + (r.origin === 'user' ? 5 : 0);
}

export function sortedRules(state) {
  return [...state.rules].filter(r => r.on !== false).sort((a, b) => ruleScore(b) - ruleScore(a));
}

/** Only amount conditions → not allowed as an identifying rule (spec 5.3). */
export function ruleWarnings(rule) {
  const w = [];
  if (!rule.conds.some(c => c.f !== 'amt' && c.f !== 'src')) w.push('Needs at least one text condition: amounts drift, so they cannot identify a transaction on their own.');
  if (rule.act.type === 'expense' || rule.act.type === 'income') { if (!rule.act.cat) w.push('Pick a bucket.'); }
  return w;
}

const OWN_ACCOUNT_TYPES = new Set(['transfer']);

/** Foreign card payment at a till (travel) → worth a look. */
export function abroadHint(t) {
  const p = norm(t.purpose);
  const m = p.match(/^POS\s+[\d.,]+\s+([A-Z]{2,3})\s+K\d/);
  if (m && m[1] !== 'AT' && m[1] !== 'EUR') return m[1];
  if (/INKL\. FREMDWAEHRUNG/.test(norm(t.cp))) return 'FX';
  return null;
}

const LOAN_RE = /^\s*loan(?:\s+return)?(?:\s*\d+)?\s*:\s*(.+)$/i;
export function loanName(t) {
  const m = String(t.purpose || '').match(LOAN_RE);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Categorise one (new) transaction. Returns the fields to merge into it.
 * Never called for transactions the owner already decided on.
 */
export function categorize(state, t, rules = sortedRules(state)) {
  const out = { type: null, cat: null, rule: null, rev: 0, hint: null, tag: null };
  let policy = 'date';
  // 1. zero-amount bank notices
  if (t.amt === 0) {
    Object.assign(out, { type: 'ignore', hint: 'Zero-amount bank notice' });
    out.bm = bookingMonth(state, t);
    return out;
  }
  // 2. rules; 3. loans by purpose convention "Loan: X" / "Loan Return 2: X" (your own rules still win)
  const r = rules.find(rule => ruleMatches(rule, t));
  const ln = loanName(t);
  if (ln && !(r && (r.origin === 'user' || r.act.type === 'settle' || r.act.type === 'ignore'))) {
    out.type = 'loan'; out.tag = ln; out.rule = 'sys-loan';
  } else if (r) {
    out.type = r.act.type; out.cat = r.act.cat || null; out.rule = r.id; policy = r.act.bm || 'date';
    if (r.act.tag) out.tag = r.act.tag;
    if (r.act.review) { out.rev = r.act.review === 'always' ? 2 : 1; out.hint = r.act.hint || 'Check this one'; }
  } else {
    // unmatched: provisional type by direction, owner decides in review
    out.type = t.amt < 0 ? 'expense' : 'transfer';
    out.rev = 1; out.hint = 'No rule matched';
  }
  // 4. travel: a foreign till payment is often a trip expense
  const abroad = abroadHint(t);
  if (abroad && (out.type === 'expense') && !out.rev) { out.rev = 1; out.hint = abroad === 'FX' ? 'Foreign-currency card payment: trip?' : `Paid abroad (${abroad}): trip?`; }
  if ((out.type === 'expense' || out.type === 'income') && !out.cat) { out.rev = 1; out.hint = out.hint || 'Pick a bucket'; }
  out.bm = bookingMonth(state, t, policy);
  if (monthTag(t) && state.settings.monthTags !== false) out.tagMonth = monthTag(t);
  return out;
}

// ───────────────────────── import ─────────────────────────

/**
 * Count stored transactions per fingerprint (the real number, so a removed or undone
 * occurrence of identical twins can come back with the next export).
 */
export function storedCounts(state) {
  const m = new Map();
  for (const t of state.txns) m.set(t.fp, (m.get(t.fp) || 0) + 1);
  return m;
}

/** Occurrence numbers already taken per fingerprint (ids stay unique when twins come back). */
function takenOccurrences(state) {
  const m = new Map();
  for (const t of state.txns) {
    let s = m.get(t.fp);
    if (!s) m.set(t.fp, s = new Set());
    s.add(t.occ || 1);
  }
  return m;
}

/** "AT12…_2026-09-01_2026-09-28.xlsx" → "AT12…": the part of a file name that identifies the account. */
export function fileIdPart(name) {
  return String(name || '').split(/[_\s(]/)[0];
}

function tokens(s) {
  return new Set(norm(s).split(/[^A-Z0-9&]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w)));
}
function similarText(a, b) {
  const A = tokens(a.cp + ' ' + a.purpose), B = tokens(b.cp + ' ' + b.purpose);
  for (const w of A) if (B.has(w)) return true;
  return false;
}
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * Plan an import: files = [{name, accountId, records}] (records from parseSheetRows).
 * Returns what is new, what is known, and anything that looks like a changed duplicate.
 * Nothing is modified until applyImport().
 */
export function planImport(state, files) {
  const counts = storedCounts(state);
  const perAccount = new Map(); // accountId -> Map(fp -> {count, fields})
  const coverage = new Map();   // accountId -> [minDate, maxDate]
  const fileSummaries = [];
  for (const f of files) {
    const local = new Map();
    for (const raw of f.records) {
      const fields = toTxnFields(state, raw, f.accountId);
      const fp = fingerprint(fields);
      const e = local.get(fp) || { count: 0, fields };
      e.count++;
      local.set(fp, e);
      const cov = coverage.get(f.accountId) || [fields.date, fields.date];
      coverage.set(f.accountId, [fields.date < cov[0] ? fields.date : cov[0], fields.date > cov[1] ? fields.date : cov[1]]);
    }
    // Overlapping files of the same account: a fingerprint's true count is the max seen in any one file.
    const acc = perAccount.get(f.accountId) || new Map();
    for (const [fp, e] of local) {
      const prev = acc.get(fp);
      if (!prev || e.count > prev.count) acc.set(fp, e);
    }
    perAccount.set(f.accountId, acc);
    fileSummaries.push({ name: f.name, accountId: f.accountId, rows: f.records.length });
  }

  const fresh = [], seenFps = new Set();
  const taken = takenOccurrences(state);
  let known = 0;
  for (const [accountId, acc] of perAccount) {
    for (const [fp, e] of acc) {
      seenFps.add(fp);
      const have = counts.get(fp) || 0;
      known += Math.min(have, e.count);
      const used = taken.get(fp) || new Set();
      for (let k = have; k < e.count; k++) {
        let occ = 1;
        while (used.has(occ)) occ++;
        used.add(occ);
        fresh.push({ ...e.fields, fp, occ, id: occ > 1 ? `${fp}-${occ}` : fp, isTwin: occ > 1 || e.count > 1 });
      }
    }
  }
  // Changed-text / typed-by-hand duplicates: a stored transaction inside the file's date range
  // that the file no longer contains, with the same amount a few days apart.
  const orphans = state.txns.filter(t => !t.auto && !seenFps.has(t.fp) && coverage.has(t.src) &&
    t.date >= addDays(coverage.get(t.src)[0], -5) && t.date <= addDays(coverage.get(t.src)[1], 5));
  for (const n of fresh) {
    if (n.occ > 1) continue;
    const cand = orphans.find(o => o.src === n.src && o.amt === n.amt && dayDiff(o.date, n.date) <= 5 && (similarText(o, n) || Math.abs(n.amt) >= 5000));
    if (cand) n.dupOf = cand.id;
  }
  fresh.sort((a, b) => a.date.localeCompare(b.date) || a.amt - b.amt);
  return { files: fileSummaries, fresh, known, coverage: Object.fromEntries(coverage) };
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** File a transaction that has no decision yet: rules, then the before-the-switch check, then loans. */
function fileNew(state, t, rules) {
  Object.assign(t, categorize(state, t, rules));
  const acc = state.accounts.find(a => a.id === t.src);
  if (acc && acc.anchor && acc.anchor.date && t.date <= acc.anchor.date) {
    // Already inside the start balance (Coin Master era): keep for reference, count nowhere.
    Object.assign(t, { type: 'ignore', cat: null, a: 1, rev: 1, pre: 1, hint: `Dated before the switch (${acc.anchor.date}): Coin Master already counted it, so it is ignored. Remove it if it is a duplicate.` });
  }
  if (t.type === 'loan') ensureLoan(state, t);
  return t;
}

/**
 * Commit a planned import. Every new transaction is categorised once; duplicates the owner
 * confirmed (skipDup) are dropped. Returns a summary.
 * learned / newAccts: file-name mappings and accounts created while reading these files
 * (so undoing the import can forget them too).
 */
export function applyImport(state, plan, { batchId, at = new Date().toISOString(), skip = new Set(), learned = [], newAccts = [] } = {}) {
  ensureInvoices(state);
  const rules = sortedRules(state);
  const added = [];
  for (const n of plan.fresh) {
    if (skip.has(n.id)) continue;
    if (state.txns.some(t => t.id === n.id)) continue;
    const t = {
      id: n.id, fp: n.fp, occ: n.occ, src: n.src, date: n.date, amt: n.amt,
      cp: n.cp || '', purpose: n.purpose || '', iban: n.iban || '', acct: n.acct || '', bank: n.bank || '',
      batch: batchId, a: 0,
    };
    fileNew(state, t, rules);
    if (n.dupOf) { t.rev = 1; t.dupOf = n.dupOf; t.hint = 'Possible duplicate of an earlier entry'; }
    state.txns.push(t);
    added.push(t);
  }
  // Cards without an export: create the card-side payment for each settlement debit.
  for (const t of added.filter(x => x.type === 'settle' && accountKind(state, x.src) === 'giro')) {
    const card = settlementCard(state, t);
    if (card && card.manual) addAutoPayment(state, t, card, batchId);
  }
  // A real card export replaces provisional auto-payments for that card.
  const replaced = [], manualOff = [];
  for (const t of added.filter(x => x.type === 'settle' && accountKind(state, x.src) === 'card' && x.amt > 0)) {
    const auto = state.txns.find(a => a.auto && a.src === t.src && a.amt === t.amt && dayDiff(a.date, t.date) <= 14);
    if (auto) {
      state.txns = state.txns.filter(a => a !== auto);
      if (auto.batch !== batchId) replaced.push(auto);
    }
    const acc = state.accounts.find(a => a.id === t.src);
    if (acc) {
      if (acc.manual && !manualOff.includes(acc.id)) manualOff.push(acc.id);
      acc.manual = false;
    }
  }
  const review = added.filter(t => t.rev).length;
  state.imports = state.imports || [];
  const rec = { id: batchId, at, files: plan.files, added: added.length, known: plan.known, review };
  if (replaced.length) rec.replaced = replaced;
  if (manualOff.length) rec.manualOff = manualOff;
  if (learned.length) rec.learned = learned;
  if (newAccts.length) rec.newAccts = newAccts;
  state.imports.push(rec);
  touch(state);
  return { added: added.length, known: plan.known, review, txns: added };
}

// ───────────────────────── undoing an import ─────────────────────────

/** Imports that can still be undone (they added transactions that are still there). */
export function undoableImport(state, batchId) {
  if (!batchId || batchId === 'coinmaster' || batchId === 'manual') return false;
  if (!(state.imports || []).some(i => i.id === batchId)) return false;
  return state.txns.some(t => t.batch === batchId && !t.auto && !t.arch);
}

/**
 * Take an import back as if it never happened: everything it added goes (with any decisions
 * made on those rows), its fingerprints are forgotten so the right files import cleanly, and
 * months and carry-over recalculate from what is left. Rules, manual entries and later
 * imports stay. Returns { removed, filed, months } or null when there is nothing to undo.
 */
export function undoImport(state, batchId, at = new Date().toISOString()) {
  if (!undoableImport(state, batchId)) return null;
  const imp = state.imports.find(i => i.id === batchId);
  const gone = state.txns.filter(t => t.batch === batchId && !t.arch);
  const goneIds = new Set(gone.map(t => t.id));
  const rows = gone.filter(t => !t.auto);
  const months = [...new Set(rows.filter(isCounted).map(t => t.bm).filter(Boolean))].sort();
  const filed = rows.filter(t => t.man).length;
  const loanIds = new Set(gone.map(t => t.loan).filter(Boolean));
  state.txns = state.txns.filter(t => !goneIds.has(t.id));

  // Card bills: automatic card payments this import had replaced come back, if their
  // current-account debit is still there; cards it switched to "has an export" switch back.
  for (const id of imp.manualOff || []) {
    const acc = state.accounts.find(a => a.id === id);
    if (acc) acc.manual = true;
  }
  for (const auto of imp.replaced || []) {
    const giroId = String(auto.id).replace(/^auto-/, '');
    if (state.txns.some(t => t.id === auto.id) || !state.txns.some(t => t.id === giroId)) continue;
    const covered = state.txns.some(t => t.src === auto.src && t.type === 'settle' && t.amt === auto.amt && dayDiff(t.date, auto.date) <= 14);
    if (!covered) state.txns.push(auto);
  }

  // Loans that only existed through these rows
  if (state.loans) state.loans = state.loans.filter(L => !loanIds.has(L.id) || state.txns.some(t => t.loan === L.id));

  // Rows of other imports flagged as "possible duplicate" of a removed row are ordinary again
  const orphans = state.txns.filter(t => t.dupOf && goneIds.has(t.dupOf));
  if (orphans.length) {
    const rules = sortedRules(state);
    for (const t of orphans) {
      delete t.dupOf;
      if (t.man) continue;
      if (t.pre) { delete t.pre; t.a = 0; }
      fileNew(state, t, rules);
    }
  }

  // File-name → account mappings learned while reading these files, and accounts created for
  // them, are forgotten unless something else still uses them.
  const later = state.imports.filter(i => i.id !== batchId && i.at >= imp.at);
  for (const L of imp.learned || []) {
    const acc = state.accounts.find(a => a.id === L.acct);
    const stillUsed = later.some(i => (i.files || []).some(f => f.accountId === L.acct && fileIdPart(f.name) === L.id));
    if (acc && !stillUsed) acc.ids = (acc.ids || []).filter(x => x !== L.id);
  }
  for (const id of imp.newAccts || []) {
    const acc = state.accounts.find(a => a.id === id);
    if (!acc || state.txns.some(t => t.src === id) || (acc.anchor && acc.anchor.cents)) continue;
    state.accounts = state.accounts.filter(a => a.id !== id);
    if (state.checks) state.checks = state.checks.filter(c => c.acct !== id);
  }

  // The import leaves the list of updates; a short note of it is kept.
  state.imports = state.imports.filter(i => i.id !== batchId);
  const { id, files, added, known, review } = imp;
  state.undoneImports = [...(state.undoneImports || []), { id, at: imp.at, files, added, known, review, undone: at, removed: rows.length }].slice(-10);
  touch(state);
  return { removed: rows.length, filed, months };
}

/** What undoing would change, for the confirmation: rows, filed ones, months, later imports, money left. */
export function undoPreview(state, batchId, today = todayISO()) {
  if (!undoableImport(state, batchId)) return null;
  const imp = state.imports.find(i => i.id === batchId);
  const after = structuredClone(state);
  const res = undoImport(after, batchId);
  const cur = ym(today) < state.settings.startMonth ? state.settings.startMonth : ym(today);
  const before = computeAll(state, today).get(cur), then = computeAll(after, today).get(cur);
  return {
    ...res, imp, month: cur,
    later: state.imports.filter(i => i.id !== batchId && i.at >= imp.at).length,
    moneyBefore: before ? before.closing : null, moneyAfter: then ? then.closing : null,
  };
}

export function accountKind(state, id) {
  const a = state.accounts.find(x => x.id === id);
  return a ? a.kind : null;
}

/** Which card does a current-account settlement pay? ("… Kartenendnummer 1234") */
export function settlementCard(state, t) {
  const p = norm(t.purpose);
  const m = p.match(/KARTENENDNUMMER\s*(\d{4})/);
  if (m) return state.accounts.find(a => a.kind === 'card' && (a.ids || []).includes(m[1])) || null;
  if (/MASTERCARD/.test(p)) return state.accounts.find(a => a.kind === 'card' && /MASTER/i.test(a.name)) || null;
  if (/VISA/.test(p)) return state.accounts.find(a => a.kind === 'card' && /VISA/i.test(a.name)) || null;
  return null;
}

function addAutoPayment(state, giroTx, card, batchId) {
  const id = 'auto-' + giroTx.id;
  if (state.txns.some(t => t.id === id)) return;
  state.txns.push({
    id, fp: id, occ: 1, src: card.id, date: giroTx.date, amt: -giroTx.amt, cp: 'Payment from current account',
    purpose: giroTx.purpose, iban: '', acct: '', bank: '', batch: batchId, a: 0,
    type: 'settle', cat: null, rule: 'sys-settle', rev: 0, bm: giroTx.bm, auto: 1,
  });
}

// ───────────────────────── loans ─────────────────────────

export function loanKey(name) { return 'L-' + hash(norm(name)).slice(0, 8); }

export function ensureLoan(state, t) {
  state.loans = state.loans || [];
  const name = t.tag || t.cp;
  const key = t.loan || loanKey(name);
  let L = state.loans.find(l => l.id === key);
  if (!L) {
    L = { id: key, name, month: t.bm, closed: false, keptCat: null };
    state.loans.push(L);
  }
  t.loan = L.id;
  // Refunds and returns count in the month the loan belongs to
  if (!t.man) t.bm = clampToLive(state, L.month);
  return L;
}

export function loanSummary(state) {
  return (state.loans || []).map(L => {
    const txs = state.txns.filter(t => t.loan === L.id && t.type === 'loan');
    const balance = txs.reduce((s, t) => s + t.amt, 0);
    return { ...L, txs, balance, open: !L.closed };
  }).sort((a, b) => (a.open === b.open ? b.month.localeCompare(a.month) : a.open ? -1 : 1));
}

// ───────────────────────── template ─────────────────────────

export function templateFor(state, m) {
  const versions = [...(state.templates || [])].sort((a, b) => a.from.localeCompare(b.from));
  let cur = null;
  for (const v of versions) if (v.from <= m) cur = v;
  return cur || versions[0] || { from: m, lines: {}, income: {} };
}

/** Save template lines effective from month `from` (past months keep theirs). */
export function setTemplate(state, from, lines, income) {
  state.templates = state.templates || [];
  const existing = state.templates.find(v => v.from === from);
  if (existing) { existing.lines = lines; if (income) existing.income = income; }
  else {
    const base = templateFor(state, from);
    state.templates.push({ from, lines, income: income || { ...(base.income || {}) } });
  }
  state.templates.sort((a, b) => a.from.localeCompare(b.from));
  touch(state);
}

export function subIndex(state) {
  const idx = new Map();
  for (const c of state.cats) for (const s of c.subs) idx.set(s.id, { ...s, main: c.id, mainName: c.name, income: !!c.income });
  return idx;
}

// ───────────────────────── month maths ─────────────────────────

const COUNTED = new Set(['expense', 'income', 'transfer', 'oneoff', 'loan']);
export const isCounted = (t) => COUNTED.has(t.type);

/**
 * Figures for one live month. `opening` is passed in by the carry-over chain.
 * Spending per bucket counts refunds (positive amounts) against the bucket.
 */
export function monthFigures(state, m, opening, txByMonth) {
  const tpl = templateFor(state, m);
  const idx = subIndex(state);
  const loans = new Map((state.loans || []).map(L => [L.id, L]));
  const f = {
    month: m, live: true, opening, templateFrom: tpl.from,
    budget: {}, spent: {}, income: {}, incomePlan: { ...(tpl.income || {}) },
    incomeTotal: 0, budgetTotal: 0, spentTotal: 0, uncatSpent: 0,
    transfers: 0, oneoffs: 0, loansOpen: 0, count: 0, review: 0, lastDate: null,
  };
  for (const [sub, amt] of Object.entries(tpl.lines || {})) { f.budget[sub] = amt; f.budgetTotal += amt; }
  for (const t of txByMonth.get(m) || []) {
    if (!isCounted(t)) continue;
    f.count++;
    if (t.rev) f.review++;
    if (!f.lastDate || t.date > f.lastDate) f.lastDate = t.date;
    switch (t.type) {
      case 'income': {
        const k = t.cat && idx.has(t.cat) ? t.cat : 'inc.other';
        f.income[k] = (f.income[k] || 0) + t.amt; f.incomeTotal += t.amt; break;
      }
      case 'expense': {
        if (t.cat && idx.has(t.cat) && !idx.get(t.cat).income) { f.spent[t.cat] = (f.spent[t.cat] || 0) - t.amt; }
        else f.uncatSpent -= t.amt;
        break;
      }
      case 'transfer': f.transfers += t.amt; break;
      case 'oneoff': f.oneoffs += t.amt; break;
      case 'loan': {
        const L = loans.get(t.loan);
        if (L && L.closed && L.keptCat) f.spent[L.keptCat] = (f.spent[L.keptCat] || 0) - t.amt;
        else f.loansOpen += t.amt;
        break;
      }
    }
  }
  f.spentTotal = Object.values(f.spent).reduce((s, v) => s + v, 0) + f.uncatSpent;
  f.net = f.incomeTotal - f.spentTotal + f.transfers + f.oneoffs + f.loansOpen;
  f.closing = opening + f.net;
  // Projection: every bucket ends at least at its budget (overspends stay as they are)
  let projSpent = f.uncatSpent;
  for (const sub of new Set([...Object.keys(f.budget), ...Object.keys(f.spent)])) {
    projSpent += Math.max(f.spent[sub] || 0, f.budget[sub] || 0);
  }
  let incomeExpected = f.incomeTotal;
  for (const [k, plan] of Object.entries(f.incomePlan)) incomeExpected += Math.max(0, plan - Math.max(0, f.income[k] || 0));
  f.projSpent = projSpent;
  f.projClosing = opening + incomeExpected - projSpent + f.transfers + f.oneoffs + f.loansOpen;
  f.leftInBudget = f.budgetTotal - (f.spentTotal - f.uncatSpent);
  return f;
}

/** History month (frozen Coin Master summary) in the same shape as a live month. */
export function historyFigures(state, m) {
  const h = state.history[m];
  const spent = { ...h.spent }, budget = { ...h.budget };
  const budgetTotal = Object.values(budget).reduce((s, v) => s + v, 0);
  const spentTotal = Object.values(spent).reduce((s, v) => s + v, 0) + (h.uncat || 0);
  return {
    month: m, live: false, history: true, opening: h.opening, budget, spent, income: h.incomeBySub || {},
    incomeTotal: h.income, budgetTotal, spentTotal, uncatSpent: h.uncat || 0, transfers: 0, oneoffs: 0, loansOpen: 0,
    net: h.closing - h.opening, closing: h.closing, projClosing: h.closing, leftInBudget: budgetTotal - (spentTotal - (h.uncat || 0)),
    count: 0, review: 0, notes: h.notes || [], giro: h.giro, cards: h.cards,
  };
}

export function groupByMonth(state) {
  const m = new Map();
  for (const t of state.txns) {
    if (!t.bm) continue;
    if (!m.has(t.bm)) m.set(t.bm, []);
    m.get(t.bm).push(t);
  }
  return m;
}

/**
 * The whole carry-over chain: history months (frozen) then live months from startMonth
 * to max(current month, last month that has bookings).
 */
export function computeAll(state, today = todayISO()) {
  const start = state.settings.startMonth;
  const byMonth = groupByMonth(state);
  const out = new Map();
  const histMonths = Object.keys(state.history || {}).sort();
  for (const m of histMonths) out.set(m, historyFigures(state, m));
  let last = ym(today) > start ? ym(today) : start;
  for (const k of byMonth.keys()) if (k > last) last = k;
  let opening = state.settings.opening;
  for (const m of monthsBetween(start, last)) {
    const f = monthFigures(state, m, opening, byMonth);
    f.future = m > ym(today);
    out.set(m, f);
    opening = f.closing;
  }
  return out;
}

// ───────────────────────── balances & reconciliation ─────────────────────────

/** Expected balance per account = anchor + everything booked after the anchor. */
export function accountBalances(state) {
  const bal = {};
  for (const a of state.accounts) bal[a.id] = a.anchor ? a.anchor.cents : 0;
  for (const t of state.txns) if (!t.a && bal[t.src] !== undefined) bal[t.src] += t.amt;
  return bal;
}

/**
 * Money-left identity (Coin Master's "Error Check", automated):
 *   accounts (current account + card balances)
 *   − money already booked to later months (e.g. next month's salary)
 *   − card settlements still in transit
 *   = net position carried out of the current month.
 */
export function reconcile(state, today = todayISO()) {
  const cur = ym(today) < state.settings.startMonth ? state.settings.startMonth : ym(today);
  const bal = accountBalances(state);
  const accountsTotal = Object.values(bal).reduce((s, v) => s + v, 0);
  let future = 0, transit = 0;
  for (const t of state.txns) {
    if (isCounted(t) && t.bm > cur) future += t.amt;
    if (t.type === 'settle' && !t.a) transit += t.amt;
  }
  const chain = computeAll(state, today);
  const netCurrent = chain.get(cur) ? chain.get(cur).closing : null;
  const derived = accountsTotal - future - transit;
  const checks = (state.checks || []).slice().sort((a, b) => b.at.localeCompare(a.at));
  const lastCheck = {};
  for (const c of checks) if (!lastCheck[c.acct]) lastCheck[c.acct] = c;
  return { month: cur, balances: bal, accountsTotal, future, transit, derived, netCurrent, diff: netCurrent === null ? null : derived - netCurrent, lastCheck };
}

/** Record a balance the owner read in George; returns the difference to the app. */
export function recordCheck(state, acct, bankCents, at = new Date().toISOString()) {
  const app = accountBalances(state)[acct];
  state.checks = state.checks || [];
  state.checks.push({ at, acct, bank: bankCents, app, diff: bankCents - app });
  touch(state);
  return bankCents - app;
}

// ───────────────────────── editing ─────────────────────────

export function touch(state) {
  state.meta = state.meta || {};
  state.meta.updated = new Date().toISOString();
  state.meta.rev = (state.meta.rev || 0) + 1;
}

/**
 * Owner's decision on one transaction ("decide once"). changes: {type, cat, bm, tag, note, loan}
 */
export function decide(state, id, changes) {
  const t = state.txns.find(x => x.id === id);
  if (!t) throw new Error('Unknown transaction ' + id);
  if (t.arch) throw new Error('Archived Coin Master months are read-only');
  for (const k of ['type', 'cat', 'bm', 'tag', 'note', 'loan']) if (k in changes) t[k] = changes[k];
  if ('bm' in changes) t.bmMan = 1; // a month chosen by hand stays when invoice dates change
  if (t.type !== 'expense' && t.type !== 'income') t.cat = null;
  if (t.type !== 'oneoff' && t.type !== 'loan' && !('tag' in changes)) delete t.tag;
  if (t.bm) t.bm = clampToLive(state, t.bm);
  if (t.type === 'loan') {
    const L = ensureLoan(state, t);
    if (!('bm' in changes)) t.bm = clampToLive(state, L.month); // refunds count in the loan's month
  } else if (t.loan) delete t.loan;
  t.man = 1; t.rev = 0; delete t.hint; delete t.dupOf;
  touch(state);
  return t;
}

/** Remove a transaction the owner confirmed as a duplicate. */
export function dropDuplicate(state, id) {
  state.txns = state.txns.filter(t => t.id !== id);
  touch(state);
}

export function newId(prefix = 'r') {
  const rnd = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Date.now()];
  return prefix + '-' + Array.from(rnd, n => (n >>> 0).toString(36)).join('').slice(0, 10);
}

/** Suggest a rule from a manual decision: distinctive merchant words (+ purpose tag for own-account transfers). */
const STOP = new Set(['AT', 'THE', 'DE', 'DER', 'DIE', 'UND', 'AND', 'GMBH', 'AG', 'KG', 'OG', 'SRL', 'S.R.L.', 'SPA', 'S.C.A.', 'LTD', 'INC', 'DANKT', 'DANKE', 'SAGT', 'FIL.', 'INKL.', 'NIEDERLASSUNG', 'EUROPE', 'PAYMENTS']);
export function suggestRule(state, t, act) {
  const raw = norm(t.cp).split(' ').filter(w => w && !/\d/.test(w) && w.length > 1 && !STOP.has(w));
  const domain = raw.find(w => /\.[A-Z]{2,}$/.test(w));
  const words = domain ? [domain] : raw.filter(w => w.length > 2).slice(0, 2);
  const conds = [];
  if (words.length) conds.push({ f: 'cp', op: 'contains', v: words.join(' ') });
  const generic = !words.length || isOwnName(state, t.cp) || /BUDGET|SAVINGS|INVESTMENT/.test(norm(t.cp));
  if (generic && t.purpose) {
    const pw = norm(t.purpose).split(' ').filter(w => w && !/^\d+([.,]\d+)?$/.test(w)).slice(0, 3).join(' ');
    if (pw) conds.push({ f: 'purpose', op: 'contains', v: pw });
  }
  if (!conds.length && t.purpose) conds.push({ f: 'purpose', op: 'contains', v: norm(t.purpose).split(' ').slice(0, 3).join(' ') });
  return {
    id: newId('r'), name: '', conds, prio: 0, origin: 'user', on: true,
    act: { type: act.type, cat: act.cat || null, bm: act.type === 'income' && /SAL|GEHALT|LOHN/.test(norm(t.purpose + ' ' + (act.cat || ''))) ? 'salary' : 'date' },
  };
}

export function isOwnName(state, s) {
  const n = norm(s);
  return (state.settings.ownNames || []).some(o => n.includes(norm(o)));
}

/** Which existing transactions would a rule match? (for the rules manager preview) */
export function ruleImpact(state, rule) {
  const hits = state.txns.filter(t => !t.arch && ruleMatches(rule, t));
  const differs = hits.filter(t => t.man && (t.type !== rule.act.type || (t.cat || null) !== (rule.act.cat || null)));
  return { hits, differs };
}

/** Re-run rules over transactions still waiting for review (never touches decided ones). */
export function reapplyRules(state) {
  const rules = sortedRules(state);
  let changed = 0;
  for (const t of state.txns) {
    if (t.man || t.arch || !t.rev || t.dupOf) continue;
    const c = categorize(state, t, rules);
    if (c.rule && !c.rev) { Object.assign(t, c); changed++; if (t.type === 'loan') ensureLoan(state, t); }
  }
  if (changed) touch(state);
  return changed;
}

// ───────────────────────── queries for the UI ─────────────────────────

export function reviewQueue(state) {
  return state.txns.filter(t => t.rev && !t.arch).sort((a, b) => a.date.localeCompare(b.date));
}

export function txnsForMonth(state, m) {
  return state.txns.filter(t => t.bm === m).sort((a, b) => b.date.localeCompare(a.date) || a.amt - b.amt);
}

/** The name shown for a transaction: your merchant name if one applies (pass state), else the bank's text. */
export function describeTxn(t, state) {
  return (state && displayName(state, t)) || t.cp || t.purpose || '(no text)';
}

// ───────────────────────── merchant names ─────────────────────────
// One name for a merchant everywhere ("HOFER DANKT 0123", "HOFER KG" → "Hofer"), on both phones and
// for every date, archive included. Only what is shown changes: the stored bank text, fingerprints
// and rules stay exactly as the bank wrote them. state.names = [{ id, name, match: ['HOFER', …] }];
// each entry is a whole word or phrase of the merchant text; the longest matching one wins.

const bankText = (t) => norm(t.cp) || norm(t.purpose);

let namesMemo = { sig: null, list: [] };
function compiledNames(state) {
  const names = (state && state.names) || [];
  const sig = names.map(n => `${n.id}\u0001${n.name}\u0001${(n.match || []).join('\u0002')}`).join('\u0003');
  if (sig !== namesMemo.sig) {
    const list = [];
    for (const n of names) for (const p of n.match || []) { const pat = norm(p); if (pat) list.push({ id: n.id, name: n.name, pat }); }
    list.sort((a, b) => b.pat.length - a.pat.length); // most specific first; ties keep list order
    namesMemo = { sig, list };
  }
  return namesMemo.list;
}

/** The merchant-name entry that applies to a transaction: {id, name} or null. */
export function nameEntry(state, t) {
  const list = compiledNames(state);
  if (!list.length) return null;
  const hay = bankText(t);
  if (!hay) return null;
  const hit = list.find(x => testText('word', hay, x.pat));
  return hit ? { id: hit.id, name: hit.name } : null;
}
export function displayName(state, t) {
  const e = nameEntry(state, t);
  return e ? e.name : null;
}

/** "HOFER DANKT 0123" → "HOFER": the distinctive words of a bank name (no numbers, no "DANKT", "GMBH" …). */
export function nameKey(text) {
  const words = norm(text).split(' ').filter(w => w && !/\d/.test(w) && w.length > 1 && !STOP.has(w));
  return words.length ? words.slice(0, 2).join(' ') : norm(text);
}

/** What a list of bank names would catch: how many transactions, and which bank texts (most frequent first). */
export function namePreview(state, patterns) {
  const pats = (patterns || []).map(norm).filter(Boolean);
  const texts = new Map();
  let count = 0;
  if (!pats.length) return { count, names: [] };
  for (const t of state.txns) {
    const hay = bankText(t);
    if (!hay || !pats.some(p => testText('word', hay, p))) continue;
    count++;
    const k = String(t.cp || t.purpose).trim();
    texts.set(k, (texts.get(k) || 0) + 1);
  }
  return { count, names: [...texts].sort((a, b) => b[1] - a[1]) };
}

/** Bank names containing the typed text, as their distinctive words with a count (to pick from). */
export function bankNames(state, query, limit = 6) {
  const q = norm(query);
  if (q.length < 2) return [];
  const keys = new Map();
  for (const t of state.txns) {
    const hay = bankText(t);
    if (!hay.includes(q)) continue;
    const k = nameKey(hay);
    keys.set(k, (keys.get(k) || 0) + 1);
  }
  return [...keys].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Add or change a merchant name ({id?, name, match[]}); returns the saved entry. */
export function saveName(state, entry) {
  const clean = {
    id: entry.id || newId('n'),
    name: String(entry.name || '').trim().slice(0, 40),
    match: [...new Set((entry.match || []).map(norm).filter(Boolean))],
  };
  if (!clean.name || !clean.match.length) throw new Error('A name and at least one bank name are needed');
  state.names = state.names || [];
  const i = state.names.findIndex(n => n.id === clean.id);
  if (i >= 0) state.names[i] = clean; else state.names.push(clean);
  touch(state);
  return clean;
}

export function deleteName(state, id) {
  state.names = (state.names || []).filter(n => n.id !== id);
  touch(state);
}

/** Running card bills: balance per card and what has been spent since the last settlement. */
export function cardSummary(state) {
  const bal = accountBalances(state);
  return state.accounts.filter(a => a.kind === 'card').map(a => {
    const txs = state.txns.filter(t => t.src === a.id).sort((x, y) => x.date.localeCompare(y.date));
    const lastPay = [...txs].reverse().find(t => t.type === 'settle' && t.amt > 0);
    const since = txs.filter(t => t.type !== 'settle' && (!lastPay || t.date >= lastPay.date) && !t.a);
    return { id: a.id, name: a.name, balance: bal[a.id], owed: -bal[a.id], lastPayment: lastPay || null, sinceCount: since.length, manual: !!a.manual };
  });
}

/** Latest booking date that came from a bank export (not Coin Master, not typed by hand). */
export function lastBankDate(state) {
  let d = null;
  for (const t of state.txns) if (!t.arch && !t.auto && !t.manual && t.batch && t.batch !== 'coinmaster' && (!d || t.date > d)) d = t.date;
  return d;
}

export function validateState(state) {
  const errs = [];
  if (!state || state.schema !== SCHEMA) errs.push('Unknown data format');
  for (const k of ['settings', 'accounts', 'cats', 'templates', 'rules', 'txns']) if (!state || !state[k]) errs.push('Missing ' + k);
  return errs;
}
