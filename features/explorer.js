"use strict";
/**
 * features/explorer.js
 *
 * Fitur File-Explorer untuk Telegram Bot:
 * - Menampilkan daftar folder di storage
 * - Buka folder dan list file
 * - Tambah folder & tambah file
 * - Tombol navigasi: Root, Home
 *
 * Semua pesan menggunakan Bahasa Indonesia dengan sentuhan emoji.
 */

const path = require("path");
const fs = require("fs-extra");
const {
  listTopLevelFolders,
  listFilesInFolder,
  createFolder,
  createOrWriteFile,
  isValidFolderName,
  isValidFileName,
  joinStoragePath,
  readPreview,
} = require("../utils/fileManager");

function buildGridButtons(items, prefixCbData, perRow = 3, icon = "📁") {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    const slice = items.slice(i, i + perRow);
    rows.push(
      slice.map((name) => ({ text: `${icon} ${name}`, callback_data: `${prefixCbData}:${name}` }))
    );
  }
  return rows;
}

async function showFolders(ctx, config) {
  const loading = await ctx.reply("⏳ Membaca semua file di /tempatallsc...");
  const folders = await listTopLevelFolders(config);
  const buttons = [];
  if (folders.length) {
    buttons.push(...buildGridButtons(folders, "openFolder", 3, "📁"));
  } else {
    buttons.push([{ text: "➕ Tambah Folder", callback_data: "addFolderRoot" }]);
  }
  buttons.push([
    { text: "🧭 Root", callback_data: "goRoot" },
    { text: "🏠 Home", callback_data: "goHome" },
  ]);

  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loading.message_id,
      undefined,
      "📂 File Explorer — Daftar Folder",
      { reply_markup: { inline_keyboard: buttons } }
    );
  } catch (_) {
    await ctx.reply("📂 File Explorer — Daftar Folder", { reply_markup: { inline_keyboard: buttons } });
  }
}

async function promptNewFolderAtRoot(ctx, config, session) {
  session.awaiting = { type: "addFolderAtRoot" };
  await ctx.reply("🆕 Kirim nama folder baru (alfanumerik, -, _):");
}

