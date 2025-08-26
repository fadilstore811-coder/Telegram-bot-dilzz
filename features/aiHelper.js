// features/aiHelper.js
// ===============================================================
//  Modul AI Helper – handle flow mengirim file + prompt ke AI connector
//  dan memasang payload balasan ke file target.
// ===============================================================

const { Markup } = require('telegraf');
const path = require('path');
const fs = require('fs-extra');
const {
  readFilePreview,
  resolveStoragePath,
  createFile,
} = require('../utils/fileManager');
const { parseAIResponse } = require('../utils/aiConnector');

// Dummy connector call (implementation real ada di aiConnector)
const { sendToAI } = require('../utils/aiConnector');

async function handleAIHelperCallbacks(ctx, session, CONFIG) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();
  const parts = data.split('|'); // AIHELPER|...

  if (parts[1] === 'OPEN') {
    const folderRel = parts[2];
    const folderPath = resolveStoragePath(CONFIG, folderRel);
    const files = await fs.readdir(folderPath);
    if (files.length === 0) {
      await ctx.reply('Folder kosong. Tambahkan file dulu.');
      return;
    }
    const defaultTarget = path.join(folderRel, files.sort()[0]);
    session.currentTargetFile = defaultTarget;

    const preview = await readFilePreview(resolveStoragePath(CONFIG, defaultTarget), 1500);
    await ctx.editMessageText(`Preview file pertama \(${defaultTarget}\):\n\n<pre>${escapeHtml(preview)}</pre>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔁 Kirim ke AI untuk generate', 'AIHELPER|SEND')],
        [Markup.button.callback('Tampilkan Lengkap', 'AIHELPER|FULL')],
        [Markup.button.callback('🏠 Back to Home', 'FLOW_EXPLORER')],
      ]),
    });
    return;
  }

  if (parts[1] === 'SEND') {
    // Minta prompt tambahan
    session.awaitingUserPrompt = true;
    await ctx.editMessageText('📝 Kirim prompt tambahan (kosongkan jika tidak perlu):');
    return;
  }

  if (parts[1] === 'FULL') {
    const target = session.currentTargetFile;
    const full = await fs.readFile(resolveStoragePath(CONFIG, target), 'utf-8');
    await ctx.editMessageText(`<pre>${escapeHtml(full)}</pre>`, { parse_mode: 'HTML' });
    return;
  }
}

async function processUserPrompt(ctx, session, CONFIG) {
  const prompt = ctx.message.text || '';
  session.awaitingUserPrompt = false;
  const target = session.currentTargetFile;
  const filePath = resolveStoragePath(CONFIG, target);
  const fileContent = await fs.readFile(filePath, 'utf-8');

  // Bangun pesan ke AI
  const instruction = 'Kamu adalah AI helper coding. Ikuti instruksi dan modifikasi file.';
  const mergedPrompt = `${instruction}\n\nUserPrompt: ${prompt}\n\nFILE CONTENT:\n${fileContent}`;

  await ctx.reply('⏳ Menghubungi AI. Mohon tunggu...');
  const aiResponse = await sendToAI(session.currentAI, mergedPrompt, CONFIG, session);

  const parseRes = parseAIResponse(aiResponse, prompt, CONFIG, session, target);
  session.lastAiResponse = aiResponse;
  session.lastPayload = parseRes.payload;
  session.lastTargetPath = parseRes.targetPath;

  const prev = parseRes.payload.slice(0, 1000);
  await ctx.reply(`<b>Preview payload:</b>\n<pre>${escapeHtml(prev)}</pre>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📥 Pasang Codingan Ini', 'AIHELPER|INSTALL')],
      [Markup.button.callback('❌ Jangan Pasang', 'AIHELPER|CANCEL')],
    ]),
  });
}

async function handleInstall(ctx, session, CONFIG) {
  const payload = session.lastPayload;
  const target = session.lastTargetPath;
  if (!payload || !target) {
    await ctx.reply('Payload kosong.');
    return;
  }
  const targetPath = resolveStoragePath(CONFIG, target);
  await createFile(CONFIG, target, payload);
  await ctx.reply(`✅ Payload berhasil ditulis ke <code>${target}</code>`, { parse_mode: 'HTML' });
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

module.exports = {
  handleAIHelperCallbacks,
  processUserPrompt,
  handleInstall,
};