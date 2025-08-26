#!/usr/bin/env node
/**
 * index.js
 * Entry point Bot Telegram (Telegraf) sebagai File-Explorer + AI Helper (web connectors).
 * - Semua pesan user berbahasa Indonesia, UX dengan emoji dan loading realistis.
 * - Menggunakan session in-memory per chat.
 * - Memanggil fitur explorer dan aiHelper yang modular.
 * - Membaca konfigurasi dari config.json.
 *
 * Cara jalan:
 * 1) Isi config.json (telegram_token, owner, cookies path jika perlu)
 * 2) npm install telegraf puppeteer-extra puppeteer-extra-plugin-stealth fs-extra
 * 3) node index.js
 *
 * Catatan keamanan: jangan simpan password di config; gunakan cookies untuk login AI.
 */

const path = require('path');
const fs = require('fs-extra');
const { Telegraf, Markup } = require('telegraf');

// Utils & Features
const fileManager = require('./utils/fileManager');
const logManager = require('./utils/logManager');
const { ensureBrowserClosed } = require('./utils/aiConnector');
const explorerFeature = require('./features/explorer');
const aiHelperFeature = require('./features/aiHelper');

// Muat konfigurasi
const CONFIG_PATH = path.resolve(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('config.json tidak ditemukan. Buat dari contoh spesifikasi prompt.');
  process.exit(1);
}
const config = fs.readJsonSync(CONFIG_PATH);

// Pastikan folder dasar ada
const STORAGE_DIR = path.resolve(__dirname, config.paths?.storage || './tempatallsc');
const DB_DIR = path.resolve(__dirname, config.paths?.db || './db');
const MEDIA_DIR = path.resolve(__dirname, config.paths?.media || './media');
fs.ensureDirSync(STORAGE_DIR);
fs.ensureDirSync(DB_DIR);
fs.ensureDirSync(MEDIA_DIR);
fs.ensureFileSync(path.join(DB_DIR, 'logs.json'));
if (fs.readFileSync(path.join(DB_DIR, 'logs.json'), 'utf8').trim() === '') {
  fs.writeFileSync(path.join(DB_DIR, 'logs.json'), '[]', 'utf8');
}

// Inisialisasi bot
const botToken = config.telegram_token;
if (!botToken || botToken === 'ISI_TOKEN_BOT_LU') {
  console.error('Isi telegram_token di config.json dulu.');
}
const bot = new Telegraf(botToken || '');

// Session sederhana in-memory
const sessions = new Map();
function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      currentFolder: null,
      currentTargetFile: null,
      currentAI: config.ai?.default || 'blackbox',
      lastAiResponse: null,
      lastPayload: null,
      puppeteerBrowserRef: null,
    });
  }
  return sessions.get(chatId);
}

// Helper loading animasi via editMessageText
async function loadingDots(ctx, baseText, times = 3, delayMs = 400) {
  try {
    let text = baseText;
    for (let i = 0; i < times; i++) {
      text = baseText + '.'.repeat((i % 3) + 1);
      // gunakan editMessageText jika callback, atau reply jika message biasa
      if (ctx.callbackQuery) {
        await ctx.editMessageText(text);
      } else {
        await ctx.reply(text);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
  } catch (e) {
    // abaikan error edit race
  }
}

// Builder tombol home
function homeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Gass buat script', 'GASS_SCRIPT'), Markup.button.callback('➡️ Lanjut Buat Script', 'LANJUT_SCRIPT')],
    [Markup.button.callback('🔧 Setelan', 'SETTINGS'), Markup.button.callback('🧹 End Session', 'END_SESSION')],
  ]);
}

// /start handler
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const now = new Date();
  const jam = now.toLocaleString('id-ID');
  const owner = config.owner || '-';
  const totalFitur = 2; // Explorer + AI Helper (inti), tombol lain variasi

  const bannerPath = path.join(MEDIA_DIR, 'allmenu.jpg');
  const caption = `Halo ${ctx.from.first_name || 'kawan'}!\n\n` +
    `🕒 ${jam}\n` +
    `👤 User: ${ctx.from.username || ctx.from.first_name}\n` +
    `👑 Owner: ${owner}\n` +
    `📦 Total fitur: ${totalFitur}\n\n` +
    `Pilih aksi di bawah ya ⤵️`;

  try {
    if (fs.existsSync(bannerPath)) {
      await ctx.replyWithPhoto({ source: bannerPath }, { caption, ...homeKeyboard() });
    } else {
      await ctx.reply(caption, homeKeyboard());
    }
  } catch (e) {
    await ctx.reply(caption, homeKeyboard());
  }
});

// Callback actions
bot.action('GASS_SCRIPT', async (ctx) => {
  const chatId = ctx.chat.id;
  getSession(chatId); // ensure
  try { await ctx.deleteMessage(); } catch {}
  await ctx.reply('Masukkan nama folder baru (huruf/angka, -, _ saja):');
  // set flag menunggu nama folder
  sessions.get(chatId).awaitingNewFolderName = true;
});

bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (session.awaitingNewFolderName) {
    const name = (ctx.message.text || '').trim();
    const valid = /^[A-Za-z0-9_-]+$/.test(name);
    if (!valid) {
      return ctx.reply('Nama folder tidak valid. Gunakan alphanumeric, - atau _. Coba lagi.');
    }
    session.awaitingNewFolderName = false;

    // animasi loading
    const m = await ctx.reply('Loading');
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 350));
      try { await ctx.telegram.editMessageText(ctx.chat.id, m.message_id, undefined, 'Loading' + '.'.repeat(i + 1)); } catch {}
    }

    const newDir = path.join(STORAGE_DIR, name);
    try {
      await fs.ensureDir(newDir);
      await fs.writeFile(path.join(newDir, 'index.js'), `console.log('Hello from ${name}');\n`);
      await fs.writeJson(path.join(newDir, 'config.json'), { name, version: '1.0.0' }, { spaces: 2 });
      await fs.writeFile(path.join(newDir, 'README.md'), `# ${name}\n\nProject awal dibuat via bot.\n`);
      await ctx.reply(`Siap! Folder dibuat di ${path.relative(process.cwd(), newDir)} ✨`, Markup.inlineKeyboard([
        [Markup.button.callback('🏠 Back to Home', 'BACK_HOME'), Markup.button.callback('➡️ Lanjut', 'LANJUT_SCRIPT')]
      ]));
    } catch (e) {
      await ctx.reply('Gagal membuat folder: ' + e.message);
    }
    return;
  }
  return next();
});

bot.action('LANJUT_SCRIPT', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  try { await ctx.deleteMessage(); } catch {}
  await loadingDots(ctx, '⏳ Membaca semua file di /tempatallsc', 3, 300);
  const folders = await fileManager.listDirectories(STORAGE_DIR);
  if (!folders.length) {
    return ctx.reply('Belum ada folder nih. Mau buat baru?', Markup.inlineKeyboard([
      [Markup.button.callback('➕ Tambah Folder', 'GASS_SCRIPT')],
      [Markup.button.callback('🧭 Root', 'OPEN_ROOT'), Markup.button.callback('🏠 Home', 'BACK_HOME')]
    ]));
  }
  // grid 2-3 per row
  const rows = [];
  for (let i = 0; i < folders.length; i += 3) {
    rows.push(folders.slice(i, i + 3).map(f => Markup.button.callback(`📁 ${f}`, `OPEN_FOLDER:${f}`)));
  }
  rows.push([Markup.button.callback('🧭 Root', 'OPEN_ROOT'), Markup.button.callback('🏠 Home', 'BACK_HOME')]);
  await ctx.reply('Pilih folder yang mau dibuka:', Markup.inlineKeyboard(rows));
});

bot.action(/^OPEN_FOLDER:(.+)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const folderName = ctx.match[1];
  session.currentFolder = folderName;
  const abs = path.join(STORAGE_DIR, folderName);
  const files = await fileManager.listFiles(abs);
  const fileButtons = files.map(fn => [Markup.button.callback(`📄 ${fn}`, `OPEN_FILE:${fn}`)]);
  const rows = [
    ...fileButtons,
    [Markup.button.callback('➕ Tambah Folder', 'ADD_SUBFOLDER'), Markup.button.callback('📄 Tambah File', 'ADD_FILE')],
    [Markup.button.callback('🤖 Bantuan AI', 'AI_HELP'), Markup.button.callback('🔁 Ganti AI', 'CHANGE_AI')],
    [Markup.button.callback('🏠 Back to Home', 'BACK_HOME')]
  ];
  await ctx.editMessageText(`Folder aktif: ${folderName}. Pilih file:`, Markup.inlineKeyboard(rows));
});

bot.action('ADD_SUBFOLDER', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session.currentFolder) return ctx.answerCbQuery('Buka folder dulu ya.');
  session.awaitingSubfolderName = true;
  await ctx.reply('Ketik nama subfolder (alphanumeric, -, _):');
});

bot.action('ADD_FILE', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session.currentFolder) return ctx.answerCbQuery('Buka folder dulu ya.');
  session.awaitingNewFileName = true;
  await ctx.reply('Ketik nama file beserta ekstensi, contoh: data.json atau index.js');
});

