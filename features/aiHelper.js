"use strict";
/**
 * features/aiHelper.js
 *
 * Modul Bantuan AI untuk folder aktif:
 * - Membaca file pertama sebagai defaultTarget
 * - Preview isi file
 * - Kirim prompt gabungan (template + user prompt + konten file) ke konektor AI
 * - Parsing balasan dengan aturan A/B/C/D
 * - Menentukan target path yang aman
 * - Konfirmasi pemasangan payload dan tulis file
 */

const path = require("path");
const fs = require("fs-extra");
const { listFilesInFolder, readPreview, createOrWriteFile, resolveSafePath, readTextFile } = require("../utils/fileManager");
const { sendPrompt } = require("../utils/aiConnector");
const { appendLog } = require("../utils/logManager");

const INSTRUCTION_TEMPLATE = `Kamu adalah AI code generator. Tulis output yang siap pakai.
- Jika memberikan kode, gunakan code block (```...```).
- Jika perlu path file, tulis di baris pertama dengan format "# <path>" atau "<path>:".
- Jangan beri penjelasan verbose. Fokus pada isi file target.
`;

function detectFilenameInPrompt(prompt) {
  const m = prompt && prompt.match(/\b([\w-]+\.(json|js|env|txt))\b/i);
  return m ? m[1] : null;
}

function extractJsonLike(text) {
  // Mencari segmen JSON pertama (bracket/brace seimbang)
  const start = text.search(/[\[{]/);
  if (start === -1) return null;
  let stack = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}" || ch === "]") stack.pop();
    if (stack.length === 0) {
      return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseAIResponse(raw) {
  let response = (raw || "").trim();
  let payload = "";
  let targetPath = null;

  // A) Code fence
  const fenceMatch = response.match(/```[\s\S]*?\n([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    payload = fenceMatch[1].trim();
    return { payload, targetPath };
  }

  // B) Path spec di first line
  const lines = response.split(/\r?\n/);
  const firstNonEmptyIdx = lines.findIndex((l) => l.trim().length > 0);
  const first = firstNonEmptyIdx >= 0 ? lines[firstNonEmptyIdx].trim() : "";
  let pathSpecMatch = null;
  if ((pathSpecMatch = first.match(/^#\s*([^\s]+)$/))) {
    targetPath = pathSpecMatch[1].trim();
    payload = lines.slice(firstNonEmptyIdx + 1).join("\n").trim();
    return { payload, targetPath };
  }
  if ((pathSpecMatch = first.match(/^([^\s]+):$/))) {
    targetPath = pathSpecMatch[1].trim();
    payload = lines.slice(firstNonEmptyIdx + 1).join("\n").trim();
    return { payload, targetPath };
  }
  if (first && !first.includes(" ") && !first.includes("\t") && first.includes("/")) {
    // single line path
    targetPath = first;
    payload = lines.slice(firstNonEmptyIdx + 1).join("\n").trim();
    if (payload) return { payload, targetPath };
  }

  // C) JSON-like
  const jsonSeg = extractJsonLike(response);
  if (jsonSeg) {
    payload = jsonSeg.trim();
    return { payload, targetPath };
  }

  // D) fallback
  payload = response;
  return { payload, targetPath };
}

function isCodeLike(payload) {
  if (!payload) return false;
  if (/^\s*[\[{]/.test(payload)) return true; // JSON
  const patterns = ["require(", "module.exports", '"name":', "function ", "const ", "class "];
  return patterns.some((p) => payload.includes(p));
}

async function showAiPreview(ctx, config, session, folderName) {
  const files = await listFilesInFolder(config, folderName);
  if (!files.length) {
    await ctx.reply("📭 Folder kosong. Tambahkan file dulu ya.");
    return;
  }
  files.sort((a, b) => a.localeCompare(b));
  const defaultTarget = files[0];
  session.currentFolder = folderName;
  session.currentTargetFile = defaultTarget;

  const storage = config.paths?.storage || "./tempatallsc";
  const targetAbs = path.resolve(storage, folderName, defaultTarget);
  const preview = await readPreview(config, targetAbs, 1500);

  await ctx.reply(
    `🤖 Bantuan AI — Target default: ${defaultTarget}\n\nPreview:\n\n${preview}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "🔁 Kirim ke AI untuk generate", callback_data: `aiSend:${folderName}` },
          { text: "Tampilkan Lengkap", callback_data: `showFull:${folderName}` }
        ], [
          { text: "🏠 Back to Home", callback_data: "goHome" }
        ]]
      }
    }
  );
}

