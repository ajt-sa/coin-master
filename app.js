// Coin Master: app shell, state, encrypted persistence and GitHub sync.
import * as E from './engine.js';
import * as C from './crypto.js';
import * as G from './github.js';
import { h, icon, toast, openSheet, closeAllSheets, relTime, confirmSheet } from './ui.js';
import { renderBudget } from './view-budget.js';
import { renderUpdate } from './view-update.js';
import { renderActivity } from './view-activity.js';
import { renderSettings } from './view-settings.js';
import { renderWelcome, renderUnlock, renderLoading, connectGitHubScreen } from './view-setup.js';
export { txnRow, openTxn } from './txn-ui.js';

export const APP_VERSION = '1.0.0';

export const app = {
  cfg: null, state: null, key: null, salt: null, iter: C.KDF_ITER, pass: null,
  sha: null, dirty: false, publishing: false, lastPublished: null, syncError: null, lastFetch: 0,
  route: { tab: 'budget', month: null, filter: 'all', q: '' },
  redrawSheets: new Set(), undoStack: [], busy: false, lastImport: null,
  saveCfg() { lsSet(K.cfg, JSON.stringify(app.cfg)); },
};

const K = { cfg: 'cm.cfg', pass: 'cm.pass', file: 'cm.file', sha: 'cm.sha', pending: 'cm.pending', ui: 'cm.ui', pub: 'cm.pub' };
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) {
  try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); }
  catch (e) { console.warn('storage', e); }
}
function lsJSON(k) { try { return JSON.parse(lsGet(k)); } catch { return null; } }

export const isOwner = () => app.cfg?.role === 'owner';

export function uiPref(key, def) { const p = lsJSON(K.ui) || {}; return p[key] ?? def; }
export function setUiPref(key, val) { const p = lsJSON(K.ui) || {}; p[key] = val; lsSet(K.ui, JSON.stringify(p)); render(); }

// ───────────────────────── calculations (cached per data revision) ─────────────────────────

let cache = null;
export function calc() {
  const today = E.todayISO();
  const key = `${app.state?.meta?.rev}|${today}|${app.state?.txns?.length}`;
  if (!cache || cache.key !== key || cache.state !== app.state) {
    const months = E.computeAll(app.state, today);
    cache = { key, state: app.state, months, rec: E.reconcile(app.state, today), list: [...months.keys()] };
  }
  return cache;
}
function invalidate() { cache = null; }

function ensureMonth() {
  const { list } = calc();
  const today = E.ym(E.todayISO());
  const def = list.includes(today) ? today : list.filter(m => m <= today).at(-1) || list.at(-1);
  if (!app.route.month || !list.includes(app.route.month)) app.route.month = def;
}

// ───────────────────────── opening & unlocking ─────────────────────────

function sameBytes(a, b) { return a && b && a.length === b.length && a.every((x, i) => x === b[i]); }

async function openFile(file, pass) {
  const salt = C.fileSalt(file), iter = C.fileIter(file);
  let key = app.key;
  if (!key || app.pass !== pass || !sameBytes(app.salt, salt) || app.iter !== iter) key = await C.deriveKey(pass, salt, iter);
  const state = await C.openJSON(file, key);
  const errs = E.validateState(state);
  if (errs.length) throw new Error('The data file looks damaged: ' + errs.join(', '));
  Object.assign(app, { key, salt, iter, pass, state });
  lsSet(K.pass, pass);
  invalidate();
  ensureMonth();
}

export async function unlockWithPassphrase(pass) {
  const cached = lsJSON(K.file);
  if (!app.cfg.local) {
    const { file, sha } = await G.fetchData(app.cfg).catch(() => ({ file: cached, sha: null }));
    await openFile(file || cached, pass);
    if (file) { lsSet(K.file, JSON.stringify(file)); if (sha) { app.sha = sha; lsSet(K.sha, sha); } }
  } else await openFile(cached, pass);
  render();
}

