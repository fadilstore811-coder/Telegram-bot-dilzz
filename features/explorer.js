// features/explorer.js
// ===============================================================
//  Modul Explorer – menangani alur pembuatan folder baru & file explorer
//  Fungsi diekspor:
//    - handleStartScriptFlow(ctx, session, CONFIG)
//    - handleExplorerCallbacks(ctx, session, CONFIG)
//  Catatan: handler ini mengandalkan session flags untuk mengetahui
//  status conversation. Message handler di index.js perlu cek flag.
// ===============================================================

const { Markup } = require('telegraf');
const path = require('path');
const fs = require('fs-extra');
const {
  listFolders,
  listFiles,
  createFolder,
  createFile,
  resolveStoragePath,
  readFilePreview,
} = require('../utils/fileManager');

// ---------------------------------------------------------------
//  Start Script Flow – minta nama folder, buat template
// ---------------------------------------------------------------
async function handleStartScriptFlow(ctx, session, CONFIG) {
  // Step awal: klik tombol, kemudian minta nama folder
  session.awaitingNewFolderName = true;
  await ctx.answerCbQuery();
  await ctx.editMessageText('🚀 Silakan kirim nama folder baru (hanya alphanumeric, -, _):');
}

// Fungsi untuk dipanggil oleh message handler ketika user mengirim nama folder
async function processNewFolderName(ctx, session, CONFIG) {
  const name = ctx.message.text.trim();
  if (!/^[\w-]+$/.test(name)) {
    await ctx.reply('❌ Nama folder tidak valid. Gunakan huruf, angka, -, atau _. Coba lagi.');
    return;
  }
  // Buat folder dan 3 file default
  const folderRel = name;
  const folderPath = await createFolder(CONFIG, folderRel);
  await createFile(CONFIG, path.join(folderRel, 'index.js'), '// template index.js\n');
  await createFile(CONFIG, path.join(folderRel, 'config.json'), '{\n  \n}');
  await createFile(CONFIG, path.join(folderRel, 'README.md'), `# ${name}\n`);

  session.awaitingNewFolderName = false;
  session.currentFolder = folderRel;

  await ctx.reply(`✅ Folder *${name}* berhasil dibuat!`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🏠 Back to Home', 'FLOW_EXPLORER_HOME')],
      [Markup.button.callback('➡️ Lanjut', `FLOW_EXPLORER|OPEN|${folderRel}`)],
    ]),
  });
}

// ---------------------------------------------------------------
//  Explorer Callbacks
// ---------------------------------------------------------------
async function handleExplorerCallbacks(ctx, session, CONFIG) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();

  // data pattern: FLOW_EXPLORER or FLOW_EXPLORER|OPEN|folderName
  if (data === 'FLOW_EXPLORER' || data === 'FLOW_EXPLORER_HOME') {
    // Tampilkan list folder di storage
    await ctx.editMessageText('⏳ Membaca semua file di /tempatallsc...');
    const folders = await listFolders(CONFIG);

    if (folders.length === 0) {
      await ctx.editMessageText('📂 Belum ada folder. Tambah sekarang?', Markup.inlineKeyboard([
        [Markup.button.callback('➕ Tambah Folder', 'FLOW_START_SCRIPT')],
        [Markup.button.callback('🏠 Home', 'FLOW_EXPLORER_HOME')],
      ]));
      return;
    }

    // Buat tombol grid 3 per baris
    const rowSize = 3;
    const foldersButtons = folders.map((f) => Markup.button.callback(`📁 ${f}`, `FLOW_EXPLORER|OPEN|${f}`));
    const chunked = [];
    while (foldersButtons.length) chunked.push(foldersButtons.splice(0, rowSize));
    // Tambah baris bottom
    chunked.push([Markup.button.callback('➕ Tambah Folder', 'FLOW_START_SCRIPT')]);
    chunked.push([Markup.button.callback('🏠 Home', 'FLOW_EXPLORER_HOME')]);

    await ctx.editMessageText('📂 Daftar folder:', Markup.inlineKeyboard(chunked));
    return;
  }

  // OPEN folder
  const parts = data.split('|');
  if (parts[1] === 'OPEN') {
    const folderRel = parts[2];
    session.currentFolder = folderRel;
    // List files dalam folder
    const files = await listFiles(CONFIG, folderRel);
    const fileBtns = files.map((f) => Markup.button.callback(`📄 ${f}`, `FLOW_EXPLORER|FILE|${folderRel}|${f}`));
    const rows = [];
    const rowSize = 2;
    while (fileBtns.length) rows.push(fileBtns.splice(0, rowSize));
    rows.push([
      Markup.button.callback('➕ Tambah Folder', `FLOW_EXPLORER|ADD_FOLDER|${folderRel}`),
      Markup.button.callback('📄 Tambah File', `FLOW_EXPLORER|ADD_FILE|${folderRel}`),
    ]);
    rows.push([
      Markup.button.callback('🤖 Bantuan AI', `AIHELPER|OPEN|${folderRel}`),
      Markup.button.callback('🔁 Ganti AI', 'AIHELPER|SWITCH'),
    ]);
    rows.push([Markup.button.callback('🏠 Back to Home', 'FLOW_EXPLORER')]);

    await ctx.editMessageText(`📁 Folder *${folderRel}*`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
    return;
  }

  // ADD_FOLDER
  if (parts[1] === 'ADD_FOLDER') {
    const currentFolder = parts[2];
    session.awaitingSubfolderName = currentFolder;
    await ctx.editMessageText('📝 Kirim nama subfolder baru:');
    return;
  }

  // ADD_FILE
  if (parts[1] === 'ADD_FILE') {
    const currentFolder = parts[2];
    session.awaitingNewFileName = currentFolder;
    await ctx.editMessageText('📝 Kirim nama file baru (misal: data.json):');
    return;
  }
}

// ---------------------------------------------------------------
//  Processor untuk nama subfolder dan file (dipakai di index.js)
// ---------------------------------------------------------------
async function processNewSubfolderName(ctx, session, CONFIG) {
  const name = ctx.message.text.trim();
  if (!/^[\w-]+$/.test(name)) {
    await ctx.reply('❌ Nama folder tidak valid.');
    return;
  }
  const parent = session.awaitingSubfolderName;
  const rel = path.join(parent, name);
  await createFolder(CONFIG, rel);
  session.awaitingSubfolderName = null;
  await ctx.reply(`✅ Subfolder *${name}* berhasil dibuat.`, { parse_mode: 'Markdown' });
}

async function processNewFileName(ctx, session, CONFIG) {
  const filename = ctx.message.text.trim();
  if (!/^[\w.-]+$/.test(filename)) {
    await ctx.reply('❌ Nama file tidak valid.');
    return;
  }
  const folder = session.awaitingNewFileName;
  const fileRel = path.join(folder, filename);
  const filePath = resolveStoragePath(CONFIG, fileRel);
  if (await fs.pathExists(filePath)) {
    await ctx.reply('⚠️ File sudah ada. Gunakan nama lain.');
    return;
  }
  await createFile(CONFIG, fileRel, '');
  session.awaitingNewFileName = null;
  await ctx.reply(`✅ File *${filename}* dibuat.`, { parse_mode: 'Markdown' });
}

module.exports = {
  handleStartScriptFlow,
  handleExplorerCallbacks,
  processNewFolderName,
  processNewSubfolderName,
  processNewFileName,
};