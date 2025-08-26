"use strict";
/**
 * utils/fileManager.js
 *
 * Utilitas manajemen file & folder untuk bot.
 * - Menyediakan helper untuk scan direktori, baca/tulis file, dan sanitasi path.
 * - Semua path disanitasi agar tidak keluar dari root project (mencegah path traversal).
 * - Ditulis dengan komentar Bahasa Indonesia untuk mempermudah pemeliharaan.
 *
 * Catatan Keamanan:
 * - Jangan pernah mempercayai input path dari user tanpa sanitasi.
 * - Gunakan fungsi resolveSafePath untuk seluruh operasi file.
 */

const path = require("path");
const fs = require("fs-extra");

// Membantu normalisasi path relatif agar tidak mengandung '\\' atau bentuk aneh
function normalizeRelative(input) {
  return input.replace(/\\/g, "/").replace(/\s+/g, " ").trim();
}

// Validasi nama folder dasar: hanya alfanumerik, dash, underscore
function isValidFolderName(name) {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

// Validasi nama file sederhana: alfanumerik + dot/underscore/dash diperbolehkan
function isValidFileName(name) {
  return /^[a-zA-Z0-9_.-]+$/.test(name);
}

// Cegah path traversal dengan memastikan path final selalu berada di bawah root
function resolveSafePath(config, relativePath) {
  const rootDir = path.resolve(config.paths?.root || "./");
  const cleanRel = normalizeRelative(relativePath).replace(/\.+\//g, ".");
  const abs = path.resolve(rootDir, cleanRel);
  if (!abs.startsWith(rootDir)) {
    throw new Error("Path tidak aman (keluar dari root). Ditolak.");
  }
  return abs;
}

// Pastikan struktur dasar tersedia
async function ensureBaseStructure(config) {
  const storage = config.paths?.storage || "./tempatallsc";
  const db = config.paths?.db || "./db";
  const media = config.paths?.media || "./media";
  await fs.ensureDir(storage);
  await fs.ensureDir(db);
  await fs.ensureDir(media);
  const logsPath = path.join(db, "logs.json");
  if (!(await fs.pathExists(logsPath))) {
    await fs.writeFile(logsPath, "[]", "utf8");
  }
}

// List folder level teratas di storage
async function listTopLevelFolders(config) {
  const storage = path.resolve(config.paths?.storage || "./tempatallsc");
  await fs.ensureDir(storage);
  const entries = await fs.readdir(storage, { withFileTypes: true });
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

// List file di dalam folder (hanya file biasa)
async function listFilesInFolder(config, folderName) {
  const storage = path.resolve(config.paths?.storage || "./tempatallsc");
  const folderAbs = resolveSafePath(config, path.join(storage, folderName));
  const exists = await fs.pathExists(folderAbs);
  if (!exists) return [];
  const entries = await fs.readdir(folderAbs, { withFileTypes: true });
  return entries
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

// Buat folder jika belum ada
async function createFolder(config, parentFolderRelOrAbs, newFolderName) {
  if (!isValidFolderName(newFolderName)) {
    throw new Error("Nama folder hanya boleh huruf/angka, dash, dan underscore.");
  }
  const rootDir = path.resolve(config.paths?.root || "./");
  const parent = path.isAbsolute(parentFolderRelOrAbs)
    ? parentFolderRelOrAbs
    : resolveSafePath(config, parentFolderRelOrAbs);
  const folderAbs = path.resolve(parent, newFolderName);
  if (!folderAbs.startsWith(rootDir)) {
    throw new Error("Path folder di luar root. Ditolak.");
  }
  await fs.ensureDir(folderAbs);
  return folderAbs;
}

// Buat file (kosong atau isi) - overwrite opsional
async function createOrWriteFile(config, targetRelOrAbs, content = "", overwrite = true) {
  const targetAbs = path.isAbsolute(targetRelOrAbs)
    ? targetRelOrAbs
    : resolveSafePath(config, targetRelOrAbs);
  const dir = path.dirname(targetAbs);
  await fs.ensureDir(dir);
  const exists = await fs.pathExists(targetAbs);
  if (exists && !overwrite) {
    throw new Error("File sudah ada dan overwrite=false.");
  }
  await fs.writeFile(targetAbs, content, "utf8");
  return targetAbs;
}

async function readTextFile(config, targetRelOrAbs) {
  const targetAbs = path.isAbsolute(targetRelOrAbs)
    ? targetRelOrAbs
    : resolveSafePath(config, targetRelOrAbs);
  const exists = await fs.pathExists(targetAbs);
  if (!exists) return "";
  const buf = await fs.readFile(targetAbs);
  return buf.toString("utf8");
}

async function readPreview(config, targetRelOrAbs, maxLen = 1000) {
  const content = await readTextFile(config, targetRelOrAbs);
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\n\n... (dipotong)";
}

function joinStoragePath(config, ...segments) {
  const storage = config.paths?.storage || "./tempatallsc";
  const rel = path.join(storage, ...segments);
  return rel;
}

module.exports = {
  normalizeRelative,
  isValidFolderName,
  isValidFileName,
  resolveSafePath,
  ensureBaseStructure,
  listTopLevelFolders,
  listFilesInFolder,
  createFolder,
  createOrWriteFile,
  readTextFile,
  readPreview,
  joinStoragePath,
};