/** End of first-run setup on this phone. */
export async function finishSetup({ cfg, pass, file = null, sha = null, state = null, publish = false, remoteFile = null, remoteSha = null }) {
  app.route.tab = 'budget';
  if (file) {
    app.cfg = cfg;
    await openFile(file, pass);
    app.sha = sha;
    lsSet(K.file, JSON.stringify(file)); lsSet(K.sha, sha);
  } else {
    // new data (seed) or connecting GitHub for data that lives on this phone only
    const salt = app.salt && state === app.state ? app.salt : C.randomBytes(16);
    const key = app.key && state === app.state ? app.key : await C.deriveKey(pass, salt, C.KDF_ITER);
    Object.assign(app, { cfg, key, salt, iter: C.KDF_ITER, pass, state });
    if (!state.meta) state.meta = {};
    state.meta.updated = new Date().toISOString();
    state.meta.rev = (state.meta.rev || 0) + 1;
    lsSet(K.pass, pass);
    app.sha = remoteSha || null;
    invalidate(); ensureMonth();
    const sealed = await C.sealJSON(state, key, salt);
    lsSet(K.file, JSON.stringify(sealed));
    if (publish) {
      if (remoteFile && !(await confirmSheet({ title: 'Replace the data on GitHub?', message: 'The repository already has a budget file. Publishing this phone\'s data replaces it (GitHub keeps the old version in its history).', confirm: 'Replace', danger: true }))) {
        location.reload(); return;
      }
      app.dirty = true; lsSet(K.pending, '1');
      app.saveCfg();
      render();
      await publishNow();
      if (app.syncError) toast(app.syncError, { kind: 'warn', ms: 9000 });
      else toast('Published. Now open the same address on your wife\'s phone and enter the passphrase.', { ms: 9000 });
      return;
    }
  }
  app.saveCfg();
  render();
}

// ───────────────────────── editing ─────────────────────────

let persistTimer, publishTimer;

/** Change the data (owner only). Saves an encrypted copy on the phone and publishes shortly after. */
export function mutate(fn, { label, message } = {}) {
  if (!isOwner() || !app.state) return;
  app.undoStack.push(structuredClone(app.state));
  if (app.undoStack.length > 12) app.undoStack.shift();
  fn(app.state);
  afterChange(message);
  if (label) toast(label, { actions: [['Undo', undoLast]] });
}

function afterChange(message) {
  E.touch(app.state);
  app.dirty = true; lsSet(K.pending, '1');
  if (message) app.pendingMessage = message;
  invalidate(); ensureMonth();
  persistSoon();
  schedulePublish();
  render();
  for (const fn of [...app.redrawSheets]) { try { fn(); } catch { app.redrawSheets.delete(fn); } }
}

export function undoLast() {
  const prev = app.undoStack.pop();
  if (!prev) { toast('Nothing to undo'); return; }
  app.state = prev;
  afterChange('Undo');
  toast('Undone');
}

export function replaceState(obj) {
  app.undoStack.push(structuredClone(app.state));
  app.state = obj;
  afterChange('Restored from backup');
  toast('Backup restored');
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try { lsSet(K.file, JSON.stringify(await C.sealJSON(app.state, app.key, app.salt, app.iter))); }
    catch (e) { console.warn('persist', e); }
  }, 250);
}

function schedulePublish(delay = 3000) {
  if (!isOwner() || app.cfg.local) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => publishNow(), delay);
}

export async function publishNow() {
  if (!isOwner() || app.cfg.local || !app.state) return;
  if (app.publishing) { app.publishAgain = true; return; }
  app.publishing = true; renderStatus();
  const rev = app.state.meta.rev;
  try {
    const file = await C.sealJSON(app.state, app.key, app.salt, app.iter);
    const sha = await G.putData(app.cfg, file, app.sha, 'Update data'); // neutral: the repository history is public
    app.sha = sha; lsSet(K.sha, sha); lsSet(K.file, JSON.stringify(file));
    if (app.state.meta.rev === rev) { app.dirty = false; lsSet(K.pending, null); app.pendingMessage = null; }
    app.lastPublished = new Date().toISOString(); lsSet(K.pub, app.lastPublished);
    app.syncError = null;
  } catch (e) {
    if (e.kind === 'conflict') { app.publishing = false; await resolveConflict(); return; }
    app.syncError = e.message;
  } finally {
    app.publishing = false; renderStatus();
    if (app.publishAgain) { app.publishAgain = false; schedulePublish(600); }
  }
}

async function resolveConflict() {
  let remote = null, remoteState = null;
  try { remote = await G.fetchData(app.cfg); if (remote.file) remoteState = await C.openJSON(remote.file, app.key); } catch { /* different passphrase or offline */ }
  const when = remoteState?.meta?.updated ? relTime(remoteState.meta.updated) : 'recently';
  const sheet = openSheet({
    title: 'Changed on another device',
    body: h('div.stack-sm',
      h('p', `The budget on GitHub was updated ${when} from another device, after this phone last loaded it. This phone also has unpublished changes.`),
      h('p.muted', 'GitHub keeps the replaced version in its history either way.')),
    footer: [
      h('button.btn.ghost', { type: 'button', onclick: async () => {
        sheet.close();
        if (!remote?.file) return;
        if (!remoteState) { toast('The GitHub version uses another passphrase. Unlock again.', { kind: 'warn' }); lsSet(K.pass, null); location.reload(); return; }
        app.state = remoteState; app.sha = remote.sha; app.dirty = false;
        lsSet(K.pending, null); lsSet(K.sha, remote.sha); lsSet(K.file, JSON.stringify(remote.file));
        app.undoStack = []; invalidate(); ensureMonth(); render(); toast('Loaded the GitHub version');
      } }, 'Use GitHub version'),
      h('button.btn.primary', { type: 'button', onclick: async () => { sheet.close(); app.sha = remote?.sha || null; await publishNow(); } }, 'Keep this phone\'s'),
    ],
  });
}

