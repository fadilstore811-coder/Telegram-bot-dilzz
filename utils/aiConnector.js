// utils/aiConnector.js
// ===============================================================
//  Modul aiConnector
//  - sendToAI(aiName, prompt, CONFIG, session): kirim prompt ke AI
//  - parseAIResponse(response, userPrompt, CONFIG, session, defaultTarget): ekstrak payload & targetPath
//  Koneksi situs memakai puppeteer-extra + stealth, cookies-based login.
//  Catatan: Selector UI bisa berubah sewaktu-waktu. Perbarui selector di sini.
// ===============================================================

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs-extra');
const path = require('path');

puppeteer.use(StealthPlugin());

// ---------------------------------------------
//  Helper Cookies
// ---------------------------------------------
async function loadCookies(page, cookiesPath) {
  if (await fs.pathExists(cookiesPath)) {
    const cookies = await fs.readJson(cookiesPath);
    await page.setCookie(...cookies);
  } else {
    console.warn('Cookies file tidak ditemukan:', cookiesPath);
  }
}

async function saveCookies(page, cookiesPath) {
  try {
    const cookies = await page.cookies();
    await fs.ensureDir(path.dirname(cookiesPath));
    await fs.writeJson(cookiesPath, cookies, { spaces: 2 });
  } catch (err) {
    console.error('Gagal menyimpan cookies', err);
  }
}

// ---------------------------------------------
//  Main sender
// ---------------------------------------------
async function sendToAI(aiName, prompt, CONFIG, session) {
  // If blackbox: quick fetch via public endpoint (simplified)
  if (aiName === 'blackbox') {
    return await sendToBlackbox(prompt);
  }

  // For ChatGPT & Gemini: puppeteer with cookies
  const browser = session.puppeteerBrowserRef || await puppeteer.launch({ headless: true });
  session.puppeteerBrowserRef = browser;
  const page = await browser.newPage();

  try {
    if (aiName === 'chatgpt') {
      const cookiesPath = CONFIG.accounts.chatgpt.cookies_path;
      await loadCookies(page, cookiesPath);
      await page.goto('https://chat.openai.com', { waitUntil: 'networkidle0' });
      // cek login by selector
      // Selector untuk textbox (bisa berubah)
      const inputSelector = 'textarea[data-id="root"]';
      await page.waitForSelector(inputSelector, { timeout: 15000 });
      await page.type(inputSelector, prompt);
      await page.keyboard.press('Enter');
      // Tunggu balasan
      await page.waitForTimeout(10000);
      const response = await page.evaluate(() => {
        const messages = Array.from(document.querySelectorAll('div.markdown'));
        return messages.at(-1)?.innerText || '';
      });
      await saveCookies(page, cookiesPath);
      return response;
    }

    if (aiName === 'gemini') {
      const cookiesPath = CONFIG.accounts.gemini.cookies_path;
      await loadCookies(page, cookiesPath);
      await page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle0' });
      const inputSelector = 'textarea';
      await page.waitForSelector(inputSelector, { timeout: 15000 });
      await page.type(inputSelector, prompt);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(10000);
      const response = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('md-list-item'));
        return cards.at(-1)?.innerText || '';
      });
      await saveCookies(page, cookiesPath);
      return response;
    }
  } catch (err) {
    console.error('sendToAI error', err);
    return 'ERROR: ' + err.message;
  } finally {
    try {
      await page.close();
    } catch (_) {}
  }
  return 'Tidak ada response';
}

async function sendToBlackbox(prompt) {
  try {
    const res = await fetch('https://www.blackbox.ai/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textInput: prompt }),
    });
    const json = await res.json();
    return json.response || JSON.stringify(json);
  } catch (err) {
    console.error('Blackbox fetch error', err);
    return 'ERROR: ' + err.message;
  }
}

// ---------------------------------------------
//  Parsing AI Response
// ---------------------------------------------
function parseAIResponse(response, userPrompt, CONFIG, session, defaultTarget) {
  let payload = '';
  let targetPath = defaultTarget;

  if (!response) response = '';

  // Rule A: code fences
  const fenceMatch = response.match(/```[\s\S]*?\n([\s\S]*?)```/);
  if (fenceMatch) {
    payload = fenceMatch[1].trim();
  } else {
    // Rule B: first line path spec
    const lines = response.split(/\r?\n/);
    const firstNonEmptyIdx = lines.findIndex((l) => l.trim() !== '');
    const firstLine = lines[firstNonEmptyIdx] || '';
    const pathMatch = firstLine.match(/^#\s*([^\s]+)|^([^\s]+):$/);
    if (pathMatch) {
      targetPath = pathMatch[1] || pathMatch[2];
      payload = lines.slice(firstNonEmptyIdx + 1).join('\n');
    } else {
      // Rule C: JSON block
      const jsonMatch = response.match(/[\[{][\s\S]*?[\]}]/);
      if (jsonMatch) {
        payload = jsonMatch[0];
      } else {
        // Rule D: all trimmed
        payload = response.trim();
      }
    }
  }

  // Normalize targetPath under storage root
  const safeTarget = sanitizeTargetPath(CONFIG, targetPath, defaultTarget);
  return { payload, targetPath: safeTarget };
}

function sanitizeTargetPath(CONFIG, requestedPath, fallback) {
  const storageRoot = CONFIG.paths?.storage || './tempatallsc';
  let rel = requestedPath || fallback;
  rel = rel.replace(/^\/+/, '');
  // prevent traversal
  if (rel.includes('..')) rel = fallback;
  return rel;
}

module.exports = {
  sendToAI,
  parseAIResponse,
};