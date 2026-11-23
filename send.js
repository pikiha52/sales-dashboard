// Telegram bot for the sales summary. No dependencies.
//   node send.js [sales.csv] [--dry-run]   send the report (with buttons) to TELEGRAM_CHAT_ID
//   node send.js [sales.csv] --listen      keep running: answer button presses and /ringkasan
// Config: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (comma-separated) from env or .env next to this file.
const fs = require('node:fs');
const path = require('node:path');
// Many office/ISP networks resolve api.telegram.org to IPv6 but can't route it; fetch then hangs with
// UND_ERR_CONNECT_TIMEOUT. Prefer IPv4.
require('node:dns').setDefaultResultOrder('ipv4first');
const { parseCSV, buildReport, jt, pct, signedPct, fmtDate, monthName } = require('./report.js');

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const trend = (a, b) => (a ? (b >= a ? '▲ ' : '▼ ') + signedPct((b - a) / a).slice(1) : '–');
const load = csvPath => buildReport(parseCSV(fs.readFileSync(csvPath, 'utf8')));

function header(r, title) {
  return `${title}\n<i>${fmtDate(r.period.start)} – ${fmtDate(r.period.end)}</i>\n`;
}

const VIEWS = {
  sum(r) {
    const [prev, last] = r.months.slice(-2);
    const top = r.byRegion[0], low = r.byRegion.at(-1);
    const drop = r.byRegion.map(x => ({ x, ch: x.months.at(-2) ? (x.months.at(-1) - x.months.at(-2)) / x.months.at(-2) : 0 })).sort((a, b) => a.ch - b.ch)[0];
    const [b1, ...rest] = r.byBrand;
    const q = r.quality;
    const notes = [q.duplicates && `${q.duplicates} duplikat dibuang`, q.regionFixed && `${q.regionFixed} region diseragamkan`, q.returns && `${q.returns} retur dihitung`, q.invalid && `${q.invalid} baris rusak diabaikan`].filter(Boolean);
    return [
      header(r, '📊 <b>LAPORAN PENJUALAN</b>'),
      `💰 <b>Net sales ${jt(r.total)}</b>`,
      `${r.invoices} invoice · ${r.outletCount} outlet`,
      last && prev ? `${monthName(last.key)} ${jt(last.net)} vs ${monthName(prev.key)} ${jt(prev.net)}  <b>${trend(prev.net, last.net)}</b>` : '',
      '',
      '🗺️ <b>Region</b>',
      `🥇 ${esc(top.name)} — ${jt(top.net)} (${pct(top.share)})`,
      low !== top ? `🔻 ${esc(low.name)} — ${jt(low.net)} (${pct(low.share)})` : '',
      drop && drop.ch < 0 ? `📉 Turun terbesar: ${esc(drop.x.name)} <b>${signedPct(drop.ch)}</b>` : '',
      '',
      '🏷️ <b>Brand utama</b>',
      `${esc(b1.name)} — ${jt(b1.net)} (${pct(b1.share)})`,
      rest.length ? `disusul ${rest.slice(0, 2).map(b => esc(b.name)).join(', ')}` : '',
      '',
      `⚠️ <b>${r.weakest.length} outlet terlemah</b> — perlu follow-up`,
      ...r.weakest.map((o, i) => `${i + 1}. ${esc(o.name)} · ${esc(o.branch)} · <b>${jt(o.net)}</b>`),
      '',
      notes.length ? `<i>Catatan data: ${notes.join(', ')}.</i>` : '',
      '👇 <i>Ketuk tombol untuk detail</i>',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  },
  reg(r) {
    const m = r.months.slice(-2);
    return header(r, '🗺️ <b>PENJUALAN PER REGION</b>') + '\n' + r.byRegion.map((x, i) =>
      `${i + 1}. <b>${esc(x.name)}</b> — ${jt(x.net)} (${pct(x.share)})` +
      (m.length === 2 ? `\n    ${monthName(m[0].key).slice(0, 3)} ${jt(x.months.at(-2))} → ${monthName(m[1].key).slice(0, 3)} ${jt(x.months.at(-1))}  ${trend(x.months.at(-2), x.months.at(-1))}` : '')
    ).join('\n');
  },
  brand(r) {
    return header(r, '🏷️ <b>PENJUALAN PER BRAND</b>') + '\n' + r.byBrand.map((x, i) =>
      `${i + 1}. <b>${esc(x.name)}</b> — ${jt(x.net)}\n    ${'█'.repeat(Math.max(1, Math.round(x.share * 20)))} ${pct(x.share)}`).join('\n');
  },
  out(r) {
    const m = r.months.slice(-2);
    return header(r, '⚠️ <b>5 OUTLET TERLEMAH</b>') + '<i>Net sales terendah dalam periode</i>\n\n' + r.weakest.map((o, i) =>
      `${i + 1}. <b>${esc(o.name)}</b> <code>${esc(o.id)}</code>\n` +
      `    ${esc(o.type)} · ${esc(o.branch)}, ${esc(o.region)}\n` +
      `    Total <b>${jt(o.net)}</b> · ${o.invoices} invoice` +
      (m.length === 2 ? `\n    ${monthName(m[0].key).slice(0, 3)} ${jt(o.months.at(-2))} → ${monthName(m[1].key).slice(0, 3)} ${jt(o.months.at(-1))}  ${trend(o.months.at(-2), o.months.at(-1))}` : '') +
      `\n    Order terakhir: ${fmtDate(o.lastDate)}`).join('\n\n');
  },
};

const renderView = (r, view) => (VIEWS[view] || VIEWS.sum)(r);

function keyboard(active) {
  const b = (text, data) => ({ text: (data === active ? '• ' : '') + text, callback_data: data });
  return { inline_keyboard: [[b('📊 Ringkasan', 'sum'), b('🗺️ Region', 'reg')], [b('🏷️ Brand', 'brand'), b('⚠️ Outlet lemah', 'out')]] };
}

async function api(token, method, body, fetchImpl = fetch, timeoutMs = 15000) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`Telegram ${method} gagal${body.chat_id ? ' untuk ' + body.chat_id : ''}: ${data.description || 'HTTP ' + res.status}`);
  return data.result;
}

