// First run on a phone: owner (GitHub key + passphrase, optional first data file) or view-only (passphrase).
import * as E from './engine.js';
import * as C from './crypto.js';
import * as G from './github.js';
import { h, icon, field, confirmSheet } from './ui.js';
import { app, finishSetup, unlockWithPassphrase } from './app.js';

function screen(...kids) {
  const root = document.getElementById('app');
  root.replaceChildren(h('main.setup', h('div.setup-inner', ...kids)));
  window.scrollTo(0, 0);
}

function brand() {
  return h('div.brand', h('img', { src: 'icon-192.png', alt: '', width: 56, height: 56 }), h('div', h('h1', 'Coin Master'), h('p.muted', 'Your household budget, on both phones')));
}

export function renderWelcome() {
  screen(brand(),
    h('section.card',
      h('h2', 'Set up this phone'),
      h('button.choice', { type: 'button', onclick: () => ownerStep1() }, icon('update'), h('span', h('strong', 'I update the budget'), h('span.muted.small.block', 'Imports bank exports, files transactions. Needs the GitHub key once.'))),
      h('button.choice', { type: 'button', onclick: () => viewerStep() }, icon('eye'), h('span', h('strong', 'View only'), h('span.muted.small.block', 'Sees the same numbers. Needs only the passphrase.')))),
    h('p.muted.small.center', 'Everything is encrypted on the phone before it is published.'));
}

// ───────────────────────── viewer ─────────────────────────

