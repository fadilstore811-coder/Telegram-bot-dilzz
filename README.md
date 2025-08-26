# Telegram Bot: File-Explorer + AI Helper (Telegraf + Puppeteer)

Project Node.js lengkap tanpa `node_modules` dan tanpa `package.json`. Bot ini:
- Menjadi File-Explorer sederhana untuk direktori `./tempatallsc`
- Terhubung ke AI via Puppeteer (ChatGPT, Gemini, Blackbox) sebagai "AI Helper"
- Login AI berbasis cookies (kecuali Blackbox yang tanpa login)

## Fitur Utama
- /start UI dengan banner opsional `./media/allmenu.jpg`
- Pembuatan folder dan file, listing folder/file, preview
- Alur "Bantuan AI" untuk generate payload dan menulis ke file
- Parsing balasan AI yang robust (code fence, path spec, JSON-like, fallback)
- Log aktivitas ke `./db/logs.json`

## Struktur
- `index.js` — entry, inisialisasi bot, routing, session, UI/UX
- `config.json` — contoh config (isi token & cookies path sendiri)
- `utils/fileManager.js` — helper file ops dan sanitasi path
- `utils/aiConnector.js` — konektor Puppeteer ke ChatGPT/Gemini/Blackbox (cookies-based)
- `utils/logManager.js` — append log ke `./db/logs.json`
- `features/explorer.js` — placeholder explorer helpers
- `features/aiHelper.js` — alur AI Helper: kirim prompt, parsing, and install
- `media/allmenu.jpg` — opsional (kalau tidak ada, fallback ke teks)
- `tempatallsc/` — storage default (dibuat otomatis)
- `db/logs.json` — dibuat otomatis dengan `[]`

## Instalasi
Jangan buat `package.json` di sini. Cukup install dependensi berikut:

```bash
npm install telegraf puppeteer-extra puppeteer-extra-plugin-stealth fs-extra
```

Kemudian jalankan:

```bash
node index.js
```

## Konfigurasi `config.json`
Gunakan contoh berikut (sudah disertakan sebagai file):

```json
{
  "owner": "Fadil Developer",
  "telegram_token": "ISI_TOKEN_BOT_LU",
  "ai": {
    "enable": { "chatgpt": true, "gemini": true, "blackbox": true },
    "default": "blackbox"
  },
  "accounts": {
    "chatgpt": { "cookies_path": "./cookies/chatgpt.json" },
    "gemini": { "cookies_path": "./cookies/gemini.json" }
  },
  "paths": {
    "root": "./",
    "storage": "./tempatallsc",
    "db": "./db",
    "media": "./media"
  }
}
```

- Isi `telegram_token` dengan token bot dari BotFather
- `ai.default` bisa `blackbox`, `chatgpt`, atau `gemini`
- Pastikan path cookies mengarah ke file JSON cookies (lihat instruksi di bawah)

## Ekspor Cookies (ChatGPT & Gemini)
Login AI dilakukan via cookies file. Ikuti langkah singkat berikut:
- Desktop Chrome/Edge/Brave: instal ekstensi "Cookie-Editor". Login ke situs (chat.openai.com atau gemini.google.com), buka ekstensi, klik Export → JSON. Simpan file sebagai `chatgpt.json` atau `gemini.json` sesuai akun. Pindahkan ke path sesuai `config.json` (misal `./cookies/chatgpt.json`).
- Android (Kiwi Browser): instal Cookie-Editor, login, export JSON seperti di atas.
- Catatan: JANGAN mengetikkan password secara otomatis via bot. Jika cookies expired/invalid, cukup re-export dan replace file.

## Menjalankan Bot
1. Install deps: `npm install telegraf puppeteer-extra puppeteer-extra-plugin-stealth fs-extra`
2. Isi `config.json` (token, cookies_path)
3. Jalankan: `node index.js`

Jika perlu menangani 2FA atau captcha, jalankan Puppeteer dengan UI (headless: false). Default kode memakai headless true; Anda bisa menyesuaikan di `utils/aiConnector.js` (set headless ke false saat ensureBrowser).

## Contoh Interaksi
1) User: "berikan database users.json"
   - AI membalas dengan code fence berisi `[]`
   - Bot mengekstrak blok pertama dan menawarkan pasang → hasil ditulis ke target file

2) AI mengembalikan code block
```
```json
[
  { "id": 1, "username": "alice" }
]
```
```
   - Bot mengambil blok PERTAMA (tanpa fence) sebagai payload

3) AI mengembalikan path spec
```
# system/database/users.json
[
  { "id": 1, "username": "alice" }
]
```
   - Bot mengenali baris pertama sebagai path target, sisanya payload; menulis ke `system/database/users.json` (disanitasi agar tetap di dalam project root)

## Catatan Keamanan & Dev
- Jangan simpan password plaintext di `config.json`. Untuk produksi, gunakan env vars atau vault.
- Cookies adalah kredensial sesi; batasi permission file cookies (chmod 600) dan simpan aman.
- Selector situs AI bisa berubah sewaktu-waktu. Jika koneksi AI gagal dengan pesan "Selector changed — update utils/aiConnector.js selectors", perbarui selector di file tersebut.
- Log dicatat ke `./db/logs.json` dalam bentuk array JSON. Hati-hati pada data sensitif.

## Troubleshooting
- Bot tidak jalan? Pastikan `telegram_token` diisi dan internet aktif.
- AI cookies missing/expired? Re-export cookies dan pastikan file di path yang tepat.
- Puppeteer error sandbox di Linux: jalankan dengan argumen `--no-sandbox` (sudah disetel di kode) atau gunakan container yang sesuai.