async function sendTelegram(token, chatIds, text, fetchImpl = fetch, extra = {}) {
  for (const chat_id of String(chatIds).split(',').map(s => s.trim()).filter(Boolean))
    await api(token, 'sendMessage', { chat_id, text, ...extra }, fetchImpl);
}

const viewMessage = (r, view) => ({ text: renderView(r, view), parse_mode: 'HTML', reply_markup: keyboard(view) });

async function handleUpdate(u, { token, allowed, csvPath, fetchImpl = fetch }) {
  const call = (method, body) => api(token, method, body, fetchImpl);
  if (u.callback_query) {
    const q = u.callback_query, chatId = String(q.message.chat.id);
    if (!allowed.has(chatId)) return call('answerCallbackQuery', { callback_query_id: q.id, text: 'Chat ini tidak terdaftar.' });
    try {
      await call('editMessageText', { chat_id: chatId, message_id: q.message.message_id, ...viewMessage(load(csvPath), q.data) });
    } catch (e) {
      if (!/not modified/.test(e.message)) throw e; // same button pressed twice
    }
    return call('answerCallbackQuery', { callback_query_id: q.id });
  }
  const msg = u.message;
  if (!msg || !msg.text) return;
  const chatId = String(msg.chat.id);
  // Never send sales data to chats that are not in TELEGRAM_CHAT_ID; show the id so an admin can add it.
  if (!allowed.has(chatId)) return call('sendMessage', { chat_id: chatId, text: `Chat ini belum terdaftar untuk laporan penjualan. Chat ID: ${chatId}` });
  if (/^\/(start|ringkasan|laporan)\b/.test(msg.text)) return call('sendMessage', { chat_id: chatId, ...viewMessage(load(csvPath), 'sum') });
}

async function listen(ctx) {
  let offset = 0;
  console.log('Bot aktif. Tekan Ctrl+C untuk berhenti.');
  for (;;) {
    try {
      const updates = await api(ctx.token, 'getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, ctx.fetchImpl, 60000);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u, ctx).catch(e => console.error(new Date().toISOString(), e.message));
      }
    } catch (e) {
      // ponytail: fixed 5 s retry on network/API errors; fine for one bot, one machine.
      console.error(new Date().toISOString(), e.message);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

// ponytail: minimal KEY=VALUE .env reader; Node 20.11 lacks process.loadEnvFile.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = path.resolve(args.find(a => !a.startsWith('--')) || path.join(__dirname, 'sales.csv'));
  loadEnv(path.join(__dirname, '.env'));
  const report = load(csvPath);
  if (args.includes('--dry-run')) return console.log(renderView(report, 'sum').replace(/<\/?(b|i|code)>/g, ''));

  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatIds } = process.env;
  if (!token || !chatIds) throw new Error('TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID belum diisi (lihat .env.example).');
  if (args.includes('--listen'))
    return listen({ token, csvPath, allowed: new Set(chatIds.split(',').map(s => s.trim())) });

  const { text, ...extra } = viewMessage(report, 'sum');
  await sendTelegram(token, chatIds, text, fetch, extra);
  console.log(`[${new Date().toISOString()}] Laporan terkirim ke ${chatIds}`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { sendTelegram, renderView, keyboard, handleUpdate };
