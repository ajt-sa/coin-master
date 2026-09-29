// Reading and publishing the encrypted data file in the GitHub repository.
// Viewers read without any key; only the owner's phone holds a token that can write.

const API = 'https://api.github.com';
export const DATA_PATH = 'data/budget.enc.json';

/** https://owner.github.io/repo/ → {owner, repo}. Returns null for other hosts. */
export function repoFromLocation(loc = globalThis.location) {
  if (!loc) return null;
  const m = String(loc.hostname).match(/^([a-z0-9-]+)\.github\.io$/i);
  if (!m) return null;
  const seg = String(loc.pathname).split('/').filter(Boolean)[0];
  return { owner: m[1], repo: seg || `${m[1]}.github.io` };
}

export class SyncError extends Error {
  constructor(message, status, kind) { super(message); this.status = status; this.kind = kind; }
}

function headers(cfg, accept = 'application/vnd.github+json') {
  const h = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}

function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u8);
}
function b64encodeUtf8(str) {
  const u8 = new TextEncoder().encode(str);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const contentsUrl = (cfg) => `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path || DATA_PATH}`;

/**
 * Latest data file. Returns {file, sha, via} or {file: null} when nothing has been published yet.
 * Tries the API first (always fresh), then raw.githubusercontent.com, then the Pages copy.
 */
export async function fetchData(cfg) {
  const errors = [];
  if (cfg.owner && cfg.repo) {
    try {
      const url = `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch || 'main')}&t=${Date.now()}`;
      const r = await fetch(url, { headers: headers(cfg), cache: 'no-store' });
      if (r.status === 404) return { file: null, sha: null, via: 'api' };
      if (r.ok) {
        const j = await r.json();
        let text;
        if (j.content && j.encoding === 'base64') text = b64decodeUtf8(j.content);
        else {
          const raw = await fetch(url, { headers: headers(cfg, 'application/vnd.github.raw+json'), cache: 'no-store' });
          if (!raw.ok) throw new SyncError('Could not download the data file', raw.status);
          text = await raw.text();
        }
        return { file: JSON.parse(text), sha: j.sha, via: 'api' };
      }
      errors.push(`GitHub API ${r.status}`);
      if (r.status === 401) throw new SyncError('The GitHub access key was rejected. It may have expired: create a new one and paste it in Settings → Sync.', 401, 'auth');
    } catch (e) {
      if (e instanceof SyncError && e.kind === 'auth') throw e;
      errors.push(e.message);
    }
    // Rate-limited or offline API: raw file CDN (up to ~5 min behind)
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/${cfg.path || DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) return { file: await r.json(), sha: null, via: 'raw' };
      if (r.status === 404 && !errors.length) return { file: null, sha: null, via: 'raw' };
      errors.push(`raw ${r.status}`);
    } catch (e) { errors.push(e.message); }
  }
  // Same-origin GitHub Pages copy (works for custom domains too)
  try {
    const r = await fetch(`./${cfg.path || DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) return { file: await r.json(), sha: null, via: 'pages' };
    if (r.status === 404) errors.push('pages 404');
  } catch (e) { errors.push(e.message); }
  throw new SyncError(`Could not reach GitHub (${errors.join('; ')}). Showing the copy saved on this phone.`, 0, 'offline');
}

/** Current sha of the data file (owner only), null if it does not exist. */
export async function currentSha(cfg) {
  const r = await fetch(`${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch || 'main')}&t=${Date.now()}`, { method: 'GET', headers: headers(cfg), cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new SyncError(`GitHub answered ${r.status}`, r.status);
  return (await r.json()).sha;
}

/** Publish (create or replace) the encrypted file. Throws SyncError kind 'conflict' when someone else published first. */
export async function putData(cfg, fileObj, sha, message) {
  if (!cfg.token) throw new SyncError('No GitHub access key on this device', 0, 'auth');
  const body = { message: message || 'Budget update', content: b64encodeUtf8(JSON.stringify(fileObj)), branch: cfg.branch || 'main' };
  if (sha) body.sha = sha;
  let r;
  try {
    r = await fetch(contentsUrl(cfg), { method: 'PUT', headers: { ...headers(cfg), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new SyncError('Offline: saved on this phone, will publish when you are back online.', 0, 'offline');
  }
  if (r.status === 409 || (r.status === 422 && !sha)) throw new SyncError('The data on GitHub changed since this phone last loaded it.', r.status, 'conflict');
  if (r.status === 401 || r.status === 403) throw new SyncError('GitHub refused the update: check the access key has "Contents: read and write" for this repository.', r.status, 'auth');
  if (!r.ok) {
    let msg = `GitHub answered ${r.status}`;
    try { msg += ': ' + (await r.json()).message; } catch { /* ignore */ }
    throw new SyncError(msg, r.status, r.status === 422 ? 'conflict' : 'other');
  }
  const j = await r.json();
  return j.content.sha;
}

/** Validate a token against the repository: can it write? */
export async function checkAccess(cfg) {
  let r;
  try {
    r = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: headers(cfg), cache: 'no-store' });
  } catch {
    return { ok: false, message: 'No connection to GitHub.' };
  }
  if (r.status === 404) return { ok: false, message: `Repository ${cfg.owner}/${cfg.repo} not found (or the key cannot see it).` };
  if (r.status === 401) return { ok: false, message: 'The access key is not valid.' };
  if (!r.ok) return { ok: false, message: `GitHub answered ${r.status}.` };
  const j = await r.json();
  const branch = j.default_branch || 'main';
  if (cfg.token && j.permissions && !j.permissions.push) return { ok: false, message: 'This key can read but not write. Give it "Contents: Read and write".', branch };
  return { ok: true, branch, isPrivate: j.private };
}
