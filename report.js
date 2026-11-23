// Shared sales logic: used by index.html (browser) and send.js (Node). No dependencies.

const REQUIRED = ['date', 'invoice_no', 'region', 'branch', 'outlet_id', 'outlet_name', 'outlet_type', 'brand', 'net_sales_idr'];
// ponytail: alias list for region shorthands seen in data; case/space differences are handled generically.
const REGION_ALIAS = { jabar: 'jawa barat', jateng: 'jawa tengah', jatim: 'jawa timur', jabotabek: 'jabodetabek' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  const header = (rows.shift() || []).map(h => h.trim());
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

const regionKey = s => { const k = s.toLowerCase().replace(/\s+/g, ' '); return REGION_ALIAS[k] || k; };

function sumBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + r.net); }
  return m;
}

function buildReport(raw) {
  const missing = REQUIRED.filter(c => raw.length && !(c in raw[0]));
  if (missing.length) throw new Error('Kolom wajib tidak ada di CSV: ' + missing.join(', '));

  const quality = { duplicates: 0, invalid: 0, regionFixed: 0, returns: 0, missingSalesman: 0 };
  const seen = new Set();
  const rows = [];
  for (const r of raw) {
    const key = Object.values(r).join('\u0001');
    if (seen.has(key)) { quality.duplicates++; continue; }
    seen.add(key);
    const net = Number(r.net_sales_idr);
    if (!Number.isFinite(net) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.outlet_id) { quality.invalid++; continue; }
    if (net < 0) quality.returns++;
    if (!r.salesman) quality.missingSalesman++;
    rows.push({ ...r, net, month: r.date.slice(0, 7), regionKey: regionKey(r.region) });
  }

  // Canonical region spelling = most frequent raw spelling of that region.
  const spellings = new Map();
  for (const r of rows) {
    const m = spellings.get(r.regionKey) || new Map();
    m.set(r.region, (m.get(r.region) || 0) + 1);
    spellings.set(r.regionKey, m);
  }
  const canon = new Map([...spellings].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  for (const r of rows) {
    const name = canon.get(r.regionKey);
    if (name !== r.region) quality.regionFixed++;
    r.region = name;
  }

  const total = rows.reduce((s, r) => s + r.net, 0);
  const sorted = m => [...m].map(([name, net]) => ({ name, net, share: total ? net / total : 0 })).sort((a, b) => b.net - a.net);
  const monthKeys = [...new Set(rows.map(r => r.month))].sort();
  const byRegionMonth = sumBy(rows, r => r.region + '|' + r.month);

  const byRegion = sorted(sumBy(rows, r => r.region)).map(x => ({
    ...x, months: monthKeys.map(k => byRegionMonth.get(x.name + '|' + k) || 0),
  }));
  const byBrand = sorted(sumBy(rows, r => r.brand));
  const matrix = Object.fromEntries([...sumBy(rows, r => r.region + '|' + r.brand)].map(([k, v]) => [k, v]));

  const outlets = new Map();
  for (const r of rows) {
    const o = outlets.get(r.outlet_id) || { id: r.outlet_id, name: r.outlet_name, type: r.outlet_type, branch: r.branch, region: r.region, net: 0, months: monthKeys.map(() => 0), invoices: new Set(), lastDate: '' };
    o.net += r.net;
    o.months[monthKeys.indexOf(r.month)] += r.net;
    o.invoices.add(r.invoice_no);
    if (r.date > o.lastDate) o.lastDate = r.date;
    outlets.set(r.outlet_id, o);
  }
  // ponytail: "weakest" = lowest total net sales in the file's period; tie broken by outlet id for stable output.
  const weakest = [...outlets.values()]
    .sort((a, b) => a.net - b.net || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map(o => ({ ...o, invoices: o.invoices.size }));

  const dates = rows.map(r => r.date).sort();
  return {
    total, quality, byRegion, byBrand, matrix, weakest,
    invoices: new Set(rows.map(r => r.invoice_no)).size,
    outletCount: outlets.size,
    rowCount: rows.length,
    period: { start: dates[0], end: dates[dates.length - 1] },
    months: monthKeys.map(key => ({ key, net: rows.filter(r => r.month === key).reduce((s, r) => s + r.net, 0) })),
  };
}

const jt = n => 'Rp ' + (n / 1e6).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' jt';
const pct = x => (x * 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const signedPct = x => (x >= 0 ? '+' : '−') + pct(Math.abs(x));
const fmtDate = d => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const monthName = key => MONTHS_LONG[+key.slice(5, 7) - 1];

function summaryText(r) {
  if (!r.rowCount) return 'Tidak ada data penjualan yang valid di file ini.';
  const parts = [`Ringkasan penjualan ${fmtDate(r.period.start)} – ${fmtDate(r.period.end)}: net sales ${jt(r.total)} dari ${r.invoices} invoice di ${r.outletCount} outlet`];
  if (r.months.length >= 2) {
    const [a, b] = r.months.slice(-2);
    parts[0] += `; ${monthName(b.key)} ${jt(b.net)} vs ${monthName(a.key)} ${jt(a.net)} (${a.net ? signedPct((b.net - a.net) / a.net) : 'n/a'})`;
  }
  const top = r.byRegion[0], low = r.byRegion[r.byRegion.length - 1];
  let region = `Region terbesar ${top.name} ${jt(top.net)} (${pct(top.share)})`;
  if (low !== top) region += `, terkecil ${low.name} ${jt(low.net)} (${pct(low.share)})`;
  if (r.months.length >= 2) {
    const drop = r.byRegion
      .map(x => ({ name: x.name, ch: x.months.at(-2) ? (x.months.at(-1) - x.months.at(-2)) / x.months.at(-2) : 0 }))
      .sort((a, b) => a.ch - b.ch)[0];
    if (drop && drop.ch < 0) region += `; penurunan terbesar di ${drop.name} (${signedPct(drop.ch)})`;
  }
  parts.push(region);
  const [b1, ...rest] = r.byBrand;
  parts.push(`Brand utama ${b1.name} ${jt(b1.net)} (${pct(b1.share)})` + (rest.length ? `, disusul ${rest.slice(0, 2).map(b => b.name).join(' dan ')}` : ''));
  parts.push(`${r.weakest.length} outlet terlemah, perlu follow-up salesman: ` +
    r.weakest.map(o => `${o.name} (${o.id}, ${o.branch}) ${jt(o.net)}`).join('; '));
  const q = r.quality, notes = [];
  if (q.duplicates) notes.push(`${q.duplicates} baris duplikat dibuang`);
  if (q.regionFixed) notes.push(`${q.regionFixed} penulisan region diseragamkan`);
  if (q.returns) notes.push(`${q.returns} retur ikut mengurangi net`);
  if (q.invalid) notes.push(`${q.invalid} baris tidak valid diabaikan`);
  if (notes.length) parts.push('Catatan data: ' + notes.join(', '));
  return parts.join('. ') + '.';
}

if (typeof module !== 'undefined') module.exports = { parseCSV, buildReport, summaryText, jt, pct, signedPct, fmtDate, monthName };
