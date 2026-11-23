# Project context for Claude

## What this is
This is the build-test answer for the Dua Kelinci "AI Builder (Vibe Coder)" application. The brief is to take the sample `sales.csv` (Sep–Oct 2026, 1,891 invoice lines) and build a small web app that shows sales by region and brand, flags the 5 weakest outlets, and writes a one-paragraph summary a sales manager can read in Telegram. No hosting; the reviewer runs it locally from this repo.

**Status (2026-11-23):** done. The repo is pushed and the application email has been sent. The next stage, if shortlisted, is a 60-minute live build session.

## Architecture (no dependencies, on purpose)
- `report.js`: `parseCSV`, `buildReport`, `summaryText` plus formatting helpers (`jt`, `pct`, `signedPct`, `fmtDate`, `monthName`). Plain script: it defines browser globals and also sets `module.exports` for Node.
- `index.html`: static dashboard that loads `report.js` with a `<script>` tag. It works from `file://` through the file picker and auto-loads `sales.csv` when served over HTTP. UI text is in Bahasa Indonesia; bars and the heatmap are CSS only.
- `send.js`: Telegram bot written with Node's built-in `fetch` (no SDK).
  - `node send.js [csv] [--dry-run]` sends an HTML-formatted report with an inline keyboard (`sum`/`reg`/`brand`/`out`).
  - `node send.js [csv] --listen` runs a `getUpdates` long-poll. It edits the message in place on button presses and answers `/ringkasan`, `/start` and `/laporan`.
  - Only chat IDs in `TELEGRAM_CHAT_ID` receive data. Other chats get only their own chat ID back.
  - Config comes from `.env` next to `send.js` (gitignored; template in `.env.example`) via a tiny built-in reader, because Node 20.11 has no `process.loadEnvFile`.
- `report.test.js`: `node --test`, 7 tests. Reference numbers were computed independently in Python.

## Decisions
- Metric: `net_sales_idr`. Returns (negative rows, invoice prefix `RTR`) stay in and reduce net.
- "Weakest outlet" = lowest total net sales in the file period, ties broken by outlet id. The brief leaves it undefined. The UI also shows Sep→Oct change, invoice count and last order date. The sort lives in one place in `buildReport`.
- Cleaning:
  - exact duplicate rows are dropped (3);
  - region case and whitespace are normalized, with an alias map (`jabar`→Jawa Barat), and the canonical spelling is the most frequent raw one (10 rows fixed);
  - rows with a broken date or number are skipped and counted;
  - outlets are keyed by `outlet_id`, with names trimmed.

  All counts are surfaced in the UI and in the summary.

## Gotchas
- `send.js` sets `dns.setDefaultResultOrder('ipv4first')`. On networks with broken IPv6 routing, `fetch` to api.telegram.org failed with `UND_ERR_CONNECT_TIMEOUT` while `curl` worked. Do not remove it.
- Telegram HTML mode allows only a few tags, so all CSV text goes through `esc()`.
- Buttons only respond while `--listen` is running.

## Reference numbers (sales.csv)
- Net Rp 1,725,966,000, 824 invoices, 52 outlets, 1,888 rows after dedup.
- Sep Rp 847.5 jt, Oct Rp 878.4 jt (+3.6%). Jawa Barat had the biggest drop (−13.9%).
- Top region: Jabodetabek. Top brand: Kacang Dua Kelinci (42.9%).
- Weakest outlets: OUT1003, OUT1026, OUT1035, OUT1045, OUT1042.
