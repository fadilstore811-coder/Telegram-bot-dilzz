"use strict";
/**
 * utils/logManager.js
 *
 * Utilitas untuk append log aktivitas ke ./db/logs.json
 * Menggunakan fs-extra untuk memastikan direktori ada dan penulisan aman.
 */

const path = require("path");
const fs = require("fs-extra");

async function appendLog(config, entry) {
  try {
    const dbDir = config.paths?.db || "./db";
    await fs.ensureDir(dbDir);
    const logsPath = path.resolve(dbDir, "logs.json");
    let logs = [];
    if (await fs.pathExists(logsPath)) {
      try {
        logs = await fs.readJson(logsPath);
        if (!Array.isArray(logs)) logs = [];
      } catch (_) {
        logs = [];
      }
    }
    logs.push(entry);
    // Tulis ulang array (sederhana; single-process). Untuk robust multi-proses, gunakan lock file.
    await fs.writeJson(logsPath, logs, { spaces: 2 });
  } catch (err) {
    console.error("Gagal menulis log:", err.message);
  }
}

module.exports = { appendLog };