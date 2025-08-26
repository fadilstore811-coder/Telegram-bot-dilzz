// utils/logManager.js
// ===============================================================
//  Modul logManager – menulis log aktivitas ke ./db/logs.json
//  - appendLog(entry): merge entry dengan log existing secara atomik.
//  - Pastikan file db/logs.json sudah ada (dibuat di fileManager.ensureStorageReady)
// ===============================================================

const fs = require('fs-extra');
const path = require('path');

async function appendLog(CONFIG, entry) {
  try {
    const logFile = path.resolve(CONFIG.paths?.db || './db', 'logs.json');
    const current = await fs.readJson(logFile);
    current.push(entry);
    await fs.writeJson(logFile, current, { spaces: 2 });
  } catch (err) {
    console.error('Gagal menulis log', err);
  }
}

module.exports = { appendLog };