/** Pull the latest published data (viewer: always; owner: only when nothing is pending). */
export async function reloadRemote(userInitiated = false) {
  if (!app.cfg || app.cfg.local) { if (userInitiated) toast('This phone is not connected to GitHub yet'); return; }
  if (isOwner() && app.dirty) { await publishNow(); if (userInitiated && !app.syncError) toast('Published'); return; }
  try {
    const { file, sha } = await G.fetchData(app.cfg);
    app.lastFetch = Date.now();
    if (!file) { if (userInitiated) toast('Nothing published yet'); return; }
    if (sha && sha === app.sha && app.state) { app.syncError = null; renderStatus(); if (userInitiated) toast('Up to date'); return; }
    const pass = app.pass || lsGet(K.pass);
    if (!pass) { renderUnlock(); return; }
    const before = app.state?.meta?.rev;
    await openFile(file, pass);
    app.sha = sha || app.sha; if (app.sha) lsSet(K.sha, app.sha);
    lsSet(K.file, JSON.stringify(file));
    app.syncError = null;
    render();
    if (userInitiated) toast(app.state.meta.rev !== before ? 'Updated' : 'Up to date');
  } catch (e) {
    if (e instanceof C.WrongPassphrase) { app.state = null; app.key = null; lsSet(K.pass, null); renderUnlock('The passphrase was changed. Enter the new one.'); return; }
    app.syncError = e.message;
    if (app.state) renderStatus();
    if (userInitiated) toast(e.message, { kind: 'warn' });
  }
}

export async function changePassphrase(current, next) {
  if (current !== app.pass) throw new Error('The current passphrase is not right.');
  const salt = C.randomBytes(16);
  app.key = await C.deriveKey(next, salt, C.KDF_ITER);
  app.salt = salt; app.iter = C.KDF_ITER; app.pass = next;
  lsSet(K.pass, next);
  afterChange('Passphrase changed');
  await publishNow();
}

export function forgetDevice() {
  for (const k of Object.values(K)) lsSet(k, null);
  location.reload();
}

export function connectGitHub() { connectGitHubScreen(); }

// ───────────────────────── navigation & shell ─────────────────────────

export function navigate(tab, params = {}) {
  closeAllSheets();
  app.route.tab = tab;
  if (tab === 'activity') { app.route.filter = params.filter || 'all'; app.route.q = ''; }
  render();
  window.scrollTo(0, 0);
}

