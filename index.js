// index.js
// ===============================================================
//  Entry point untuk Telegram Bot "File-Explorer + AI Helper"
//  Dibuat sesuai spesifikasi kompleks pada prompt.
//  - Inisialisasi Telegraf
//  - Load konfigurasi dari config.json
//  - Setup session per-chat di memory
//  - Routing command / callback_query ke fitur explorer & aiHelper
//  - Rapi, komentar Bahasa Indonesia
// ===============================================================

const { Telegraf, Markup } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');

// Modul fitur & util
const { ensureStorageReady } = require('./utils/fileManager');
const { handleExplorerCallbacks, handleStartScriptFlow } = require('./features/explorer');
const { handleAIHelperCallbacks } = require('./features/aiHelper');
const { appendLog } = require('./utils/logManager');

// Baca konfigurasi (pengguna wajib mengisi telegram_token dll)
const configPath = path.resolve('./config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json tidak ditemukan!');
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Pastikan storage & db siap
await ensureStorageReady(CONFIG);

// Inisialisasi Bot
if (!CONFIG.telegram_token || CONFIG.telegram_token === 'ISI_TOKEN_BOT_LU') {
  console.error('Masukkan token bot Telegram di config.json terlebih dahulu.');
  process.exit(1);
}
const bot = new Telegraf(CONFIG.telegram_token);

// =================================================================
//  Session Management
// =================================================================
// Struktur session per chat:
// {
//   currentFolder, currentTargetFile, currentAI, lastAiResponse,
//   lastPayload, puppeteerBrowserRef
// }
const sessionMap = new Map();
function getSession(chatId) {
  if (!sessionMap.has(chatId)) {
    sessionMap.set(chatId, {
      currentFolder: null,
      currentTargetFile: null,
      currentAI: CONFIG.ai?.default || 'blackbox',
      lastAiResponse: null,
      lastPayload: null,
      puppeteerBrowserRef: null,
    });
  }
  return sessionMap.get(chatId);
}

// =================================================================
//  Helper – beberapa keyboard reusable
// =================================================================
function homeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Gass buat script', 'FLOW_START_SCRIPT'), Markup.button.callback('➡️ Lanjut Buat Script', 'FLOW_EXPLORER')],
    [Markup.button.callback('🔧 Setelan', 'SETTINGS'), Markup.button.callback('🧹 End Session', 'END_SESSION')],
  ]);
}

// =================================================================
//  /start command
// =================================================================
bot.start(async (ctx) => {
  try {
    const name = ctx.from.first_name;
    const now = new Date().toLocaleString('id-ID');
    const totalFitur = 2; // Explorer + AI Helper (update kalau nambah)

    // Coba kirim banner image bila ada
    const bannerPath = path.resolve('./media/allmenu.jpg');
    const caption = `Halo ${name}! Selamat datang di Bot File-Explorer + AI Helper.
🕒 ${now}
👤 Kamu: ${name}
👑 Owner: ${CONFIG.owner}
📦 Total fitur: ${totalFitur}`;

    if (fs.existsSync(bannerPath)) {
      await ctx.replyWithPhoto({ source: bannerPath }, { caption, ...homeKeyboard() });
    } else {
      await ctx.reply(`${caption}`, homeKeyboard());
    }
  } catch (err) {
    console.error('/start error', err);
  }
});

// =================================================================
//  Callback Query Routing
// =================================================================
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const chatId = ctx.chat.id;
  const session = getSession(chatId);

  try {
    // Global actions dulu
    if (data === 'END_SESSION') {
      // Tutup browser puppeteer kalau ada
      if (session.puppeteerBrowserRef) {
        try {
          await session.puppeteerBrowserRef.close();
        } catch (_) {}
      }
      sessionMap.delete(chatId);
      await ctx.answerCbQuery('Sesi dibersihkan ✅');
      await ctx.editMessageText('Sesi telah di-reset. Jalankan /start untuk memulai lagi.');
      return;
    }
    if (data === 'SETTINGS') {
      await ctx.answerCbQuery('Fitur setelan belum tersedia 😅');
      return;
    }

    // Routing ke fitur sesuai prefix
    if (data.startsWith('FLOW_START_SCRIPT')) {
      await handleStartScriptFlow(ctx, session, CONFIG);
    } else if (data.startsWith('FLOW_EXPLORER')) {
      await handleExplorerCallbacks(ctx, session, CONFIG);
    } else if (data.startsWith('AIHELPER')) {
      await handleAIHelperCallbacks(ctx, session, CONFIG);
    } else {
      await ctx.answerCbQuery('Perintah tidak dikenal 🤔');
    }
  } catch (err) {
    console.error('callback routing error', err);
    await ctx.answerCbQuery('Terjadi kesalahan! Lihat log.');
  }
});

// =================================================================
//  Jalankan bot
// =================================================================
bot.launch();
console.log('Bot berjalan... Tekan Ctrl+C untuk berhenti');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));