// handler nama subfolder / nama file
bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const folderAbs = session.currentFolder ? path.join(STORAGE_DIR, session.currentFolder) : null;

  if (session.awaitingSubfolderName && folderAbs) {
    const name = (ctx.message.text || '').trim();
    session.awaitingSubfolderName = false;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return ctx.reply('Nama subfolder tidak valid.');
    }
    try {
      await fs.ensureDir(path.join(folderAbs, name));
      await ctx.reply('Subfolder dibuat 🎉');
    } catch (e) {
      await ctx.reply('Gagal membuat subfolder: ' + e.message);
    }
    return;
  }

  if (session.awaitingNewFileName && folderAbs) {
    const filename = (ctx.message.text || '').trim();
    session.awaitingNewFileName = false;
    if (!/^[A-Za-z0-9_.-]+$/.test(filename)) {
      return ctx.reply('Nama file tidak valid.');
    }
    const target = path.join(folderAbs, filename);
    if (await fs.pathExists(target)) {
      session.pendingOverwriteFile = target;
      return ctx.reply(`File sudah ada: ${filename}. Mau ditimpa?`, Markup.inlineKeyboard([
        [Markup.button.callback('🔁 Timpa', 'OVERWRITE_YES'), Markup.button.callback('✖️ Batal', 'OVERWRITE_NO')]
      ]));
    }
    await fs.ensureFile(target);
    await ctx.replyWithMarkdownV2('File dibuat\. Preview:\n```
' + (await fileManager.readPreview(target, 1000)) + '\n```');
    return;
  }

  return next();
});

bot.action('OVERWRITE_YES', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const target = session.pendingOverwriteFile;
  if (!target) return ctx.answerCbQuery('Tidak ada file untuk ditimpa.');
  await fs.writeFile(target, '');
  session.pendingOverwriteFile = null;
  await ctx.reply('File ditimpa.');
});

bot.action('OVERWRITE_NO', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  session.pendingOverwriteFile = null;
  await ctx.reply('Batal menimpa file.');
});

// Open file button
bot.action(/^OPEN_FILE:(.+)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const filename = ctx.match[1];
  const folderAbs = path.join(STORAGE_DIR, session.currentFolder || '');
  const fileAbs = path.join(folderAbs, filename);
  session.currentTargetFile = fileAbs;
  const preview = await fileManager.readPreview(fileAbs, 1000);
  await ctx.editMessageText(`Preview ${filename}:\n` + preview);
});

// AI HELP entry point
bot.action('AI_HELP', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session.currentFolder) return ctx.answerCbQuery('Buka folder dulu ya.');
  const folderAbs = path.join(STORAGE_DIR, session.currentFolder);
  const files = await fileManager.listFiles(folderAbs);
  if (!files.length) {
    return ctx.reply('Folder kosong. Tambah file dulu ya.');
  }
  const defaultTarget = path.join(folderAbs, files[0]);
  session.currentTargetFile = defaultTarget;
  const preview = await fileManager.readPreview(defaultTarget, 1500);
  await ctx.reply('Target default (file pertama):\n' + preview, Markup.inlineKeyboard([
    [Markup.button.callback('🔁 Kirim ke AI untuk generate', 'AI_SEND')],
    [Markup.button.callback('Tampilkan Lengkap', 'SHOW_FULL')],
    [Markup.button.callback('🏠 Back to Home', 'BACK_HOME')]
  ]));
});

bot.action('SHOW_FULL', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session.currentTargetFile) return ctx.answerCbQuery('Tidak ada file aktif.');
  const full = await fs.readFile(session.currentTargetFile, 'utf8').catch(() => '');
  await ctx.replyWithMarkdownV2('Konten lengkap:\n```
' + (full.slice(0, 3900).replace(/[`*_]/g, '\\$&')) + '\n```');
});

bot.action('AI_SEND', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (!session.currentTargetFile) return ctx.answerCbQuery('Tidak ada target file.');
  session.awaitingAiPrompt = true;
  await ctx.reply('Tambahkan prompt (opsional). Ketik pesanmu sekarang:');
});

// Collect AI prompt and delegate to feature
bot.on('text', async (ctx, next) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  if (session.awaitingAiPrompt) {
    session.awaitingAiPrompt = false;
    const userPrompt = ctx.message.text || '';
    await aiHelperFeature.handleAiGenerate(ctx, {
      config,
      session,
      storageDir: STORAGE_DIR,
      userPrompt
    });
    return;
  }
  return next();
});

// Change AI
bot.action('CHANGE_AI', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const enables = config.ai?.enable || {};
  const rows = [];
  if (enables.chatgpt) rows.push([Markup.button.callback('ChatGPT', 'SET_AI:chatgpt')]);
  if (enables.gemini) rows.push([Markup.button.callback('Gemini', 'SET_AI:gemini')]);
  if (enables.blackbox) rows.push([Markup.button.callback('Blackbox', 'SET_AI:blackbox')]);
  await ctx.reply('Pilih AI:', Markup.inlineKeyboard(rows));
});

bot.action(/^SET_AI:(.+)$/i, async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  session.currentAI = ctx.match[1];
  await ctx.answerCbQuery(`AI di-set ke ${session.currentAI}`);
});

// Navigation
bot.action('BACK_HOME', async (ctx) => {
  try { await ctx.deleteMessage(); } catch {}
  await ctx.reply('Kembali ke beranda ⛱️', homeKeyboard());
});

// End Session
bot.action('END_SESSION', async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  try {
    await ensureBrowserClosed(session);
  } catch {}
  sessions.delete(chatId);
  await ctx.reply('Session dibersihkan 🧹. Sampai jumpa lagi!');
});

// Global error
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('Waduh, ada error tak terduga. Coba lagi ya.');
});

// Register feature-specific actions
aiHelperFeature.registerBotActions(bot);

// Launch bot
if (botToken && botToken !== 'ISI_TOKEN_BOT_LU') {
  bot.launch().then(() => console.log('Bot running...')).catch(console.error);
} else {
  console.warn('Bot tidak diluncurkan karena token kosong. Isi config.json.');
}

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));