// Minimal, dependency-free reader for bank exports: .xlsx (first worksheet) and .csv.
// Returns an array of rows (arrays of cell values). Date-formatted cells become
// ISO strings (YYYY-MM-DD); numbers stay numbers; everything else is text.

export async function readSpreadsheet(buffer, fileName = '') {
  const u8 = new Uint8Array(buffer);
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b; // "PK"
  if (isZip) return readXlsx(u8);
  if (/\.xls$/i.test(fileName) && u8[0] === 0xd0 && u8[1] === 0xcf) {
    throw new Error('Old .xls format: please export as .xlsx or .csv from George.');
  }
  return readCsv(decodeText(u8));
}

// ───────────── zip ─────────────

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function zipEntries(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (zip directory missing)');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('Corrupt .xlsx central directory');
    const method = u16(b, p + 10), csize = u32(b, p + 20), nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30), commentLen = u16(b, p + 32), local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = u16(b, local + 26), lExtraLen = u16(b, local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    entries.set(name, { method, data: b.subarray(start, start + csize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method !== 8) throw new Error('Unsupported compression in .xlsx');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip .xlsx files; please update it or use a .csv export.');
  const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(entries, name) {
  const e = entries.get(name) || entries.get(name.replace(/^\//, ''));
  if (!e) return null;
  return new TextDecoder().decode(await inflate(e));
}

// ───────────── xml helpers ─────────────

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescapeXml(m[1]) : null;
}
function textRuns(xml) { // all <t> contents, skipping phonetic runs
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? unescapeXml(m[1]) : '';
  return out;
}

function colIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/) || [''])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function isDateFormat(code) {
  const s = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[dmyhs]/i.test(s) && !/^[#0.,%\s-]*$/.test(s);
}

function excelDate(serial, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.round(serial * 86400000));
  return d.toISOString().slice(0, 10);
}

// ───────────── xlsx ─────────────

export async function readXlsx(u8) {
  const entries = zipEntries(u8);
  const wb = await readEntry(entries, 'xl/workbook.xml');
  if (!wb) throw new Error('Not a spreadsheet (.xlsx workbook missing)');
  const date1904 = /date1904="(1|true)"/.test(wb);
  const firstSheet = wb.match(/<sheet\b[^>]*>/);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (firstSheet) {
    const rid = attr(firstSheet[0], 'r:id');
    const rels = await readEntry(entries, 'xl/_rels/workbook.xml.rels');
    if (rid && rels) {
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(m[0], 'Id') === rid) {
          const target = attr(m[0], 'Target');
          sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        }
      }
    }
  }
  const shared = [];
  const sst = await readEntry(entries, 'xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? textRuns(m[1]) : '');
  const dateStyles = new Set();
  const styles = await readEntry(entries, 'xl/styles.xml');
  if (styles) {
    const custom = new Map();
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') || '');
    const xfs = (styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
    let i = 0;
    for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attr(m[0], 'numFmtId') || 0);
      if (BUILTIN_DATE.has(id) || (custom.has(id) && isDateFormat(custom.get(id)))) dateStyles.add(i);
      i++;
    }
  }
  const sheet = await readEntry(entries, sheetPath);
  if (!sheet) throw new Error('Worksheet missing in .xlsx');
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rAttr = rm[1] || rm[3] || '';
    const rIdx = Number((rAttr.match(/\sr="(\d+)"/) || [])[1] || rows.length + 1) - 1;
    const row = [];
    const body = rm[2] || '';
    let ci = 0;
    for (const cm of body.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const a = ' ' + (cm[1] ?? cm[2] ?? '');
      const ref = (a.match(/\sr="([A-Z]+\d+)"/) || [])[1];
      const idx = ref ? colIndex(ref) : ci;
      ci = idx + 1;
      const inner = cm[3] || '';
      const t = (a.match(/\st="([^"]+)"/) || [])[1] || 'n';
      const s = Number((a.match(/\ss="(\d+)"/) || [])[1] || -1);
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 'inlineStr') val = textRuns((inner.match(/<is>([\s\S]*?)<\/is>/) || ['', ''])[1]);
      else if (t === 's') val = v !== undefined ? (shared[Number(v)] ?? '') : '';
      else if (t === 'str' || t === 'e') val = v !== undefined ? unescapeXml(v) : '';
      else if (t === 'b') val = v === '1';
      else if (t === 'd') val = v ? unescapeXml(v).slice(0, 10) : '';
      else if (v !== undefined && v !== '') {
        const n = Number(v);
        val = dateStyles.has(s) && Number.isFinite(n) ? excelDate(n, date1904) : n;
      }
      row[idx] = val;
    }
    for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
    rows[rIdx] = row;
  }
  for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
  return rows;
}

// ───────────── csv ─────────────

function decodeText(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(u8);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  try { return new TextDecoder('windows-1252').decode(u8); } catch { return utf8; }
}

export function readCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [';', ',', '\t'].map(d => [d, (firstLine.match(new RegExp(d === '\t' ? '\\t' : d, 'g')) || []).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
