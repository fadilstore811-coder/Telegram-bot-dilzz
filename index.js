"use strict";
/**
 * index.js — Entry Point
 *
 * Menjalankan Telegram Bot berbasis Telegraf dengan fitur:
 * - UI /start yang rapi, menampilkan banner jika ada
 * - File Explorer (browse folder/file, tambah folder/file)
 * - AI Helper dengan konektor Puppeteer (ChatGPT/Gemini via cookies; Blackbox tanpa login)
 * - Session per-chat in-memory
 * - Logging ke ./db/logs.json
 *
 * Cara menjalankan:
 * 1) Isi token di config.json (telegram_token)
 * 2) npm install telegraf puppeteer-extra puppeteer-extra-plugin-stealth fs-extra
 * 3) node index.js
 */

const fs = require("fs-extra");
const path = require("path");
const { Telegraf } = require("telegraf");

const config = require("./config.json");
const { ensureBaseStructure } = require("./utils/fileManager");
const explorer = require("./features/explorer");
const aiHelper = require("./features/aiHelper");
const { closeBrowser } = require("./utils/aiConnector");

// Session per chat disimpan di memori sederhana
const SESSIONS = new Map();
function getSession(chatId) {
  if (!SESSIONS.has(chatId)) {
    SESSIONS.set(chatId, {
      currentFolder: null,
      currentTargetFile: null,
      currentAI: (config.ai && config.ai.default) || "blackbox",
      lastAiResponse: null,
      lastPayload: null,
      puppeteerBrowserRef: null,
      awaiting: null,
    });
  }
  return SESSIONS.get(chatId);
}

(async () => {
  await ensureBaseStructure(config);

  if (!config.telegram_token || config.telegram_token === "ISI_TOKEN_BOT_LU") {
    console.warn("[WARN] Isi token bot dulu di config.json (telegram_token)");
  }

  const bot = new Telegraf(config.telegram_token);

  // Helper: tampilkan home UI (/start)
  async function showHome(ctx) {
    const chat = ctx.chat || {};
    const user = ctx.from || {};
    const name = user.first_name ? `${user.first_name}${user.last_name ? " " + user.last_name : ""}` : (user.username || "Pengguna");
    const now = new Date();
    const jam = now.toLocaleTimeString("id-ID", { hour12: false });
    const owner = config.owner || "-";

    const bannerPath = path.resolve(config.paths?.media || "./media", "allmenu.jpg");
    const caption = `Selamat datang, ${name}!\n🕒 ${jam}\n👑 Owner: ${owner}\n📦 Total fitur: 2 (Explorer + AI Helper)`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "⚡ Gass buat script", callback_data: "quickScaffold" },
          { text: "➡️ Lanjut Buat Script", callback_data: "goExplorer" },
        ],
        [
          { text: "🔧 Setelan", callback_data: "settings" },
          { text: "🧹 End Session", callback_data: "endSession" },
        ],
      ],
    };

    try {
      if (await fs.pathExists(bannerPath)) {
        await ctx.replyWithPhoto({ source: bannerPath }, { caption, reply_markup: keyboard });
      } else {
        await ctx.reply(`✨ Halo!\n${caption}`, { reply_markup: keyboard });
      }
    } catch (err) {
      await ctx.reply(`✨ Halo!\n${caption}`, { reply_markup: keyboard });
    }
  }

  bot.start(async (ctx) => {
    const session = getSession(ctx.chat.id);
    try {
      await showHome(ctx);
    } catch (err) {
      console.error("Error on /start:", err);
      await ctx.reply("⚠️ Gagal menampilkan menu. Coba lagi ya.");
    }
  });

  // Handler teks umum untuk state yang menunggu input
  bot.on("text", async (ctx) => {
    const session = getSession(ctx.chat.id);
    // Prioritas ke Explorer input
    const handledExplorer = await explorer.handleTextWhileAwaiting(ctx, config, session);
    if (handledExplorer) return;
    // Lalu AI helper input
    const handledAI = await aiHelper.handleTextAwaiting(ctx, config, session);
    if (handledAI) return;
  });

  // Callback query
  bot.on("callback_query", async (ctx) => {
    const session = getSession(ctx.chat.id);
    const data = ctx.callbackQuery?.data || "";

    // Coba hapus pesan sebelumnya jika cocok konteks (safe try)
    try { await ctx.deleteMessage(); } catch (_) {}

    if (data === "quickScaffold") {
      // Flow Gass buat script: minta nama folder baru
      session.awaiting = { type: "addFolderAtRoot" };
      return await ctx.reply("🆕 Kirim nama folder baru (alfanumerik, -, _):");
    }
    if (data === "goExplorer") {
      return await explorer.showFolders(ctx, config);
    }
    if (data === "settings") {
      const ai = session.currentAI || (config.ai && config.ai.default) || "blackbox";
      return await ctx.reply(
        `⚙️ Setelan\nAI dipilih: ${ai}`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔁 Ganti AI", callback_data: "switchAI" },
          { text: "🏠 Home", callback_data: "goHome" }
        ]]} }
      );
    }
    if (data === "switchAI") {
      const enabled = config.ai?.enable || {};
      const options = Object.keys(enabled).filter((k) => enabled[k]);
      const rows = options.map((name) => [{ text: `🤖 ${name}`, callback_data: `setAI:${name}` }]);
      rows.push([{ text: "🏠 Home", callback_data: "goHome" }]);
      return await ctx.reply("Pilih AI:", { reply_markup: { inline_keyboard: rows } });
    }
    if (data.startsWith("setAI:")) {
      const ai = data.split(":")[1];
      session.currentAI = ai;
      return await ctx.reply(`✅ AI disetel ke: ${ai}`);
    }
    if (data === "endSession") {
      await closeBrowser(session);
      SESSIONS.delete(ctx.chat.id);
      return await ctx.reply("🧹 Session dibersihkan. Sampai jumpa! ✨");
    }

    // Explorer callbacks
    const handledExplorerCb = await explorer.handleCallback(ctx, config, session);
    if (handledExplorerCb !== undefined) return; // handler sudah balas

    // AI Helper callbacks
    const handledAiCb = await aiHelper.handleCallback(ctx, config, session);
    if (handledAiCb !== undefined) return;
  });

  // Perintah home
  bot.command("home", async (ctx) => showHome(ctx));

  // Jalankan bot
  bot.launch().then(() => {
    console.log("✅ Bot berjalan. Tekan Ctrl+C untuk berhenti.");
  });

  // Graceful stop
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
})();