export function monthSwitcher() {
  const { list, months } = calc();
  const m = app.route.month;
  const i = list.indexOf(m);
  const go = (to) => { app.route.month = to; render(); };
  const f = months.get(m);
  const pick = () => {
    const sheet = openSheet({
      title: 'Month',
      body: h('ul.plain.months', [...list].reverse().map(x => {
        const fx = months.get(x);
        return h('li', h('button.row-btn', { type: 'button', class: x === m ? 'on' : '', onclick: () => { sheet.close(); go(x); } },
          h('span.grow', E.monthLabel(x, true), fx.history ? h('span.muted.small', ' · Coin Master') : fx.future ? h('span.muted.small', ' · upcoming') : null),
          h('span.amt', { class: fx.closing < 0 ? 'neg' : '' }, E.fmt(fx.closing, { round: true }))));
      })),
    });
  };
  return h('div.monthbar',
    h('button.icon-btn', { type: 'button', 'aria-label': 'Previous month', disabled: i <= 0, onclick: () => go(list[i - 1]) }, icon('left')),
    h('button.month-label', { type: 'button', onclick: pick }, E.monthLabel(m, true), f?.history ? h('span.pill', 'archive') : f?.future ? h('span.pill', 'upcoming') : null),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Next month', disabled: i >= list.length - 1, onclick: () => go(list[i + 1]) }, icon('right')));
}

function statusPill() {
  let text, cls = '';
  if (!isOwner()) { text = `Updated ${relTime(app.state.meta?.updated)}`; if (app.syncError) { cls = 'warn'; text = 'Offline · saved copy'; } }
  else if (app.cfg.local) { text = 'Only on this phone'; cls = 'warn'; }
  else if (app.publishing) text = 'Publishing…';
  else if (app.syncError) { text = app.dirty ? 'Not published' : 'Offline'; cls = 'warn'; }
  else if (app.dirty) text = 'Saving…';
  else text = app.lastPublished ? `Published ${relTime(app.lastPublished)}` : 'Up to date';
  return h('button.sync-pill', { type: 'button', class: cls, onclick: () => syncSheet() }, icon(cls ? 'alert' : 'cloud', 'sm'), text);
}

function syncSheet() {
  const lines = isOwner()
    ? [app.cfg.local ? 'Changes stay on this phone until you connect GitHub (Settings → Sync & security).' : app.dirty ? 'There are changes that are not on GitHub yet.' : 'Everything is published. Your wife\'s phone shows the same numbers.',
      app.syncError ? `Last problem: ${app.syncError}` : null]
    : [`Last change on the other phone: ${relTime(app.state.meta?.updated)}.`, app.syncError ? `Could not refresh: ${app.syncError}` : null];
  const sheet = openSheet({
    title: 'Sync', body: h('div.stack-sm', lines.filter(Boolean).map(l => h('p', l))),
    footer: [h('button.btn.primary', { type: 'button', onclick: async () => { sheet.close(); await reloadRemote(true); } }, isOwner() && app.dirty ? 'Publish now' : 'Refresh')],
  });
}

function renderStatus() {
  const pill = document.querySelector('.sync-pill');
  if (pill && app.state) pill.replaceWith(statusPill());
}

const TABS_OWNER = [['budget', 'Budget', 'home'], ['update', 'Update', 'update'], ['activity', 'Activity', 'list'], ['settings', 'Settings', 'settings']];
const TABS_VIEWER = [['budget', 'Budget', 'home'], ['activity', 'Activity', 'list'], ['settings', 'More', 'settings']];
const VIEWS = { budget: renderBudget, update: renderUpdate, activity: renderActivity, settings: renderSettings };
const TITLES = { budget: 'Budget', update: 'Update', activity: 'Activity', settings: 'Settings' };

export function render() {
  if (!app.state) return;
  const root = document.getElementById('app');
  const tabs = isOwner() ? TABS_OWNER : TABS_VIEWER;
  if (!tabs.some(t => t[0] === app.route.tab)) app.route.tab = 'budget';
  ensureMonth();
  const reviewCount = isOwner() ? E.reviewQueue(app.state).length : 0;
  const y = window.scrollY;
  let view;
  try { view = VIEWS[app.route.tab](); }
  catch (e) { console.error(e); view = h('section.card', h('h2', 'Something went wrong'), h('p.muted', String(e.message || e)), h('button.btn', { type: 'button', onclick: () => location.reload() }, 'Reload')); }
  root.replaceChildren(
    h('header.topbar', h('h1', TITLES[app.route.tab] || ''), statusPill()),
    h('main#view', view),
    h('nav.tabbar', { 'aria-label': 'Main' }, tabs.map(([k, label, ic]) => h('button', {
      type: 'button', class: app.route.tab === k ? 'on' : '', 'aria-current': app.route.tab === k ? 'page' : null,
      onclick: () => { if (app.route.tab === k) window.scrollTo({ top: 0, behavior: 'smooth' }); else navigate(k); },
    }, icon(ic), h('span', label), k === 'update' && reviewCount ? h('span.badge', String(reviewCount)) : null))),
  );
  window.scrollTo(0, y);
}

// ───────────────────────── boot ─────────────────────────

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version of the app is ready', { actions: [['Reload', () => location.reload()]], ms: 15000 });
        });
      });
    }).catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  app.cfg = lsJSON(K.cfg);
  if (!app.cfg) { renderWelcome(); return; }
  app.sha = lsGet(K.sha);
  app.dirty = lsGet(K.pending) === '1';
  app.lastPublished = lsGet(K.pub);
  const pass = lsGet(K.pass);
  const cached = lsJSON(K.file);
  renderLoading(pass ? 'Opening…' : 'Loading…');
  if (pass && cached) {
    try { await openFile(cached, pass); render(); } catch (e) { console.warn('cached copy', e); }
  }
  if (!app.cfg.local) {
    if (isOwner() && app.dirty && app.state) await publishNow();
    else if (pass) await reloadRemote(false);
  }
  if (!app.state) { renderUnlock(); return; }
  render();
}

document.addEventListener('visibilitychange', () => {
  if (!app.state || !app.cfg || app.cfg.local) return;
  if (document.visibilityState === 'hidden') { if (isOwner() && app.dirty && !app.publishing) publishNow(); return; }
  if (Date.now() - app.lastFetch > 30000) reloadRemote(false);
});
window.addEventListener('online', () => { if (isOwner() && app.dirty) publishNow(); else if (app.state) reloadRemote(false); });
window.addEventListener('beforeunload', (e) => { if (isOwner() && app.dirty && !app.cfg.local && app.publishing) { e.preventDefault(); } });

boot();
