/**
 * utils/aiConnector.js
 * Konektor Puppeteer untuk ChatGPT, Gemini, dan Blackbox.
 * - Login berbasis cookies saja (kecuali Blackbox tanpa login)
 * - Simpan/muat cookies sesuai config
 * - Centralize selectors agar mudah diupdate jika website berubah
 * - Kelola satu instance browser per session (disimpan di session.puppeteerBrowserRef)
 *
 * Catatan keamanan: cookies mengandung sesi login. Simpan file cookies dengan permission ketat.
 */

const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const SELECTORS = {
  chatgpt: {
    url: 'https://chat.openai.com/',
    textarea: 'textarea, div[contenteditable="true"]',
    sendButton: 'button:has(svg[data-icon="paper-plane"])',
    responseChunk: '[data-message-author-role="assistant"], .markdown.prose',
  },
  gemini: {
    url: 'https://gemini.google.com/app',
    textarea: 'textarea, div[contenteditable="true"]',
    sendButton: 'button[type="submit"]',
    responseChunk: 'div[aria-live] div:not(:empty), .markdown',
  },
  blackbox: {
    url: 'https://www.blackbox.ai/',
    textarea: 'textarea, [contenteditable="true"]',
    sendButton: 'button[type="submit"], button[aria-label*="Send"]',
    responseChunk: '.prose, .markdown, .whitespace-pre-wrap',
  }
};

async function ensureBrowser(session, headless = true) {
  if (session.puppeteerBrowserRef && (await isBrowserOpen(session.puppeteerBrowserRef))) {
    return session.puppeteerBrowserRef;
  }
  const browser = await puppeteer.launch({ headless, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  session.puppeteerBrowserRef = browser;
  return browser;
}

async function isBrowserOpen(browser) {
  try {
    const pages = await browser.pages();
    return pages != null;
  } catch {
    return false;
  }
}

async function ensureBrowserClosed(session) {
  if (session?.puppeteerBrowserRef) {
    try { await session.puppeteerBrowserRef.close(); } catch {}
    session.puppeteerBrowserRef = null;
  }
}

async function loadCookiesIfAny(page, cookiesPath) {
  if (!cookiesPath) return { loaded: false, reason: 'no-path' };
  const abs = path.resolve(process.cwd(), cookiesPath);
  if (!(await fs.pathExists(abs))) return { loaded: false, reason: 'missing' };
  try {
    const cookies = await fs.readJson(abs);
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      return { loaded: true };
    }
  } catch (e) {
    return { loaded: false, reason: 'invalid' };
  }
  return { loaded: false, reason: 'empty' };
}

async function saveCookies(page, cookiesPath) {
  if (!cookiesPath) return;
  try {
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');
    await fs.ensureFile(path.resolve(process.cwd(), cookiesPath));
    await fs.writeJson(path.resolve(process.cwd(), cookiesPath), cookies, { spaces: 2 });
  } catch {}
}

async function waitForAndType(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.focus(selector).catch(()=>{});
  await page.type(selector, text, { delay: 10 });
}

async function getLastResponseText(page, selector) {
  const chunks = await page.$$(selector);
  if (!chunks || !chunks.length) return '';
  const last = chunks[chunks.length - 1];
  const text = await page.evaluate(el => el.innerText || el.textContent || '', last);
  return (text || '').trim();
}

async function sendToChatGPT(browser, prompt, cookiesPath) {
  const page = await browser.newPage();
  await page.goto(SELECTORS.chatgpt.url, { waitUntil: 'domcontentloaded' });
  // muat cookies dulu lalu reload
  const ck = await loadCookiesIfAny(page, cookiesPath);
  if (!ck.loaded) {
    return {
      ok: false,
      reason: 'cookies-missing',
      message: 'Cookies ChatGPT tidak ditemukan. Ekspor cookies via ekstensi Cookie-Editor dan simpan ke path config.accounts.chatgpt.cookies_path'
    };
  }
  await page.reload({ waitUntil: 'networkidle2' });
  try {
    await waitForAndType(page, SELECTORS.chatgpt.textarea, prompt);
    const sendBtn = await page.$(SELECTORS.chatgpt.sendButton);
    if (sendBtn) await sendBtn.click(); else await page.keyboard.press('Enter');
    // tunggu balasan muncul
    await page.waitForTimeout(2500);
    await page.waitForSelector(SELECTORS.chatgpt.responseChunk, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const text = await getLastResponseText(page, SELECTORS.chatgpt.responseChunk);
    await saveCookies(page, cookiesPath);
    await page.close().catch(()=>{});
    return { ok: true, text };
  } catch (e) {
    await page.close().catch(()=>{});
    return { ok: false, reason: 'selector-changed', message: 'Selector changed — update utils/aiConnector.js selectors', error: e.message };
  }
}

async function sendToGemini(browser, prompt, cookiesPath) {
  const page = await browser.newPage();
  await page.goto(SELECTORS.gemini.url, { waitUntil: 'domcontentloaded' });
  const ck = await loadCookiesIfAny(page, cookiesPath);
  if (!ck.loaded) {
    return {
      ok: false,
      reason: 'cookies-missing',
      message: 'Cookies Gemini tidak ditemukan. Ekspor cookies Google via Cookie-Editor dan simpan sesuai config.'
    };
  }
  await page.reload({ waitUntil: 'networkidle2' });
  try {
    await waitForAndType(page, SELECTORS.gemini.textarea, prompt);
    const sendBtn = await page.$(SELECTORS.gemini.sendButton);
    if (sendBtn) await sendBtn.click(); else await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.waitForSelector(SELECTORS.gemini.responseChunk, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const text = await getLastResponseText(page, SELECTORS.gemini.responseChunk);
    await saveCookies(page, cookiesPath);
    await page.close().catch(()=>{});
    return { ok: true, text };
  } catch (e) {
    await page.close().catch(()=>{});
    return { ok: false, reason: 'selector-changed', message: 'Selector changed — update utils/aiConnector.js selectors', error: e.message };
  }
}

async function sendToBlackbox(browser, prompt) {
  const page = await browser.newPage();
  await page.goto(SELECTORS.blackbox.url, { waitUntil: 'domcontentloaded' });
  try {
    await waitForAndType(page, SELECTORS.blackbox.textarea, prompt);
    const sendBtn = await page.$(SELECTORS.blackbox.sendButton);
    if (sendBtn) await sendBtn.click(); else await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.waitForSelector(SELECTORS.blackbox.responseChunk, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const text = await getLastResponseText(page, SELECTORS.blackbox.responseChunk);
    await page.close().catch(()=>{});
    return { ok: true, text };
  } catch (e) {
    await page.close().catch(()=>{});
    return { ok: false, reason: 'selector-changed', message: 'Selector changed — update utils/aiConnector.js selectors', error: e.message };
  }
}

async function sendToAI({ config, session, prompt }) {
  const headless = true; // rekomendasi headless true; jika perlu 2FA set false manual
  const browser = await ensureBrowser(session, headless);
  const ai = (session.currentAI || config.ai?.default || 'blackbox').toLowerCase();
  if (ai === 'chatgpt') {
    const cookiesPath = config.accounts?.chatgpt?.cookies_path;
    return await sendToChatGPT(browser, prompt, cookiesPath);
  }
  if (ai === 'gemini') {
    const cookiesPath = config.accounts?.gemini?.cookies_path;
    return await sendToGemini(browser, prompt, cookiesPath);
  }
  return await sendToBlackbox(browser, prompt);
}

module.exports = {
  sendToAI,
  ensureBrowserClosed,
  SELECTORS,
};