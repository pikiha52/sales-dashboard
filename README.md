# Sales Dashboard + Telegram Report

> 🇮🇩 Versi Bahasa Indonesia: [README.id.md](README.id.md)

This is a small web app for the sales sample (`sales.csv`, Sep–Oct 2026). It shows:

- sales by **region** and by **brand**, plus a region × brand table
- the **5 weakest outlets**, meaning the outlets with the lowest total net sales in the file's period
- a **one-paragraph summary** that a sales manager can read in Telegram, with a copy button
- an optional **Telegram bot** that sends a formatted report with buttons (Summary / Region / Brand / Weak outlets) to drill into details in the same message

There are no dependencies and no `npm install`. All figures use `net_sales_idr`.

## 1. Run the dashboard (nothing to install)

1. Double-click `index.html`. It opens in Chrome, Edge or Firefox.
2. Click **Pilih file CSV…** (Choose CSV file) and select `sales.csv`. Any CSV with the same columns also works.
3. Click **Salin ringkasan** (Copy summary) to copy the Telegram paragraph.

Optional: run `python -m http.server 8000` in this folder and open http://localhost:8000. `sales.csv` then loads automatically.

The UI text is in Bahasa Indonesia because it is written for the sales team.

## 2. Telegram report (optional)

Requires **Node.js 18+**.

1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token.
2. Open your new bot and press **Start**. Then open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and find `"chat":{"id": ...}`. That number is the chat ID.
3. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Separate several chat IDs with commas.

```
node send.js --dry-run            # print the report, send nothing
node send.js                      # send the report from ./sales.csv
node send.js D:\data\sales.csv    # send from another file
node send.js --listen             # keep running: answer button presses and /ringkasan
```

- The **buttons** only respond while `--listen` is running. Scheduled reports are still delivered without it.
- **Only the chat IDs in `.env` receive sales data.** Other chats get only their own chat ID back, so an admin can add them.
- To **schedule** the report, use Windows Task Scheduler or cron. The Indonesian README has ready-made `schtasks` and cron commands.

## Data cleaning

| Case in the data | Handling |
|---|---|
| Exact duplicate rows | dropped (sample: 3) |
| Region spelling variants (`Jabar`, `JAWA BARAT`) | unified to the most common spelling (sample: 10 rows) |
| Return (negative row, invoice `RTR…`) | kept; reduces net sales |
| Missing salesman | kept (sample: 5) |
| Broken date or number | row skipped and counted |
| Trailing spaces in outlet names | trimmed; outlets are keyed by `outlet_id` |

The dashboard lists these counts so that no figure changes silently.

**Why "weakest" = lowest total net sales:** the brief leaves the definition open, and this one is the simplest to explain. The table also shows Sep vs Oct, the % change, the invoice count and the last order date, so a manager can see context. For example, all 5 are small Toko/Warung outlets, and 4 of them grew in October. To change the rule, edit the single sort in `report.js`.

## Tests

```
node --test
```

The tests use only Node's built-in runner. Totals from `sales.csv` are checked against an independent Python calculation: Rp 1,725,966,000 net, 824 invoices, and the per-region, per-brand and per-month figures. The tests also cover the cleaning rules, HTML escaping in Telegram messages, and the bot handler, including that no data reaches unknown chats.

## Files

| File | Purpose |
|---|---|
| `index.html` | dashboard |
| `report.js` | CSV parsing, cleaning, aggregation, summary (shared by the browser and Node) |
| `send.js` | Telegram bot: sends the report and handles buttons |
| `report.test.js` | tests |
| `.env.example` | bot config template |
| `docs/` | design notes |
