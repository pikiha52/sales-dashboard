// Run: node --test
// Reference numbers below were computed independently in Python from sales.csv.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV, buildReport, summaryText } = require('./report.js');
const { sendTelegram, renderView, keyboard, handleUpdate } = require('./send.js');

const HEADER = 'date,invoice_no,region,branch,outlet_id,outlet_name,outlet_type,salesman,brand,sku,qty_carton,price_per_carton_idr,gross_sales_idr,discount_idr,net_sales_idr';

test('parseCSV handles BOM, CRLF and quoted commas', () => {
  const rows = parseCSV('﻿a,b\r\n1,"x, ""y"""\r\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"' }]);
});

test('cleaning: duplicates dropped, region spelling unified, returns counted, names trimmed', () => {
  const csv = [HEADER,
    '2026-09-01,INV1,Jawa Barat,Bandung,O1,Toko A ,Warung,Andi,B1,S1,1,100,100,0,100',
    '2026-09-01,INV1,Jawa Barat,Bandung,O1,Toko A ,Warung,Andi,B1,S1,1,100,100,0,100', // exact duplicate
    '2026-09-02,INV2,Jabar,Bandung,O1,Toko A,Warung,,B1,S1,2,100,200,0,200',
    '2026-10-01,INV3,JAWA BARAT,Bandung,O2,Toko B,Warung,Budi,B2,S2,5,100,500,0,500',
    '2026-10-02,RTR1,Jawa Barat,Bandung,O2,Toko B,Warung,Budi,B2,S2,-1,100,-100,0,-100',
    '2026-10-03,INV4,Jawa Barat,Bandung,O3,Toko C,Warung,Budi,B2,S2,x,100,abc,0,abc', // invalid number
  ].join('\n');
  const r = buildReport(parseCSV(csv));
  assert.equal(r.total, 700);
  assert.equal(r.quality.duplicates, 1);
  assert.equal(r.quality.regionFixed, 2);
  assert.equal(r.quality.returns, 1);
  assert.equal(r.quality.invalid, 1);
  assert.deepEqual(r.byRegion.map(x => x.name), ['Jawa Barat']);
  assert.deepEqual(r.weakest.map(o => [o.id, o.name, o.net]), [['O1', 'Toko A', 300], ['O2', 'Toko B', 400]]);
});

test('missing required column is a clear error', () => {
  assert.throws(() => buildReport(parseCSV('date,region\n2026-09-01,X')), /net_sales_idr/);
});

test('sales.csv matches Python reference', () => {
  const r = buildReport(parseCSV(fs.readFileSync(path.join(__dirname, 'sales.csv'), 'utf8')));
  assert.equal(r.total, 1725966000);
  assert.equal(r.invoices, 824);
  assert.equal(r.quality.duplicates, 3);
  assert.equal(r.quality.regionFixed, 10);
  assert.deepEqual(r.byRegion.map(x => [x.name, x.net]), [
    ['Jabodetabek', 495827800], ['Sumatera', 340690500], ['Jawa Barat', 310947300],
    ['Jawa Tengah', 222881500], ['Jawa Timur', 211378500], ['Kalimantan', 144240400]]);
  assert.equal(r.byBrand[0].name, 'Kacang Dua Kelinci');
  assert.equal(r.byBrand[0].net, 739781900);
  assert.deepEqual(r.months.map(m => [m.key, m.net]), [['2026-09', 847517400], ['2026-10', 878448600]]);
  assert.deepEqual(r.weakest.map(o => o.id), ['OUT1003', 'OUT1026', 'OUT1035', 'OUT1045', 'OUT1042']);

  const s = summaryText(r);
  assert.ok(!s.includes('\n'), 'one paragraph');
  assert.ok(s.length < 4096, 'fits one Telegram message');
  for (const part of ['Rp 1.726,0 jt', 'Jabodetabek', 'Kalimantan', 'Kacang Dua Kelinci', 'OUT1003', '+3,6%'])
    assert.ok(s.includes(part), `summary mentions ${part}: ${s}`);
});

test('sendTelegram posts to every chat id and fails loudly on API error', async () => {
  const calls = [];
  const ok = async (url, opt) => { calls.push([url, JSON.parse(opt.body)]); return { ok: true, json: async () => ({ ok: true }) }; };
  await sendTelegram('TOKEN', '111, 222', 'halo', ok);
  assert.deepEqual(calls, [
    ['https://api.telegram.org/botTOKEN/sendMessage', { chat_id: '111', text: 'halo' }],
    ['https://api.telegram.org/botTOKEN/sendMessage', { chat_id: '222', text: 'halo' }]]);

  const bad = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: 'chat not found' }) });
  await assert.rejects(sendTelegram('TOKEN', '111', 'halo', bad), /chat not found/);
});

test('Telegram views: HTML formatted, escaped, under limit, every view renders', () => {
  const r = buildReport(parseCSV(fs.readFileSync(path.join(__dirname, 'sales.csv'), 'utf8')));
  r.weakest[0].name = 'Toko <A&B>';
  for (const v of ['sum', 'reg', 'brand', 'out']) {
    const t = renderView(r, v);
    assert.ok(t.length < 4096, v);
    assert.ok(!/<(?!\/?(b|i|code)>)/.test(t), `${v} has only allowed tags: ${t}`);
  }
  const sum = renderView(r, 'sum');
  for (const part of ['<b>', 'Rp 1.726,0 jt', 'Jabodetabek', 'Kacang Dua Kelinci', 'Toko &lt;A&amp;B&gt;', '3,6%'])
    assert.ok(sum.includes(part), `summary has ${part}`);
  assert.ok(renderView(r, 'reg').includes('Kalimantan'));
  assert.ok(renderView(r, 'brand').includes('Roni'));
  assert.ok(renderView(r, 'out').includes('OUT1042'));
  const kb = keyboard('reg').inline_keyboard.flat();
  assert.deepEqual(kb.map(b => b.callback_data).sort(), ['brand', 'out', 'reg', 'sum']);
  assert.ok(kb.find(b => b.callback_data === 'reg').text.startsWith('•'), 'active view marked');
});

test('bot: button press edits message in place; unknown chats get no sales data', async () => {
  const calls = [];
  const fetchImpl = async (url, opt) => { calls.push([url.split('/').pop(), JSON.parse(opt.body)]); return { ok: true, json: async () => ({ ok: true, result: {} }) }; };
  const ctx = { token: 'T', allowed: new Set(['111']), csvPath: path.join(__dirname, 'sales.csv'), fetchImpl };

  await handleUpdate({ callback_query: { id: 'q1', data: 'brand', message: { message_id: 7, chat: { id: 111 } } } }, ctx);
  assert.deepEqual(calls.map(c => c[0]), ['editMessageText', 'answerCallbackQuery']);
  assert.equal(calls[0][1].message_id, 7);
  assert.equal(calls[0][1].parse_mode, 'HTML');
  assert.ok(calls[0][1].text.includes('Kacang Dua Kelinci'));

  calls.length = 0;
  await handleUpdate({ message: { text: '/ringkasan', chat: { id: 111 } } }, ctx);
  assert.equal(calls[0][0], 'sendMessage');
  assert.ok(calls[0][1].reply_markup.inline_keyboard);

  calls.length = 0;
  await handleUpdate({ message: { text: '/ringkasan', chat: { id: 999 } } }, ctx);
  await handleUpdate({ callback_query: { id: 'q2', data: 'out', message: { message_id: 1, chat: { id: 999 } } } }, ctx);
  assert.ok(calls.every(c => !String(c[1].text || '').includes('Rp')), 'no sales data leaked to unknown chat');
});
