/**
 * features/aiHelper.js
 * Fitur inti Bantuan AI: kirim prompt gabungan, parsing balasan, preview, dan pemasangan payload ke file target.
 */

const path = require('path');
const fs = require('fs-extra');
const { Markup } = require('telegraf');
const { sendToAI } = require('../utils/aiConnector');
const fileManager = require('../utils/fileManager');
const logManager = require('../utils/logManager');

const INSTRUCTION_TEMPLATE = `Anda adalah AI coding assistant. Tugas: hasilkan payload KODE/TEKS untuk ditulis ke file.
- Jika ingin menentukan file target, gunakan salah satu format baris pertama:
  1) "# relative/path/to/file.ext" atau
  2) "relative/path/to/file.ext:" (diakhiri titik dua) atau
  3) satu baris berisi "relative/path/to/file.ext" saja
- Jika menyertakan code fence, gunakan blok triple-backtick. Hanya blok PERTAMA yang akan dipakai.
- Jika mengirim JSON, pastikan valid.
- Jangan tulis penjelasan panjang; fokus pada payload.
`;

function detectCode(payload) {
  const t = (payload || '').trim();
  if (!t) return false;
  if (t.startsWith('{') || t.startsWith('[')) return true;
  const patterns = [/\brequire\(/, /module\.exports/, /\bfunction\s+/, /\bconst\s+/, /\bclass\s+/, /"name"\s*:/];
  return patterns.some(rx => rx.test(t));
}

function extractFirstCodeBlock(text) {
  const fence = /```[\s\S]*?```/g;
  const m = fence.exec(text);
  if (m) {
    return m[0].replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```\s*$/, '');
  }
  return null;
}

function extractFirstJsonLike(text) {
  const idxBrace = text.indexOf('{');
  const idxBracket = text.indexOf('[');
  let idx = -1;
  if (idxBrace === -1) idx = idxBracket; else if (idxBracket === -1) idx = idxBrace; else idx = Math.min(idxBrace, idxBracket);
  if (idx < 0) return null;
  const s = text.slice(idx);
  // naive balance
  let depth = 0;
  let end = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end >= 0) return s.slice(0, end + 1);
  return null;
}

function parseAiResponse(raw) {
  let targetPath = null;
  let payload = null;
  const text = (raw || '').trim();
  if (!text) return { targetPath, payload: '' };

  // A) code fence
  const code = extractFirstCodeBlock(text);
  if (code) return { targetPath, payload: code.trim() };

  // B) path spec on first non-empty line
  const lines = text.split(/\r?\n/);
  const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
  if (firstNonEmptyIdx >= 0) {
    const first = lines[firstNonEmptyIdx].trim();
    const m1 = /^#\s*([^\s].*)$/.exec(first);
    const m2 = /^([^\s].*):$/.exec(first);
    const m3 = /^([^\s]+\.[A-Za-z0-9_.-]+)$/.exec(first);
    if (m1 || m2 || m3) {
      targetPath = (m1 ? m1[1] : (m2 ? m2[1] : m3[1])).trim();
      const rest = lines.slice(firstNonEmptyIdx + 1).join('\n');
      return { targetPath, payload: rest.trim() };
    }
  }

  // C) json-like
  const jsonSeg = extractFirstJsonLike(text);
  if (jsonSeg) return { targetPath, payload: jsonSeg.trim() };

  // D) fallback
  return { targetPath, payload: text };
}

function resolveTargetPath({ config, session, userPrompt, defaultTarget, parsedTargetPath }) {
  const root = path.resolve(__dirname, '..');
  // 1) if B matched
  if (parsedTargetPath) {
    const safe = fileManager.resolveUnderRoot(parsedTargetPath);
    return safe;
  }
  // 2) filename mention in prompt and exists in current folder
  if (userPrompt) {
    const m = /\b([\w-]+\.(?:json|js|env|txt))\b/i.exec(userPrompt);
    if (m && session.currentFolder) {
      const candidate = path.join(config.paths?.storage || './tempatallsc', session.currentFolder, m[1]);
      const abs = path.resolve(process.cwd(), candidate);
      if (fs.existsSync(abs)) return abs;
    }
  }
  // 3) default target
  if (defaultTarget) return defaultTarget;
  // 4) as last resort, place in storage root temp.txt
  return path.resolve(process.cwd(), config.paths?.storage || './tempatallsc', 'output.txt');
}

async function handleAiGenerate(ctx, { config, session, storageDir, userPrompt }) {
  const defaultTarget = session.currentTargetFile;
  const baseInstruction = INSTRUCTION_TEMPLATE;
  const targetPreview = await fs.readFile(defaultTarget, 'utf8').catch(()=> '');
  const combined = `${baseInstruction}\nUSER_PROMPT: ${userPrompt || '(kosong)'}\n---\nTARGET_FILE_CONTENT:\n${targetPreview}`;

  await ctx.reply('Menghubungi AI... 🤖');
  const result = await sendToAI({ config, session, prompt: combined });
  if (!result.ok) {
    const msg = result.message || 'Gagal memproses AI.';
    await ctx.reply(`Gagal: ${msg}\nDetail: ${result.error || result.reason || ''}`);
    return;
  }

  const parsed = parseAiResponse(result.text);
  const targetPathAbs = resolveTargetPath({
    config,
    session,
    userPrompt,
    defaultTarget,
    parsedTargetPath: parsed.targetPath
  });

  // keamanan: pastikan tidak ada traversal
  if (!path.resolve(targetPathAbs).startsWith(path.resolve(process.cwd()))) {
    await ctx.reply('Target path keluar dari project. Ditolak.');
    return;
  }

  session.lastAiResponse = result.text;
  session.lastPayload = parsed.payload;
  session.pendingTargetPath = targetPathAbs;

  const isCode = detectCode(parsed.payload);
  const preview = (parsed.payload || '').slice(0, 1000);
  await ctx.reply(`Preview payload untuk ditulis ke:\n${path.relative(process.cwd(), targetPathAbs)}\n\n${preview}`, Markup.inlineKeyboard([
    [Markup.button.callback('📥 Pasang Codingan Ini', 'AI_INSTALL'), Markup.button.callback('❌ Jangan Pasang', 'AI_SKIP')]
  ]));
}

function registerBotActions(bot) {
  bot.action('AI_INSTALL', async (ctx) => {
    const session = ctx && ctx.chat ? null : null; // placeholder to satisfy linter; real session fetched below
    const chatId = ctx.chat.id;
    // access session via closure in index is not possible; we reconstruct minimal save using temp store attached to ctx
    // However, index maintains sessions Map internally. To bridge, we attach last payload and path on ctx.sessionProxy when calling handleAiGenerate.
    // Simpler: stash payload & target in global map keyed by chatId.
    const store = global.__aiHelperStore || (global.__aiHelperStore = new Map());
    const st = store.get(chatId);
    if (!st || !st.payload || !st.targetPath || !st.chosenAI) {
      return ctx.answerCbQuery('Tidak ada payload untuk dipasang.');
    }
    try {
      await fs.ensureDir(path.dirname(st.targetPath));
      await fs.writeFile(st.targetPath, st.payload);
      await ctx.reply(`Berhasil dipasang ke ${path.relative(process.cwd(), st.targetPath)} ✅\nPreview:\n` + st.payload.slice(0, 1000));
      await logManager.appendLog({
        userId: ctx.from.id,
        username: ctx.from.username,
        timestampISO: new Date().toISOString(),
        prompt: st.userPrompt || '',
        chosenAI: st.chosenAI,
        targetPath: path.relative(process.cwd(), st.targetPath),
        action: 'install',
        success: true
      });
    } catch (e) {
      await ctx.reply('Gagal menulis file: ' + e.message);
      await logManager.appendLog({
        userId: ctx.from.id,
        username: ctx.from.username,
        timestampISO: new Date().toISOString(),
        prompt: st.userPrompt || '',
        chosenAI: st.chosenAI,
        targetPath: path.relative(process.cwd(), st.targetPath),
        action: 'install',
        success: false,
        errorMessage: e.message
      });
    }
  });

  bot.action('AI_SKIP', async (ctx) => {
    const chatId = ctx.chat.id;
    const store = global.__aiHelperStore || (global.__aiHelperStore = new Map());
    const st = store.get(chatId);
    await ctx.reply('Baik, tidak dipasang. 👍');
    if (st) {
      await logManager.appendLog({
        userId: ctx.from.id,
        username: ctx.from.username,
        timestampISO: new Date().toISOString(),
        prompt: st.userPrompt || '',
        chosenAI: st.chosenAI,
        targetPath: path.relative(process.cwd(), st.targetPath),
        action: 'skip',
        success: true
      });
    }
  });
}

// bridge to stash last payload/target between handle and action
async function stashForActions(ctx, { payload, targetPath, userPrompt, chosenAI }) {
  const store = global.__aiHelperStore || (global.__aiHelperStore = new Map());
  store.set(ctx.chat.id, { payload, targetPath, userPrompt, chosenAI });
}

module.exports = {
  handleAiGenerate: async (ctx, { config, session, storageDir, userPrompt }) => {
    await handleAiGenerate(ctx, { config, session, storageDir, userPrompt });
    // stash data for actions
    await stashForActions(ctx, {
      payload: session.lastPayload,
      targetPath: session.pendingTargetPath,
      userPrompt,
      chosenAI: session.currentAI || (config.ai && config.ai.default) || 'blackbox'
    });
  },
  registerBotActions,
};