async function handleCallback(ctx, config, session) {
  const data = ctx.callbackQuery?.data || "";
  if (data.startsWith("aiHelp:")) {
    const folder = data.split(":")[1];
    return await showAiPreview(ctx, config, session, folder);
  }
  if (data.startsWith("showFull:")) {
    const folder = data.split(":")[1];
    const storage = config.paths?.storage || "./tempatallsc";
    const targetAbs = path.resolve(storage, folder, session.currentTargetFile || "");
    const full = await readTextFile(config, targetAbs);
    const chunk = full.slice(0, 4000);
    await ctx.reply(`📜 Isi Lengkap (dipotong bila terlalu panjang):\n\n${chunk}`);
    return;
  }
  if (data.startsWith("aiSend:")) {
    const folder = data.split(":")[1];
    session.awaiting = { type: "awaitAiPrompt", folder };
    await ctx.reply("✍️ Tambahkan prompt opsional (atau kirim '-' untuk skip):");
    return;
  }
  if (data === "aiWriteYes") {
    const { chosenAI, finalTargetAbs, payloadForWrite, userId, username, promptUsed } = session._aiWriteContext || {};
    if (!finalTargetAbs) return;
    await createOrWriteFile(config, finalTargetAbs, payloadForWrite, true);
    const preview = (payloadForWrite || "").slice(0, 1000);
    await ctx.reply(`✅ Payload dipasang ke: ${finalTargetAbs}\n\nPreview:\n\n${preview}`);
    await appendLog(config, {
      userId,
      username,
      timestampISO: new Date().toISOString(),
      prompt: promptUsed,
      chosenAI: chosenAI,
      targetPath: finalTargetAbs,
      action: "install",
      success: true,
    });
    session._aiWriteContext = null;
    return;
  }
  if (data === "aiWriteNo") {
    const { userId, username, promptUsed, chosenAI, finalTargetAbs } = session._aiWriteContext || {};
    await appendLog(config, {
      userId,
      username,
      timestampISO: new Date().toISOString(),
      prompt: promptUsed,
      chosenAI: chosenAI,
      targetPath: finalTargetAbs || "-",
      action: "skip",
      success: true,
    });
    session._aiWriteContext = null;
    await ctx.reply("❌ Oke, tidak dipasang.");
    return;
  }
}

async function handleTextAwaiting(ctx, config, session) {
  if (!session.awaiting) return false;
  const { type, folder } = session.awaiting;
  if (type !== "awaitAiPrompt") return false;

  let extraPrompt = (ctx.message?.text || "").trim();
  if (extraPrompt === "-") extraPrompt = "";

  // Siapkan payload prompt ke AI
  const storage = config.paths?.storage || "./tempatallsc";
  const defaultTarget = session.currentTargetFile;
  const targetAbs = path.resolve(storage, folder, defaultTarget);
  const content = await readTextFile(config, targetAbs);

  const promptFinal = [INSTRUCTION_TEMPLATE, extraPrompt, "\n\n=== FILE TARGET (mulai) ===\n", content, "\n=== FILE TARGET (selesai) ===\n"].join("\n");

  // Loading anim
  const msg = await ctx.reply("🤖 Mengirim ke AI");
  for (const dots of [".", "..", "...", "...."]) {
    await new Promise((r) => setTimeout(r, 280));
    try { await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `🤖 Mengirim ke AI${dots}`); } catch (_) {}
  }

  const aiType = session.currentAI || (config.ai && config.ai.default) || "blackbox";
  let aiResponse = "";
  try {
    aiResponse = await sendPrompt(aiType, promptFinal, config, session);
  } catch (err) {
    const help = err && err.help ? `\n\n${err.help}` : "";
    await ctx.reply(`⚠️ Gagal kirim ke ${aiType}. ${err.message || err}${help}`);
    session.awaiting = null;
    return true;
  }

  session.lastAiResponse = aiResponse;
  const { payload, targetPath } = parseAIResponse(aiResponse);
  session.lastPayload = payload;

  // Tentukan target path final
  let finalTargetAbs = targetAbs; // default
  try {
    if (targetPath) {
      // gunakan path dari AI, sanitize
      const safe = resolveSafePath(config, targetPath);
      finalTargetAbs = safe;
    } else {
      const hinted = detectFilenameInPrompt(extraPrompt);
      if (hinted) {
        const hintedAbs = path.resolve(storage, folder, hinted);
        if (await fs.pathExists(hintedAbs)) finalTargetAbs = hintedAbs;
      }
    }
  } catch (err) {
    await ctx.reply("⛔ Path dari AI terdeteksi berbahaya (../). Tolong konfirmasi manual.");
  }

  const isCode = isCodeLike(payload);
  const preview = (payload || "").slice(0, 1000);
  session._aiWriteContext = {
    finalTargetAbs,
    payloadForWrite: payload,
    chosenAI: aiType,
    userId: ctx.from?.id,
    username: ctx.from?.username || ctx.from?.first_name || "-",
    promptUsed: extraPrompt,
  };

  await ctx.reply(
    `🤖 Balasan AI (${aiType}) — Preview Payload:\n\n${preview}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "📥 Pasang Codingan Ini", callback_data: "aiWriteYes" },
          { text: "❌ Jangan Pasang", callback_data: "aiWriteNo" }
        ]]
      }
    }
  );

  session.awaiting = null;
  return true;
}

module.exports = {
  handleCallback,
  handleTextAwaiting,
  parseAIResponse,
  isCodeLike,
  showAiPreview,
};