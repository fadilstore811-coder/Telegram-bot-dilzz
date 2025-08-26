# Telegram Bot — File-Explorer + AI Helper (Telegraf + Puppeteer)

Proyek Node.js ini adalah Telegram Bot yang berfungsi sebagai File-Explorer dan AI Helper (web connectors). Bot menggunakan Telegraf untuk interaksi Telegram dan Puppeteer (dengan stealth plugin) untuk menghubungkan ke layanan AI berbasis web.

PENTING:
- Jangan commit `node_modules` atau `package.json` di hasil ini. Buat `package.json` sendiri setelah cloning.
- Semua login AI menggunakan cookies (kecuali Blackbox tanpa login). Bot tidak akan pernah otomatis mengetik password Google/openAI.

## Fitur Utama
- UI `/start` yang rapi: banner (opsional) + tombol aksi.
- File Explorer: daftar folder, buka folder, tambah folder/file.
- AI Helper: baca file pertama di folder sebagai target default, kirim ke AI (ChatGPT/Gemini/Blackbox), parsing hasil, dan pasang payload ke file.
- Per-chat session in-memory; tombol navigasi [🔁 Ganti AI] [🏠 Home] [🧹 End Session].
- Logging aktivitas ke `./db/logs.json`.

## Struktur Proyek
- `index.js` — entry point bot
- `config.json` — contoh config (isi token & jalur cookies)
- `utils/fileManager.js` — util file/folder (scan, baca/tulis, sanitasi path)
- `utils/aiConnector.js` — konektor AI via puppeteer-extra + stealth
- `utils/logManager.js` — append log ke `./db/logs.json`
- `features/explorer.js` — alur file-explorer (list, tambah)
- `features/aiHelper.js` — alur AI helper (kirim prompt, parsing, pasang payload)
- `media/allmenu.jpg` — opsional banner (jika tidak ada, bot fallback ke teks)
- `tempatallsc/` — storage default (dibuat otomatis bila belum ada)
- `db/logs.json` — file log (dibuat otomatis)

## Instalasi
1. Buat `package.json` sendiri (minimal `main: index.js`) atau jalankan `npm init -y`.
2. Install dependensi berikut (tanpa membuat `package.json` di hasil akhir):

```bash
npm install telegraf puppeteer-extra puppeteer-extra-plugin-stealth fs-extra
```

3. Pastikan `config.json` sudah diisi (lihat bagian Konfigurasi).
4. Jalankan bot:

```bash
node index.js
```

Catatan: Di lingkungan server tanpa GUI, Puppeteer berjalan headless. Jika butuh login/2FA manual, jalankan dengan tampilan (VNC/X11) atau modifikasi konektor untuk `headless: false` sementara.

## Konfigurasi
Contoh `config.json` (sudah disediakan):

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

- `telegram_token`: token bot Telegram kamu.
- `ai.enable`: aktif/nonaktifkan konektor.
- `ai.default`: AI default saat start.
- `accounts.*.cookies_path`: lokasi file cookies (JSON) hasil ekspor Cookie-Editor.

## Ekspor Cookies (ChatGPT & Gemini)
Semua login AI menggunakan cookies. Jika file cookies tidak ditemukan/expired, bot akan menginstruksikan langkah-langkah di chat.

Ringkasnya:
1) Login di browser (Chrome Desktop atau Kiwi di Android) ke situs AI: `chat.openai.com` atau `gemini.google.com`.
2) Pasang ekstensi "Cookie-Editor".
3) Ekspor cookies sebagai JSON (format array).
4) Simpan ke jalur sesuai `config.json`, misalnya:
   - `./cookies/chatgpt.json`
   - `./cookies/gemini.json`

Jika cookies expired, ulangi langkah di atas dan ganti file JSON.

## Cara Pakai (Ringkas)
- Kirim `/start` untuk membuka menu.
- Tombol "⚡ Gass buat script": minta nama folder dan membuat scaffold 3 file default.
- Tombol "➡️ Lanjut Buat Script": membuka File Explorer (daftar folder di `./tempatallsc`).
- Di dalam folder: tambah folder/file, buka AI Helper.
- AI Helper: pilih "🔁 Kirim ke AI untuk generate", beri prompt opsional, review preview, pasang payload ke file.

## Contoh Interaksi
- Contoh 1: User minta "berikan database users.json" dan AI mengembalikan `[]`.
  - Balasan AI:
    ```
    # system/database/users.json
    []
    ```
  - Bot akan parse path `system/database/users.json` dan payload `[]` lalu menawarkan pemasangan.

- Contoh 2: AI mengembalikan kode dalam code block:
  ```
  ```json
  []
  ```
  ```
  - Bot mengambil block pertama di dalam triple backticks sebagai payload.

- Contoh 3: AI mengembalikan path dengan format `system/database/users.json:` di baris pertama:
  ```
  system/database/users.json:
  []
  ```
  - Bot menganggap path dari baris pertama dan `[]` sebagai payload.

## Keamanan & Privasi
- Jangan menyimpan password plaintext di `config.json`.
- Simpan cookies dengan permissions yang ketat; perlakukan sebagai secrets. Untuk produksi, simpan di vault/secret manager.
- Selektor website bisa berubah sewaktu-waktu. Jika scraping gagal, periksa dan update selektor di `utils/aiConnector.js`.

## Catatan Teknis
- Deteksi payload vs path:
  1) Jika ada triple-backtick, ambil block pertama (tanpa fence) sebagai payload.
  2) Jika baris pertama adalah path (\# path, `path:`, atau single line path), sisanya payload.
  3) Jika ada segmen mirip JSON (brace/bracket seimbang), ambil segmen itu.
  4) Jika tidak, ambil keseluruhan balasan sebagai payload.
- Resolusi target path:
  1) Jika case B, gunakan path dari AI (disanitasi, cegah `../`).
  2) Jika prompt menyebut filename dan file itu ada di folder aktif, gunakan file itu.
  3) Default: file pertama (defaultTarget).
  4) Jika target belum ada, akan dibuat (pastikan direktori).

## Troubleshooting
- Cookies hilang/invalid: re-ekspor cookies sesuai langkah di atas.
- 2FA: jalankan puppeteer dengan tampilan (headless: false) sementara untuk menyelesaikan 2FA.
- Error "Selector changed": perbarui selektor di `utils/aiConnector.js`.

## Lisensi
Gunakan secara bertanggung jawab. Perhatikan ToS situs AI terkait.
