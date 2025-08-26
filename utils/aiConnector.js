"use strict";
/**
 * utils/aiConnector.js
 *
 * Abstraksi konektor AI via puppeteer-extra + stealth.
 * - ChatGPT (chat.openai.com) — login via cookies saja.
 * - Gemini (gemini.google.com) — login via cookies saja.
 * - Blackbox (www.blackbox.ai) — tanpa login.
 *
 * PERINGATAN:
 * - Jangan pernah otomatis mengetik password Google/OpenAI. Hanya gunakan cookies-based login.
 * - Jika cookies tidak tersedia/expired, kembalikan error ramah yang berisi instruksi untuk user.
 * - Selektor web dapat berubah. Jika gagal, tampilkan pesan: "Selector changed — update utils/aiConnector.js selectors".
 *
 * Tips Dev:
 * - Set headless:false untuk investigasi manual (mis. 2FA). Di produksi headless:true.
 */

const path = require("path");
const fs = require("fs-extra");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const DEFAULT_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

const SELECTORS = {
  chatgpt: {
    input: 'textarea, div[contenteditable="true"][data-id], #prompt-textarea',
    response: 'div.markdown, article div prose, .prose, pre code',
  },
  gemini: {
    input: 'textarea, div[contenteditable="true"][role="textbox"]',
    response: '.markdown, pre code, .response, .whitespace-pre-wrap',
  },
  blackbox: {
    input: 'textarea, #chat-input, div[contenteditable="true"]',
    sendButton: 'button[type="submit"], button[aria-label*="Send"], [data-testid*="send"]',
    response: '.markdown, pre code, .whitespace-pre-wrap',
  },
};

function buildMissingCookiesHelp(serviceName, cookiesPath) {
  return [
    `Cookies untuk ${serviceName} tidak ditemukan.`,
    `1) Login di browser (Chrome Desktop/Android Kiwi) ke ${serviceName}.`,
    "2) Ekspor cookies memakai ekstensi 'Cookie-Editor' sebagai JSON.",
    `3) Simpan file JSON ke path: ${cookiesPath} (buat folder jika perlu).`,
    "4) Jalankan ulang perintah/aksi di bot.",
  ].join("\n");
}

async function ensureBrowser(session, { headless = true } = {}) {
  if (session.puppeteerBrowserRef && session.puppeteerBrowserRef.isConnected()) {
    return session.puppeteerBrowserRef;
  }
  const browser = await puppeteer.launch({ headless, args: DEFAULT_LAUNCH_ARGS });
  session.puppeteerBrowserRef = browser;
  return browser;
}

async function loadCookiesFor(page, url, cookiesPath) {
  if (!(await fs.pathExists(cookiesPath))) return false;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    const cookies = await fs.readJson(cookiesPath);
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      await page.goto(url, { waitUntil: "networkidle2" });
      return true;
    }
  } catch (_) {
    // noop
  }
  return false;
}

async function saveCookiesFrom(page, cookiesPath) {
  try {
    const cookies = await page.cookies();
    await fs.ensureDir(path.dirname(cookiesPath));
    await fs.writeJson(cookiesPath, cookies, { spaces: 2 });
  } catch (err) {
    console.error("Gagal menyimpan cookies:", err.message);
  }
}

async function sendToChatGPT(prompt, config, session) {
  const cookiesPath = config.accounts?.chatgpt?.cookies_path || "./cookies/chatgpt.json";
  if (!(await fs.pathExists(cookiesPath))) {
    const err = new Error("MISSING_COOKIES_CHATGPT");
    err.help = buildMissingCookiesHelp("ChatGPT (chat.openai.com)", cookiesPath);
    throw err;
  }
  const browser = await ensureBrowser(session, { headless: true });
  const page = await browser.newPage();
  try {
    const url = "https://chat.openai.com/";
    const loaded = await loadCookiesFor(page, url, cookiesPath);
    if (!loaded) {
      const err = new Error("COOKIES_INVALID_CHATGPT");
      err.help = buildMissingCookiesHelp("ChatGPT (chat.openai.com)", cookiesPath);
      throw err;
    }

    // Fokus ke textarea input
    await page.waitForSelector(SELECTORS.chatgpt.input, { timeout: 20000 });
    const inputHandle = await page.$(SELECTORS.chatgpt.input);
    if (!inputHandle) throw new Error("Selector changed — update utils/aiConnector.js selectors (input ChatGPT)");

    await inputHandle.click({ clickCount: 3 });
    await inputHandle.type(prompt, { delay: 20 });
    await inputHandle.press("Enter");

    // Tunggu respons muncul
    await page.waitForSelector(SELECTORS.chatgpt.response, { timeout: 120000 });
    const responseText = await page.evaluate((sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const last = nodes[nodes.length - 1];
      return last ? last.innerText : "";
    }, SELECTORS.chatgpt.response);

    await saveCookiesFrom(page, cookiesPath);
    await page.close();
    return responseText || "";
  } catch (err) {
    try { await page.close(); } catch (_) {}
    throw err;
  }
}