async function handleTextWhileAwaiting(ctx, config, session) {
  const text = (ctx.message?.text || "").trim();
  if (!session.awaiting) return false;
  const { type, parentFolder } = session.awaiting;

  if (type === "addFolderAtRoot") {
    if (!isValidFolderName(text)) {
      await ctx.reply("⚠️ Nama folder tidak valid. Hanya huruf/angka, dash, underscore.");
      return true;
    }
    // Loading anim
    const msg = await ctx.reply("Loading.");
    for (const dots of [".", "..", "..."]) {
      await new Promise((r) => setTimeout(r, 250));
      try { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Loading${dots}`); } catch (_) {}
    }
    const storage = config.paths?.storage || "./tempatallsc";
    const folderAbs = await createFolder(config, path.resolve(storage), text);
    // Buat 3 file default
    const base = path.basename(folderAbs);
    await createOrWriteFile(config, path.join(folderAbs, "index.js"), "// index.js — template awal\nconsole.log('Hello from template');\n", true);
    await createOrWriteFile(config, path.join(folderAbs, "config.json"), "{}\n", true);
    await createOrWriteFile(config, path.join(folderAbs, "README.md"), `# ${base}\n\nProject baru dibuat otomatis.\n`, true);

    session.awaiting = null;
    await ctx.reply(
      `✅ Folder baru dibuat: ${base}\nSiap lanjut?`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "🏠 Back to Home", callback_data: "goHome" },
            { text: "➡️ Lanjut", callback_data: `openFolder:${base}` }
          ]]
        }
      }
    );
    return true;
  }

  if (type === "addFolderInside" && parentFolder) {
    if (!isValidFolderName(text)) {
      await ctx.reply("⚠️ Nama folder tidak valid. Hanya huruf/angka, dash, underscore.");
      return true;
    }
    const msg = await ctx.reply("Loading.");
    for (const dots of [".", "..", "..."]) {
      await new Promise((r) => setTimeout(r, 250));
      try { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Loading${dots}`); } catch (_) {}
    }
    const storage = config.paths?.storage || "./tempatallsc";
    const parentAbs = path.resolve(storage, parentFolder);
    await createFolder(config, parentAbs, text);
    session.awaiting = null;
    await openFolder(ctx, config, parentFolder);
    return true;
  }

  if (type === "addFileInside" && parentFolder) {
    if (!isValidFileName(text)) {
      await ctx.reply("⚠️ Nama file tidak valid.");
      return true;
    }
    const storage = config.paths?.storage || "./tempatallsc";
    const targetAbs = path.resolve(storage, parentFolder, text);
    const exists = await fs.pathExists(targetAbs);
    if (exists) {
      session.awaiting = { type: "confirmOverwrite", parentFolder, fileName: text };
      await ctx.reply(
        `📄 File ${text} sudah ada. Mau ditimpa?`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔁 Timpa", callback_data: "confirmOverwriteYes" },
          { text: "✖️ Batal", callback_data: "confirmOverwriteNo" }
        ]]} }
      );
      return true;
    }
    await createOrWriteFile(config, targetAbs, "", true);
    const preview = await readPreview(config, targetAbs, 1000);
    session.awaiting = null;
    await ctx.reply(`✅ File dibuat: ${text}\n\nPreview:\n\n${preview}`);
    await openFolder(ctx, config, parentFolder);
    return true;
  }

  return false;
}

async function openFolder(ctx, config, folderName) {
  const msg = await ctx.reply(`📂 Membuka folder ${folderName}...`);
  const files = await listFilesInFolder(config, folderName);
  const rows = [];
  if (files.length) rows.push(...buildGridButtons(files, `openFile:${folderName}`, 2, "📄"));
  rows.push([
    { text: "➕ Tambah Folder", callback_data: `addFolderInside:${folderName}` },
    { text: "📄 Tambah File", callback_data: `addFileInside:${folderName}` },
  ]);
  rows.push([
    { text: "🤖 Bantuan AI", callback_data: `aiHelp:${folderName}` },
    { text: "🔁 Ganti AI", callback_data: `switchAI:${folderName}` },
  ]);
  rows.push([{ text: "🏠 Back to Home", callback_data: "goHome" }]);
  try {
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `📁 Folder: ${folderName}`, {
      reply_markup: { inline_keyboard: rows },
    });
  } catch (_) {
    await ctx.reply(`📁 Folder: ${folderName}`, { reply_markup: { inline_keyboard: rows } });
  }
}

async function handleCallback(ctx, config, session) {
  const data = ctx.callbackQuery?.data || "";
  if (data === "goRoot") {
    session.currentFolder = null;
    return await showFolders(ctx, config);
  }
  if (data === "goHome") {
    session.currentFolder = null;
    return await ctx.scene?.enter?.("home") || ctx.reply("🏠 Kembali ke Home. Kirim /start");
  }
  if (data === "addFolderRoot") {
    return await promptNewFolderAtRoot(ctx, config, session);
  }

  if (data.startsWith("openFolder:")) {
    const folderName = data.split(":")[1];
    session.currentFolder = folderName;
    return await openFolder(ctx, config, folderName);
  }
  if (data.startsWith("addFolderInside:")) {
    const folderName = data.split(":")[1];
    session.awaiting = { type: "addFolderInside", parentFolder: folderName };
    return await ctx.reply("🆕 Kirim nama subfolder baru:");
  }
  if (data.startsWith("addFileInside:")) {
    const folderName = data.split(":")[1];
    session.awaiting = { type: "addFileInside", parentFolder: folderName };
    return await ctx.reply("🆕 Kirim nama file (contoh: app.js, data.json):");
  }

  if (data === "confirmOverwriteYes") {
    const { parentFolder, fileName } = session.awaiting || {};
    if (!parentFolder || !fileName) return;
    const storage = config.paths?.storage || "./tempatallsc";
    const targetAbs = path.resolve(storage, parentFolder, fileName);
    await createOrWriteFile(config, targetAbs, "", true);
    const preview = await readPreview(config, targetAbs, 1000);
    session.awaiting = null;
    await ctx.reply(`✅ Ditimpa: ${fileName}\n\nPreview:\n\n${preview}`);
    return await openFolder(ctx, config, parentFolder);
  }
  if (data === "confirmOverwriteNo") {
    session.awaiting = null;
    await ctx.reply("❌ Batal timpa file.");
    if (session.currentFolder) await openFolder(ctx, config, session.currentFolder);
    return;
  }
}

module.exports = {
  showFolders,
  handleTextWhileAwaiting,
  handleCallback,
  openFolder,
};