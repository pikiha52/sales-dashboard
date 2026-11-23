# Dashboard Penjualan + Ringkasan Telegram

> 🇬🇧 English version: [README.md](README.md)

Aplikasi web kecil untuk data penjualan (`sales.csv`). Isinya:

- penjualan per **region** dan per **brand**, plus tabel region × brand,
- **5 outlet terlemah**, yaitu outlet dengan net sales terendah dalam periode file,
- **ringkasan satu paragraf** untuk sales manager, yang bisa disalin manual dari dashboard,
- **laporan Telegram otomatis** dari bot. Laporannya rapi, dengan tombol **Ringkasan / Region / Brand / Outlet lemah** untuk melihat detail di pesan yang sama.

Tidak ada library atau `npm install`. Semua angka memakai `net_sales_idr`.

## 1. Membuka dashboard (tanpa instalasi apa pun)

1. Ekstrak zip.
2. Klik dua kali `index.html`. Halaman akan terbuka di Chrome, Edge, atau Firefox.
3. Klik **Pilih file CSV…**, lalu pilih `sales.csv`. File CSV lain dengan kolom yang sama juga bisa dipakai.
4. Untuk mengambil ringkasan, klik **Salin ringkasan**, lalu tempel di Telegram.

Opsional: kalau Python terpasang, jalankan `python -m http.server 8000` di folder ini, lalu buka http://localhost:8000. Dengan cara ini `sales.csv` dimuat otomatis.

## 2. Kirim ringkasan otomatis ke Telegram

Butuh **Node.js 18 atau lebih baru** (https://nodejs.org).

**a. Buat bot dan ambil chat ID (sekali saja)**

1. Di Telegram, buka **@BotFather**, kirim `/newbot`, lalu ikuti langkahnya. Simpan **token** yang diberikan.
2. Minta sales manager membuka bot itu dan menekan **Start**. Untuk grup: tambahkan bot ke grup, lalu kirim satu pesan di grup.
3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates` di browser dan cari `"chat":{"id": ...}`. Angka itu adalah **chat ID**. Untuk grup, angkanya diawali `-`.

**b. Isi konfigurasi**

Salin `.env.example` menjadi `.env`, lalu isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID`. Kalau penerimanya lebih dari satu, pisahkan chat ID dengan koma. Jangan bagikan file `.env` karena berisi token bot.

**c. Uji**

```
node send.js --dry-run          # hanya menampilkan ringkasan, tidak mengirim
node send.js                    # kirim ringkasan dari sales.csv di folder ini
node send.js D:\data\sales.csv  # kirim dari file CSV lain
```

Kalau gagal, perintah ini keluar dengan kode 1 dan menampilkan pesan dari Telegram, misalnya `chat not found`.

**Tombol interaktif (opsional, tapi disarankan)**

Pesan laporan punya 4 tombol. Agar tombol bisa ditekan, bot harus sedang berjalan:

```
node send.js --listen
```

Selama perintah ini berjalan:
- Menekan tombol akan mengganti isi pesan dengan detail region, brand, atau outlet. Angkanya dihitung ulang dari `sales.csv` saat itu.
- Sales manager bisa mengetik `/ringkasan` kapan saja untuk meminta laporan terbaru.
- Chat yang tidak ada di `TELEGRAM_CHAT_ID` tidak akan menerima data penjualan. Bot hanya membalas dengan chat ID chat tersebut, supaya admin bisa menambahkannya ke `.env`.

Kalau bot tidak berjalan, laporan terjadwal tetap terkirim, tetapi tombolnya tidak merespons. Supaya bot ikut aktif setiap komputer menyala, jalankan perintah berikut di Windows:

```
schtasks /create /tn "Bot Sales Telegram" /sc onlogon /tr "\"C:\Program Files\nodejs\node.exe\" C:\sales-dashboard\send.js C:\sales-dashboard\sales.csv --listen"
```

**d. Jadwalkan**

Windows (Task Scheduler), contoh setiap Senin jam 08:00. Sesuaikan path-nya:

```
schtasks /create /tn "Ringkasan Sales Telegram" /sc weekly /d MON /st 08:00 /tr "\"C:\Program Files\nodejs\node.exe\" C:\sales-dashboard\send.js C:\sales-dashboard\sales.csv"
```

Untuk harian, ganti dengan `/sc daily`. Untuk menguji jadwalnya sekarang juga: `schtasks /run /tn "Ringkasan Sales Telegram"`.

Linux/macOS (cron), contoh setiap Senin jam 08:00:

```
0 8 * * 1 cd /opt/sales-dashboard && node send.js sales.csv >> send.log 2>&1
```

Ringkasan selalu dihitung dari isi CSV saat jadwal berjalan. Jadi cukup timpa `sales.csv` dengan export terbaru sebelum jadwal tiba.

## Aturan pembersihan data

| Kasus | Perlakuan |
|---|---|
| Baris duplikat persis | dibuang (di contoh: 3) |
| Penulisan region berbeda (`Jabar`, `JAWA BARAT`) | diseragamkan ke ejaan yang paling sering muncul (di contoh: 10) |
| Retur (nilai negatif, invoice `RTR…`) | tetap dihitung, mengurangi net |
| Salesman kosong | tetap dihitung |
| Tanggal atau angka rusak | baris diabaikan, jumlahnya dilaporkan |
| Spasi di nama outlet | dihapus; outlet dikenali dari `outlet_id` |

## Test

```
node --test
```

Test mencocokkan angka dari `sales.csv` dengan perhitungan independen di Python: total Rp 1.725.966.000, 824 invoice, dan total per region. Test juga memeriksa pembersihan data dan pengiriman ke Telegram, dengan HTTP disimulasikan.

## File

| File | Isi |
|---|---|
| `index.html` | dashboard |
| `report.js` | logika perhitungan dan ringkasan (dipakai dashboard dan `send.js`) |
| `send.js` | bot Telegram: kirim laporan dan jawab tombol |
| `report.test.js` | test |
| `.env.example` | contoh konfigurasi bot |