async function sendToGemini(prompt, config, session) {
  const cookiesPath = config.accounts?.gemini?.cookies_path || "./cookies/gemini.json";
  if (!(await fs.pathExists(cookiesPath))) {
    const err = new Error("MISSING_COOKIES_GEMINI");
    err.help = buildMissingCookiesHelp("Gemini (gemini.google.com)", cookiesPath);
    throw err;
  }
  const browser = await ensureBrowser(session, { headless: true });
  const page = await browser.newPage();
  try {
    const url = "https://gemini.google.com/app";
    const loaded = await loadCookiesFor(page, url, cookiesPath);
    if (!loaded) {
      const err = new Error("COOKIES_INVALID_GEMINI");
      err.help = buildMissingCookiesHelp("Gemini (gemini.google.com)", cookiesPath);
      throw err;
    }
    await page.waitForSelector(SELECTORS.gemini.input, { timeout: 20000 });
    const inputHandle = await page.$(SELECTORS.gemini.input);
    if (!inputHandle) throw new Error("Selector changed — update utils/aiConnector.js selectors (input Gemini)");

    await inputHandle.click({ clickCount: 3 });
    await inputHandle.type(prompt, { delay: 20 });
    await inputHandle.press("Enter");

    await page.waitForSelector(SELECTORS.gemini.response, { timeout: 120000 });
    const responseText = await page.evaluate((sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const last = nodes[nodes.length - 1];
      return last ? last.innerText : "";
    }, SELECTORS.gemini.response);

    await saveCookiesFrom(page, cookiesPath);
    await page.close();
    return responseText || "";
  } catch (err) {
    try { await page.close(); } catch (_) {}
    throw err;
  }
}

async function sendToBlackbox(prompt, _config, session) {
  const browser = await ensureBrowser(session, { headless: true });
  const page = await browser.newPage();
  try {
    const url = "https://www.blackbox.ai/";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(SELECTORS.blackbox.input, { timeout: 30000 });
    const inputHandle = await page.$(SELECTORS.blackbox.input);
    if (!inputHandle) throw new Error("Selector changed — update utils/aiConnector.js selectors (input Blackbox)");

    await inputHandle.click({ clickCount: 3 });
    await inputHandle.type(prompt, { delay: 20 });

    // Tekan Enter jika tombol kirim tidak ada
    const sendBtn = await page.$(SELECTORS.blackbox.sendButton);
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await inputHandle.press("Enter");
    }

    await page.waitForSelector(SELECTORS.blackbox.response, { timeout: 120000 });
    const responseText = await page.evaluate((sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const last = nodes[nodes.length - 1];
      return last ? last.innerText : "";
    }, SELECTORS.blackbox.response);

    await page.close();
    return responseText || "";
  } catch (err) {
    try { await page.close(); } catch (_) {}
    throw err;
  }
}

async function sendPrompt(aiType, prompt, config, session) {
  if (!aiType) aiType = (config.ai && config.ai.default) || "blackbox";
  const enable = (config.ai && config.ai.enable) || {};
  if (!enable[aiType]) {
    throw new Error(`AI ${aiType} dimatikan di config.`);
  }
  switch (aiType) {
    case "chatgpt":
      return await sendToChatGPT(prompt, config, session);
    case "gemini":
      return await sendToGemini(prompt, config, session);
    case "blackbox":
    default:
      return await sendToBlackbox(prompt, config, session);
  }
}

async function closeBrowser(session) {
  try {
    if (session && session.puppeteerBrowserRef) {
      await session.puppeteerBrowserRef.close();
      session.puppeteerBrowserRef = null;
    }
  } catch (err) {
    // ignore
  }
}

module.exports = {
  sendPrompt,
  closeBrowser,
  SELECTORS,
};