/**
 * utils/logManager.js
 * Append log terstruktur ke ./db/logs.json secara aman.
 */

const fs = require('fs-extra');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'db', 'logs.json');

async function appendLog(entry) {
  await fs.ensureFile(DB_PATH);
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const arr = raw.trim() ? JSON.parse(raw) : [];
    arr.push(entry);
    await fs.writeFile(DB_PATH, JSON.stringify(arr, null, 2));
  } catch (e) {
    // fallback sederhana jika race
    try {
      await fs.appendFile(DB_PATH, '\n');
    } catch {}
  }
}

module.exports = { appendLog };