function viewerStep(message) {
  const loc = G.repoFromLocation();
  const pass = h('input', { type: 'password', autocomplete: 'current-password', autocapitalize: 'none', spellcheck: false, placeholder: 'e.g. maple-otter-lantern-…' });
  const status = h('p.muted.small');
  const go = async () => {
    if (!pass.value.trim()) { pass.focus(); return; }
    status.textContent = 'Opening…';
    const cfg = { role: 'viewer', ...(loc || {}), branch: 'main', path: G.DATA_PATH };
    try {
      const { file } = await G.fetchData(cfg);
      if (!file) { status.textContent = 'Nothing has been published yet. Ask for the first update on the other phone.'; return; }
      await finishSetup({ cfg, pass: pass.value.trim(), file });
    } catch (e) {
      status.textContent = e instanceof C.WrongPassphrase ? 'That passphrase does not open the data. Check spelling and dashes.' : e.message;
    }
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  screen(brand(), h('section.card',
    h('h2', 'View only'),
    message ? h('p.notice.warn', message) : null,
    field('Passphrase', pass, 'Asked once. It stays on this phone.'),
    h('button.btn.primary.wide', { type: 'button', onclick: go }, 'Open the budget'), status),
    h('button.link.center', { type: 'button', onclick: renderWelcome }, 'Back'));
  setTimeout(() => pass.focus(), 80);
}

// ───────────────────────── owner ─────────────────────────

function tokenHelp() {
  return h('details.help',
    h('summary', 'How to create the key (2 minutes, free)'),
    h('ol',
      h('li', 'On github.com: your picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
      h('li', 'Name: “Coin Master phone”. Expiration: No expiration.'),
      h('li', 'Repository access: Only select repositories → pick the Coin Master repository.'),
      h('li', 'Permissions → Repository permissions → Contents: Read and write.'),
      h('li', 'Generate, copy the key (starts with github_pat_) and paste it here.')));
}

function ownerStep1({ local = false, keepState = false } = {}) {
  const loc = G.repoFromLocation() || {};
  const owner = h('input', { type: 'text', value: loc.owner || app.cfg?.owner || '', autocapitalize: 'none', spellcheck: false, placeholder: 'your GitHub user name' });
  const repo = h('input', { type: 'text', value: loc.repo || app.cfg?.repo || 'coin-master', autocapitalize: 'none', spellcheck: false });
  const token = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' });
  const status = h('p.muted.small');
  const next = async () => {
    const cfg = { role: 'owner', owner: owner.value.trim(), repo: repo.value.trim(), token: token.value.trim(), path: G.DATA_PATH, branch: 'main' };
    if (!cfg.owner || !cfg.repo || !cfg.token) { status.textContent = 'All three fields are needed.'; return; }
    status.textContent = 'Checking…';
    const acc = await G.checkAccess(cfg);
    if (!acc.ok) { status.textContent = acc.message; return; }
    cfg.branch = acc.branch || 'main';
    status.textContent = 'Looking for published data…';
    try {
      const { file, sha } = await G.fetchData(cfg);
      if (keepState) return finishSetup({ cfg, pass: app.pass, state: app.state, publish: true, remoteFile: file, remoteSha: sha });
      if (file) ownerUnlock(cfg, file, sha);
      else ownerFirstData(cfg);
    } catch (e) { status.textContent = e.message; }
  };
  screen(brand(), h('section.card',
    h('h2', keepState ? 'Connect GitHub' : 'Your GitHub repository'),
    h('p.muted', 'The app and the encrypted budget file live there. Only this phone gets a key that can publish.'),
    field('GitHub user', owner), field('Repository', repo), field('Access key', token), tokenHelp(),
    h('button.btn.primary.wide', { type: 'button', onclick: next }, 'Continue'), status),
    keepState ? h('button.link.center', { type: 'button', onclick: () => location.reload() }, 'Cancel') :
      h('div.center.stack-sm',
        h('button.link', { type: 'button', onclick: () => ownerFirstData({ role: 'owner', local: true }) }, 'Try it on this phone only (connect GitHub later)'),
        h('button.link', { type: 'button', onclick: renderWelcome }, 'Back')));
}
export function connectGitHubScreen() { ownerStep1({ keepState: true }); }

function ownerUnlock(cfg, file, sha) {
  const pass = h('input', { type: 'password', autocomplete: 'current-password', autocapitalize: 'none', spellcheck: false });
  const status = h('p.muted.small');
  const go = async () => {
    status.textContent = 'Opening…';
    try { await finishSetup({ cfg, pass: pass.value.trim(), file, sha }); }
    catch (e) { status.textContent = e instanceof C.WrongPassphrase ? 'That passphrase does not open the data.' : e.message; }
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  screen(brand(), h('section.card', h('h2', 'Unlock'), h('p.muted', 'Budget data found in the repository. Enter the passphrase you chose.'),
    field('Passphrase', pass), h('button.btn.primary.wide', { type: 'button', onclick: go }, 'Unlock'), status));
  setTimeout(() => pass.focus(), 80);
}

function ownerFirstData(cfg) {
  let seed = null;
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const errs = E.validateState(obj);
      if (errs.length) throw new Error(errs.join(', '));
      seed = obj;
      seedInfo.textContent = `✓ ${f.name}: ${obj.txns.length} transactions, ${Object.keys(obj.history || {}).length} Coin Master months, starts ${E.monthLabel(obj.settings.startMonth)} at ${E.fmt(obj.settings.opening)}`;
      seedInfo.className = 'status good';
    } catch (err) { seed = null; seedInfo.textContent = 'Not a Coin Master seed file: ' + err.message; seedInfo.className = 'notice warn'; }
  } });
  const seedInfo = h('p.muted.small', 'coin-master-seed.json, from the “private” folder next to the app files');
  const pass = h('input', { type: 'text', value: C.suggestPassphrase(), autocomplete: 'off', autocapitalize: 'none', spellcheck: false });
  const strength = h('span.field-hint');
  const upd = () => { const s = C.passphraseStrength(pass.value); strength.textContent = s.label; strength.className = 'field-hint ' + (s.ok ? '' : 'warn'); };
  pass.addEventListener('input', upd); upd();
  const confirmBox = h('input', { type: 'checkbox' });
  const status = h('p.muted.small');
  const go = async () => {
    if (!seed) { status.textContent = 'Choose the seed file first.'; return; }
    if (!C.passphraseStrength(pass.value).ok) { pass.focus(); return; }
    if (!confirmBox.checked) { status.textContent = 'Please confirm you saved the passphrase.'; return; }
    status.textContent = cfg.local ? 'Encrypting…' : 'Encrypting and publishing…';
    try { await finishSetup({ cfg, pass: pass.value.trim(), state: seed, publish: !cfg.local }); }
    catch (e) { status.textContent = e.message; }
  };
  screen(brand(), h('section.card',
    h('h2', 'First data'),
    h('p.muted', 'Load the file converted from Coin Master: categories, budget plan, rules, history up to July 2026 and the July closing balance.'),
    fileIn, h('button.btn.wide', { type: 'button', onclick: () => fileIn.click() }, icon('file', 'sm'), 'Choose seed file'), seedInfo,
    h('label.field', h('span.field-label', 'Passphrase (you and your wife type it once)'), pass, strength),
    h('button.link.small', { type: 'button', onclick: () => { pass.value = C.suggestPassphrase(); upd(); } }, 'Suggest another'),
    h('label.check', confirmBox, 'I saved this passphrase (e.g. in my password manager). Without it the data cannot be opened.'),
    h('button.btn.primary.wide', { type: 'button', onclick: go }, cfg.local ? 'Start on this phone' : 'Encrypt & publish'), status),
    h('button.link.center', { type: 'button', onclick: () => cfg.local ? renderWelcome() : ownerStep1() }, 'Back'));
}

// ───────────────────────── unlock (returning phone) ─────────────────────────

export function renderUnlock(message) {
  if (app.cfg && app.cfg.role === 'viewer') return viewerStep(message);
  const pass = h('input', { type: 'password', autocomplete: 'current-password', autocapitalize: 'none', spellcheck: false });
  const status = h('p.muted.small');
  const go = async () => {
    status.textContent = 'Opening…';
    try { await unlockWithPassphrase(pass.value.trim()); }
    catch (e) { status.textContent = e instanceof C.WrongPassphrase ? 'That passphrase does not open the data.' : e.message; }
  };
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  screen(brand(), h('section.card', h('h2', 'Unlock'), message ? h('p.notice.warn', message) : null,
    field('Passphrase', pass), h('button.btn.primary.wide', { type: 'button', onclick: go }, 'Unlock'), status),
    h('button.link.center', { type: 'button', onclick: async () => { if (await confirmSheet({ title: 'Set up this phone again?', message: 'Removes the saved settings from this phone. Published data on GitHub is not touched.', confirm: 'Reset', danger: true })) { localStorage.clear(); location.reload(); } } }, 'Set up again'));
  setTimeout(() => pass.focus(), 80);
}

export function renderLoading(text = 'Loading…') {
  const root = document.getElementById('app');
  root.replaceChildren(h('main.setup', h('div.setup-inner', brand(), h('p.muted.center', text))));
}
